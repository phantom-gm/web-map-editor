import { NextResponse } from "next/server";
import { assertLocalGameSyncRequest, downloadGameCandidate, GameSyncError } from "../../../../src/server/gameSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertLocalGameSyncRequest(req);
    if (!req.headers.get("content-type")?.startsWith("application/json")) throw new GameSyncError("JSON 요청이 필요합니다.", 415);
    const maxBytes = 8 * 1024;
    if (Number(req.headers.get("content-length")) > maxBytes) throw new GameSyncError("후보 ID 요청이 너무 큽니다.", 413);
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new GameSyncError("후보 ID 요청이 너무 큽니다.", 413);
    const result = await downloadGameCandidate(JSON.parse(text));
    return new Response(new Uint8Array(result.bytes), { headers: {
      "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="' + result.filename + '"',
      "Content-Length": String(result.bytes.length), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const review = error && typeof error === "object" && "review" in error ? error.review : undefined;
    return NextResponse.json({ error: message, ...(review ? { review } : {}) }, {
      status: error instanceof GameSyncError ? error.status : 400, headers: { "Cache-Control": "no-store" },
    });
  }
}
