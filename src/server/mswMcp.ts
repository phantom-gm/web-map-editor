// msw-mcp.nexon.com/mcp 의 MCP 클라이언트 래퍼(서버 전용).
// 선검증 완료: 순수 Node 가 @modelcontextprotocol/sdk StreamableHTTPClientTransport 로
// connect/listTools/callTool 가능(read-only 왕복 증명). 업로드는 create 2-step + presigned PUT.
//
// 성능: 커넥션은 withMcpClient 로 1개 열어 배치 전체에서 재사용한다(타일마다 새로 열지 않음).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.MSW_MCP_URL || "https://msw-mcp.nexon.com/mcp";
const GROUP = process.env.MSW_GROUP_CODE || "43bIK";
const PUT_TIMEOUT_MS = 15000;

function authHeader(): string {
  const t = (process.env.MSW_MCP_TOKEN || "").trim();
  if (!t) throw new Error("MSW_MCP_TOKEN 환경변수가 없습니다.");
  return t.startsWith("Bearer ") ? t : `Bearer ${t}`;
}

/** MCP 클라이언트 1개를 열어 fn 에 넘기고 닫는다. 배치 업로드는 이 안에서 callTool 을 재사용. */
export async function withMcpClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: authHeader() } },
  });
  const client = new Client({ name: "web-map-editor-backend", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

// callTool 결과의 text content 를 JSON 파싱.
function parseToolJson(res: unknown): unknown {
  const content = (res as { content?: Array<{ type: string; text?: string }> })?.content;
  const text = content?.find((c) => c.type === "text")?.text ?? "";
  return text ? JSON.parse(text) : null;
}

// 중첩 객체에서 키 후보를 깊이우선 탐색(응답 필드명이 불확실할 때 방어적).
function deepFind(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (keys.includes(k) && typeof v === "string" && v) return v;
    if (v && typeof v === "object") {
      const found = deepFind(v, keys);
      if (found) return found;
    }
  }
  return null;
}

export interface CreateResult {
  ruid: string;
}

/**
 * 열린 client 로 sprite 1개 업로드(2-step). 배치에서 client 를 재사용해 호출.
 * ⚠ 신규 업로드 실경로는 외부 동작 — 첫 실호출 시 응답 필드명 검증 필요.
 * step1: fileUrl 생략 → presignedUrl. PUT bytes(raw). step2: fileUrl=presignedUrl → RUID.
 */
export async function createSpriteResource(
  client: Client,
  args: { name: string; description?: string; subcategory?: string; bytes: Uint8Array },
): Promise<CreateResult> {
  const subcategory = args.subcategory || "object";
  const description = args.description ?? `web-map-editor tile ${args.name}`;
  const contentLength = args.bytes.byteLength;

  // step1 — presignedUrl
  const step1 = await client.callTool({
    name: "asset_create_group_resource_storage_item",
    arguments: { groupCode: GROUP, category: "sprite", subcategory, name: args.name, description, contentLength },
  });
  const j1 = parseToolJson(step1);
  const presignedUrl = deepFind(j1, ["presignedUrl", "presignedURL", "uploadUrl", "url"]);
  if (!presignedUrl) throw new Error("step1: presignedUrl 을 찾지 못함 — 응답: " + JSON.stringify(j1).slice(0, 300));

  // PUT raw bytes (인증헤더 없음). Uint8Array 로 보내 Content-Length 모호성 제거. 타임아웃 적용.
  const put = await fetch(presignedUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(contentLength) },
    // undici(Node fetch)는 Uint8Array body 의 Content-Length 를 byteLength 로 정확히 잡는다.
    // DOM lib 의 BodyInit 타입만 좁아 cast(런타임 안전).
    body: args.bytes as unknown as BodyInit,
    signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
  });
  if (!put.ok) throw new Error(`presigned PUT 실패: ${put.status}`);

  // step2 — finalize → RUID
  const step2 = await client.callTool({
    name: "asset_create_group_resource_storage_item",
    arguments: {
      groupCode: GROUP,
      category: "sprite",
      subcategory,
      name: args.name,
      description,
      contentLength,
      fileUrl: presignedUrl,
    },
  });
  const j2 = parseToolJson(step2);
  const ruid = deepFind(j2, ["ruid", "guid", "resource_guid", "resourceGuid"]);
  if (!ruid) throw new Error("step2: RUID 를 찾지 못함 — 응답: " + JSON.stringify(j2).slice(0, 300));
  return { ruid };
}
