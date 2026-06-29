// POST /api/resolve — 팔레트 타일(name[, hash]) → 레지스트리 조회로 등록/신규 판정.
// 존재확인은 라이브 이름검색이 아니라 권위 레지스트리(name↔RUID). 인증=공유시크릿(middleware).
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { parseRegistry, resolveTile } from "../../../src/lib/registry";
import { getStore, storeKind } from "../../../src/server/registryStore";

interface TileReq {
  name: string;
  hash?: string | null;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { tiles?: TileReq[] } | null;
  const tiles = body?.tiles;
  if (!Array.isArray(tiles)) {
    return NextResponse.json({ error: "tiles 배열이 필요합니다." }, { status: 400 });
  }
  const entries = await getStore().getAll();
  const reg = parseRegistry({ entries });
  const results = tiles.map((t) => {
    const r = resolveTile(reg, t.name, t.hash);
    return { name: t.name, status: r.status, ruid: r.ruid ?? null };
  });
  const registered = results.filter((r) => r.ruid).length;
  return NextResponse.json({ store: storeKind(), count: results.length, registered, results });
}
