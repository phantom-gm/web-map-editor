// 엔티티 화면 지오메트리 — 순수 함수(캔버스/스토어 비의존). WYSIWYG 보증의 핵심 수식이라
// CanvasGrid 에서 분리해 유닛으로 잠근다(OBJECT_PIVOT_ALIGNMENT.md §5 D3/D5).
import { footprintWH, renderWH, type MapEntity } from "../types/entity";
import { TW } from "./grid";

/**
 * 이미지 보유 엔티티의 화면 rect [x0,y0,x1,y1].
 * object: MSW 동형 — 이미지 중심 = 앵커 셀 중심 + offset. 폭 = renderW타일 × 배율
 *   (= export scale 이 만드는 게임 폭과 동일), 종횡비 native. MSW 에셋 기본 pivot=중심.
 * monster/npc: 프리뷰 billboard — footprint(W×H)를 덮고 전면 바닥-중앙 앵커(게임은 모델 스폰).
 * @param cx,cy 앵커 셀 다이아 중심(cellToScreen) / hw,hh 반타일 px / imgW,imgH native 치수
 */
export function entityImageRect(
  e: MapEntity,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  imgW: number,
  imgH: number,
): [number, number, number, number] {
  const mul = e.scaleMul && e.scaleMul > 0 ? e.scaleMul : 1;
  const zoom = hw / (TW / 2); // hw = TW/2·zoom → zoom 복원
  const ox = (e.offsetX ?? 0) * zoom;
  const oy = (e.offsetY ?? 0) * zoom;
  const [fw, fh] = renderWH(e); // 이미지 렌더 기준(baseW/H) — 점유(tilesW/H)와 분리
  const aspect = (imgH || 1) / (imgW || 1);
  if (e.kind === "object") {
    const wpx = fw * TW * zoom * mul; // = fw·2hw·mul
    const hpx = wpx * aspect;
    const bx = cx + ox, by = cy + oy;
    return [bx - wpx / 2, by - hpx / 2, bx + wpx / 2, by + hpx / 2];
  }
  const wpx = (fw + fh) * hw * mul;
  const hpx = wpx * aspect;
  const bx = cx + ((fw - fh) / 2) * hw + ox;
  const by = cy + (fw + fh - 1) * hh + oy;
  return [bx - wpx / 2, by - hpx, bx + wpx / 2, by];
}

// 게임(build_map)의 행당 order 간격. sortOffset 을 같은 척도로 섞어야 게임과 동일한 앞뒤가 됨.
const ORDER_PER_ROW = 10;

/**
 * 게임 z순서 미러(build_map 규칙) — 에디터 그리기·히트테스트가 게임과 같은 앞뒤가 되도록.
 * 밴드: below < auto(기본/비오브젝트) < above. 밴드 내 정렬키 = 앞줄(gy+tilesH−1)×10 + sortOffset
 *   (= 게임 order 의 밴드 내 값, ENTITY_BASE 제외). 동률이면 gx.
 */
export function byGameDepth(a: MapEntity, b: MapEntity): number {
  return bandRank(a) - bandRank(b) || orderKey(a) - orderKey(b) || a.gx - b.gx;
}

function bandRank(e: MapEntity): number {
  if (e.kind !== "object") return 1; // 몬스터/NPC/포탈 — 게임 엔티티 평면(auto 대)
  return e.layer === "below" ? 0 : e.layer === "above" ? 2 : 1;
}

// 밴드 내 정렬키 — build_map: order = ENTITY_BASE + frontBottomRow×PER_ROW + sortOffset.
function orderKey(e: MapEntity): number {
  return depthRow(e) * ORDER_PER_ROW + (e.sortOffset ?? 0);
}

function depthRow(e: MapEntity): number {
  if (e.kind !== "object") return e.gy;
  const [, fh] = footprintWH(e); // 정렬은 점유 footprint 기준(게임 build_map 과 동일)
  return e.gy + fh - 1;
}
