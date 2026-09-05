// POST /api/images — RUID 배치 → 실제 PNG(dataURL). 프로젝트 파일 v2 가 base64 를 안 갖는 대신
// 에디터가 이 경로로 이미지를 복원한다(MAP_PROJECT_ASSET_REFERENCE_PLAN.md §7.1 2단계).
//
// 왜 배치인가: 맵 하나에 팔레트가 200개를 넘는다. RUID 하나씩 열면 MCP 커넥션·목록조회가 그만큼
//   반복된다. 배치로 받아 (1) modPath 를 한 번에 해결하고 (2) .mod 다운로드만 동시 실행한다.
//
// 요청: { ruids: string[] }
// 응답: { images: { <ruid>: "data:image/png;base64,…" | null }, resolved, missing }
//   값이 null = 그룹 스토리지에서 못 찾음(삭제됐거나 다른 그룹) → 에디터는 폴백 스와치를 그린다.
export const runtime = "nodejs";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { withMcpClient, listGroupResources, fetchSpritePngBase64 } from "../../../src/server/mswMcp";
import { getModPathStore } from "../../../src/server/modPathStore";
import { runPool } from "../../../src/lib/pool";

const IMG_CONCURRENCY = 8;
const MAX_RUIDS = 500; // 요청당 상한 — .mod fetch 증폭 방지
const SWEEP_PAGE = 100; // 목록조회 1페이지 크기
const SWEEP_MAX_PAGES = 40; // 4000개까지 훑고 포기(무한 페이지네이션 방어)

/**
 * 캐시에 없는 RUID 들의 modPath 를 그룹 목록 전체 훑기로 알아낸다.
 * 이름 검색(searchWord)을 RUID마다 돌리는 것보다 호출 수가 훨씬 적다 —
 *   240개 미해결이면 검색 240회 vs 훑기 ~3페이지.
 * 원하는 걸 다 찾으면 즉시 중단한다.
 */
async function sweepModPaths(wanted: Set<string>): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  await withMcpClient(async (client) => {
    let cursor: string | null = null;
    for (let page = 0; page < SWEEP_MAX_PAGES; page++) {
      const res = await listGroupResources(client, {
        subcategory: "all",
        count: SWEEP_PAGE,
        cursor,
      });
      for (const it of res.items) {
        if (it.ruid && it.modPath && wanted.has(it.ruid)) {
          found[it.ruid] = it.modPath;
          wanted.delete(it.ruid);
        }
      }
      if (wanted.size === 0 || !res.nextCursor) break;
      cursor = res.nextCursor;
    }
  });
  return found;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { ruids?: unknown } | null;
  const raw = Array.isArray(body?.ruids) ? body.ruids : null;
  if (!raw) return NextResponse.json({ error: "ruids 배열이 필요합니다." }, { status: 400 });

  const ruids = [...new Set(raw.filter((r): r is string => typeof r === "string" && r.length > 0))].slice(0, MAX_RUIDS);
  if (ruids.length === 0) return NextResponse.json({ images: {}, resolved: 0, missing: 0 });

  try {
    // 1) modPath 캐시 → 미스만 목록조회로 해결(그리고 캐시에 적재).
    const store = getModPathStore();
    const cached = await store.getAll();
    const miss = new Set(ruids.filter((r) => !cached[r]));
    let discovered: Record<string, string> = {};
    if (miss.size > 0) {
      discovered = await sweepModPaths(new Set(miss));
      if (Object.keys(discovered).length > 0) await store.putMany(discovered);
    }
    const modPathOf = (r: string) => discovered[r] ?? cached[r] ?? null;

    // 2) .mod → 임베드 PNG 추출(제한 동시성). 실패/미보유는 null.
    const images: Record<string, string | null> = {};
    await runPool(IMG_CONCURRENCY, ruids.length, async (i) => {
      const ruid = ruids[i];
      const p = modPathOf(ruid);
      if (!p) {
        images[ruid] = null;
        return;
      }
      const b64 = await fetchSpritePngBase64(p);
      images[ruid] = b64 ? `data:image/png;base64,${b64}` : null;
    });

    const resolved = Object.values(images).filter(Boolean).length;
    return NextResponse.json(
      { images, resolved, missing: ruids.length - resolved },
      // RUID 는 내용-불변이라 응답을 영구 캐시해도 안전(브라우저/CDN).
      { headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
