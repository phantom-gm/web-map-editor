// 읽기 전용 probe: MSW MCP 에 connect → listTools → 툴 목록/스키마 출력.
// 자산 생성/변경 없음(callTool 미호출). 토큰은 .env 에서 로드.
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// .env 간단 파서(값에 = 포함 대비 first-split)
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const MCP_URL = env.MSW_MCP_URL || "https://msw-mcp.nexon.com/mcp";
let token = (env.MSW_MCP_TOKEN || "").trim();
if (!token) { console.error("MSW_MCP_TOKEN 없음"); process.exit(1); }
if (!token.startsWith("Bearer ")) token = `Bearer ${token}`;

const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
  requestInit: { headers: { Authorization: token } },
});
const client = new Client({ name: "web-map-editor-probe", version: "0.0.1" }, { capabilities: {} });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`\n총 ${tools.length}개 툴\n`);
  const readish = [];
  for (const t of tools) {
    const name = t.name;
    const isRead = /get|list|read|download|fetch|search|find|query|resource/i.test(name);
    console.log(`${isRead ? "🔎" : "  "} ${name}`);
    console.log(`     ${(t.description || "").slice(0, 120).replace(/\n/g, " ")}`);
    if (isRead) readish.push(t);
  }
  console.log(`\n\n===== 읽기/조회 후보 ${readish.length}개 상세(inputSchema) =====`);
  for (const t of readish) {
    console.log(`\n## ${t.name}`);
    console.log(`desc: ${t.description || ""}`);
    const props = t.inputSchema?.properties || {};
    console.log(`args: ${Object.keys(props).join(", ") || "(none)"}`);
    console.log(JSON.stringify(t.inputSchema?.properties ?? {}, null, 2).slice(0, 1500));
  }
} catch (e) {
  console.error("probe 실패:", e?.message || e);
  process.exit(1);
} finally {
  await client.close().catch(() => {});
}
