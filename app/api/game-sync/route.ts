import { WorkspaceError } from "../../../src/server/gameWorkspace";
import { NextResponse } from "next/server";
import { assertLocalGameSyncRequest, GameSyncError, listGameMaps, runGameSync } from "../../../src/server/gameSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) },
    { status: error instanceof GameSyncError || error instanceof WorkspaceError ? error.status : 400 });
}

export async function GET(req: Request) {
  try {
    assertLocalGameSyncRequest(req);
    return NextResponse.json({ maps: listGameMaps() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  try {
    assertLocalGameSyncRequest(req);
    if (!req.headers.get("content-type")?.startsWith("application/json")) throw new GameSyncError("JSON 요청이 필요합니다.", 415);
    const maxBytes = 16 * 1024 * 1024;
    if (Number(req.headers.get("content-length")) > maxBytes) throw new GameSyncError("프로젝트가 너무 큽니다.", 413);
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new GameSyncError("프로젝트가 너무 큽니다.", 413);
    return NextResponse.json(await runGameSync(JSON.parse(text)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
