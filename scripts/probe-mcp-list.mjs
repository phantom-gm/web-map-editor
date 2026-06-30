// 읽기 전용 probe 2: 그룹 리소스 목록 + 썸네일 URL 실호출 → 응답 필드 형태 확정.
// 자산 생성/변경 없음.
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const MCP_URL = env.MSW_MCP_URL || "https://msw-mcp.nexon.com/mcp";
const GROUP = env.MSW_GROUP_CODE || "43bIK";
let token = (env.MSW_MCP_TOKEN || "").trim();
if (!token.startsWith("Bearer ")) token = `Bearer ${token}`;

const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
  requestInit: { headers: { Authorization: token } },
});
const client = new Client({ name: "web-map-editor-probe2", version: "0.0.1" }, { capabilities: {} });

function parseToolJson(res) {
  const text = res?.content?.find((c) => c.type === "text")?.text ?? "";
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

try {
  await client.connect(transport);

  console.log("===== asset_list_group_resources (sprite / subcategory=all) =====");
  const list = await client.callTool({
    name: "asset_list_group_resources",
    arguments: { groupCode: GROUP, category: "sprite", subcategory: "all", count: 5 },
  });
  const listJson = parseToolJson(list);
  console.log(JSON.stringify(listJson, null, 2).slice(0, 2500));

  // 목록에서 첫 RUID/GUID 추출(필드명 방어적)
  function firstItems(o) {
    if (!o || typeof o !== "object") return [];
    for (const k of ["items", "resources", "list", "data", "results", "content"]) {
      if (Array.isArray(o[k])) return o[k];
    }
    // 한 단계 더 탐색
    for (const v of Object.values(o)) if (Array.isArray(v)) return v;
    for (const v of Object.values(o)) if (v && typeof v === "object") { const r = firstItems(v); if (r.length) return r; }
    return [];
  }
  const items = firstItems(listJson);
  console.log(`\n추출된 아이템 수: ${items.length}`);
  if (items[0]) {
    console.log("첫 아이템 키:", Object.keys(items[0]));
    console.log("첫 아이템:", JSON.stringify(items[0], null, 2).slice(0, 800));
    const ruid = items[0].ruid || items[0].guid || items[0].resourceGuid || items[0].id;
    console.log("\n===== asset_get_group_thumbnail(ruid=" + ruid + ") =====");
    const th = await client.callTool({
      name: "asset_get_group_thumbnail",
      arguments: { ruid, groupCode: GROUP },
    });
    console.log(JSON.stringify(parseToolJson(th), null, 2).slice(0, 1500));
  }
} catch (e) {
  console.error("probe2 실패:", e?.message || e);
  process.exit(1);
} finally {
  await client.close().catch(() => {});
}
