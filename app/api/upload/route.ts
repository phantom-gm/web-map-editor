// POST /api/upload — 미등록 타일 PNG 를 그룹 스토리지에 업로드(MCP create 2-step) → RUID
// → 레지스트리 append. 이미 등록된(레지스트리 매치) 타일은 건너뜀(멱등). 인증=공유시크릿(middleware).
//
// 요청: { tiles: [{ name, hash?, subcategory?, dataBase64 }] }
// 응답: { store, persisted, uploaded:[{name,ruid}], skipped:[...], failed:[...] }
export const runtime = "nodejs";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { parseRegistry, resolveTile } from "../../../src/lib/registry";
import { getStore, storeKind, type RegistryEntry } from "../../../src/server/registryStore";
import { withMcpClient, createSpriteResource } from "../../../src/server/mswMcp";
import { runPool } from "../../../src/lib/pool";

const UPLOAD_CONCURRENCY = 5;

interface UploadTile {
  name: string;
  hash?: string | null;
  subcategory?: string;
  dataBase64?: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { tiles?: UploadTile[] } | null;
  const tiles = body?.tiles;
  if (!Array.isArray(tiles) || tiles.length === 0) {
    return NextResponse.json({ error: "tiles 배열이 필요합니다." }, { status: 400 });
  }

  const store = getStore();
  const reg = parseRegistry({ entries: await store.getAll() });

  const uploaded: Array<{ name: string; ruid: string }> = [];
  const skipped: Array<{ name: string; ruid: string; reason: string }> = [];
  const failed: Array<{ name: string; error: string }> = [];
  const newEntries: RegistryEntry[] = [];

  // 1) 분류 — 업로드 대상(targets)만 추려낸다(네트워크 없음).
  const targets: Array<{ name: string; hash: string | null; subcategory?: string; bytes: Uint8Array }> = [];
  for (const t of tiles) {
    if (!t?.name) {
      failed.push({ name: String(t?.name), error: "name 누락" });
      continue;
    }
    const existing = resolveTile(reg, t.name, t.hash);
    if (existing.ruid) {
      skipped.push({ name: t.name, ruid: existing.ruid, reason: existing.status });
      continue;
    }
    if (!t.dataBase64) {
      failed.push({ name: t.name, error: "dataBase64 없음(신규인데 PNG 데이터 미제공)" });
      continue;
    }
    targets.push({
      name: t.name,
      hash: t.hash ?? null,
      subcategory: t.subcategory,
      bytes: new Uint8Array(Buffer.from(t.dataBase64, "base64")),
    });
  }

  // 2) 업로드 — 커넥션 1개 재사용 + 제한 동시성(JS 단일스레드라 push 안전).
  if (targets.length > 0) {
    await withMcpClient((client) =>
      runPool(UPLOAD_CONCURRENCY, targets.length, async (i) => {
        const t = targets[i];
        try {
          const { ruid } = await createSpriteResource(client, {
            name: t.name,
            subcategory: t.subcategory,
            bytes: t.bytes,
          });
          newEntries.push({ name: t.name, ruid, hash: t.hash });
          uploaded.push({ name: t.name, ruid });
        } catch (e) {
          failed.push({ name: t.name, error: e instanceof Error ? e.message : String(e) });
        }
      }),
    );
  }

  if (newEntries.length) await store.appendMany(newEntries);

  const kind = storeKind();
  return NextResponse.json({ store: kind, persisted: kind === "kv", uploaded, skipped, failed });
}
