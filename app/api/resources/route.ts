// POST /api/resources — 그룹 소유 리소스 목록(읽기 전용) + 각 리소스의 실제 PNG 이미지.
// 이미지는 .mod 바이너리(CDN)에서 임베드 PNG 를 추출해 dataURL 로 반환한다(정적 스프라이트는
// 서버 썸네일이 없어 이 경로가 유일하게 신뢰 가능). 인증=공유시크릿(middleware). 자산 변경 없음.
//
// 요청: { category?, subcategory?, count?, searchWord?, cursor? }
// 응답: { items:[{ ruid, name, subcategory, imageUrl|null }], nextCursor }
//   imageUrl = "data:image/png;base64,..." (추출 성공) 또는 null(실패/미보유)
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { withMcpClient, listGroupResources, fetchSpritePngBase64 } from "../../../src/server/mswMcp";
import { runPool } from "../../../src/lib/pool";

const IMG_CONCURRENCY = 8;
const MAX_COUNT = 100; // .mod fetch 증폭 방지 — 클라이언트 입력 상한

interface Body {
  category?: string;
  subcategory?: string;
  count?: number;
  searchWord?: string | null;
  cursor?: string | null;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const count = Math.min(Math.max(1, body?.count ?? 24), MAX_COUNT);

  try {
    // 1) 목록 조회(MCP). 커넥션은 목록에만 쓰고 닫는다 — 이미지(.mod)는 일반 HTTP.
    const { items, nextCursor } = await withMcpClient((client) =>
      listGroupResources(client, {
        category: body?.category,
        subcategory: body?.subcategory,
        count,
        searchWord: body?.searchWord ?? null,
        cursor: body?.cursor ?? null,
      }),
    );

    // 2) 각 리소스 .mod → 임베드 PNG 추출(제한 동시성). 실패는 null.
    const images = new Array<string | null>(items.length).fill(null);
    await runPool(IMG_CONCURRENCY, items.length, async (i) => {
      const modPath = items[i].modPath;
      if (!modPath) return;
      const b64 = await fetchSpritePngBase64(modPath);
      if (b64) images[i] = `data:image/png;base64,${b64}`;
    });

    return NextResponse.json({
      items: items.map((it, i) => ({
        ruid: it.ruid,
        name: it.name,
        subcategory: it.subcategory,
        imageUrl: images[i],
      })),
      nextCursor,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
