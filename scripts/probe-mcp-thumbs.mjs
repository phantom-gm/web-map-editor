// 읽기 전용 probe 3: 썸네일 가용성 표본 조사.
// (a) 그룹 리소스 목록 N개 + 각 썸네일, (b) 시드 레지스트리 타일 RUID 들의 썸네일.
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
const client = new Client({ name: "web-map-editor-probe3", version: "0.0.1" }, { capabilities: {} });
const J = (res) => { const t = res?.content?.find((c) => c.type === "text")?.text ?? ""; try { return t ? JSON.parse(t) : null; } catch { return t; } };

try {
  await client.connect(transport);

  const list = J(await client.callTool({
    name: "asset_list_group_resources",
    arguments: { groupCode: GROUP, category: "sprite", subcategory: "all", count: 12 },
  }));
  const items = list?.resourceList ?? [];
  console.log(`그룹 리소스 ${items.length}개 썸네일 표본:`);
  let ok = 0;
  for (const it of items) {
    const th = J(await client.callTool({ name: "asset_get_group_thumbnail", arguments: { ruid: it.ruid, groupCode: GROUP } }));
    const url = th?.thumbnail_url ?? th?.thumbnailUrl ?? null;
    if (url) ok++;
    console.log(`  ${th?.available ? "✅" : "❌"} ${it.subcategory.padEnd(10)} ${it.name.padEnd(22)} ${url ? url.slice(0, 80) : (th?.error || "")}`);
  }
  console.log(`→ 그룹: ${ok}/${items.length} 썸네일 가용\n`);

  // 시드 레지스트리 타일들
  const seed = JSON.parse(readFileSync(new URL("../data/registry.seed.json", import.meta.url), "utf8"));
  const sample = (seed.entries ?? []).slice(0, 6);
  console.log(`시드 타일 ${sample.length}개 썸네일 표본:`);
  let ok2 = 0;
  for (const e of sample) {
    const th = J(await client.callTool({ name: "asset_get_group_thumbnail", arguments: { ruid: e.ruid, groupCode: GROUP } }));
    const url = th?.thumbnail_url ?? th?.thumbnailUrl ?? null;
    if (url) ok2++;
    console.log(`  ${th?.available ? "✅" : "❌"} ${e.name.padEnd(14)} ${url ? url.slice(0, 80) : (th?.error || "")}`);
  }
  console.log(`→ 시드: ${ok2}/${sample.length} 썸네일 가용`);
} catch (e) {
  console.error("probe3 실패:", e?.message || e);
  process.exit(1);
} finally {
  await client.close().catch(() => {});
}
