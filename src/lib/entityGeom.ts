// 엔티티 화면 지오메트리 — 순수 함수(캔버스/스토어 비의존). WYSIWYG 보증의 핵심 수식이라
// CanvasGrid 에서 분리해 유닛으로 잠근다(OBJECT_PIVOT_ALIGNMENT.md §5 D3/D5).
import { footprintWH, renderWH, entityDisplayFootprintCells, type MapEntity } from "../types/entity";
import { TW } from "./grid";

/**
 * 이미지 보유 엔티티의 화면 rect [x0,y0,x1,y1]. 모든 kind 가 **바닥-중앙(bottom-center) 앵커** —
 * 즉 (bx, by) 가 이미지의 아래-가운데 점이고, 이미지는 그 위로 뻗는다.
 *
 * object: MSW 동형 — 오브젝트 에셋의 pivot 이 **bottom-center** 로 통일됐다(구: 중심).
 *   게임은 스프라이트를 앵커 셀 world 좌표에 놓으므로, pivot=bottom-center 면 이미지 바닥이
 *   그 셀에 닿고 위로 선다(나무·집이 지면에 서는 자연스러운 배치). 에디터도 동일하게 그린다.
 *   폭 = renderW타일 × 배율(= export scale 이 만드는 게임 폭), 종횡비 native.
 *   ⚠ pivot 은 에셋 속성이라 배치/export 수식(scale·offset)에는 영향 없음 — 그리는 위치만 바뀐다.
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
  // 폭과 바닥점만 kind 별로 다르고, "바닥-중앙 앵커" 규약은 공통.
  let wpx: number, bx: number, by: number;
  if (e.kind === "object") {
    wpx = fw * TW * zoom * mul; // = fw·2hw·mul
    bx = cx + ox;
    by = cy + oy; // 앵커 셀 다이아 중심에 이미지 바닥이 닿는다
  } else {
    wpx = (fw + fh) * hw * mul;
    bx = cx + ((fw - fh) / 2) * hw + ox;
    by = cy + (fw + fh - 1) * hh + oy; // footprint 전면 바닥
  }
  const hpx = wpx * aspect;
  return [bx - wpx / 2, by - hpx, bx + wpx / 2, by];
}

/**
 * 회전·좌우반전의 기준점(= 이미지 pivot) 화면 좌표. draw 와 히트테스트가 반드시 같은 값을 써야
 * WYSIWYG·클릭이 어긋나지 않는다. 모든 kind 가 바닥-중앙이므로 rect 하단-가운데가 곧 pivot.
 */
export function entityPivot(rect: [number, number, number, number]): [number, number] {
  const [x0, , x1, y1] = rect;
  return [(x0 + x1) / 2, y1];
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

interface Rect { gx: number; gy: number; ax: number; ay: number }
function displayRect(e: MapEntity): Rect {
  let gx = Infinity, gy = Infinity, ax = -Infinity, ay = -Infinity;
  for (const [x, y] of entityDisplayFootprintCells(e)) {
    if (x < gx) gx = x; if (y < gy) gy = y; if (x > ax) ax = x; if (y > ay) ay = y;
  }
  return { gx, gy, ax, ay };
}
const insideRect = (r: Rect, cx: number, cy: number) =>
  cx >= r.gx && cy >= r.gy && cx <= r.ax && cy <= r.ay;

/**
 * 그리기 순서 — byGameDepth 에 **오브젝트 점유(footprint) 위 엔티티는 그 위로** 규칙을 더한 것.
 *   게임 IsoPlayerDepthLogic/MonsterAppearanceComponent 가 플레이어·몬스터·NPC 를 큰 건물 footprint
 *   안에서 앞(위)으로 올리는 것과 동일한 시각을 에디터에 재현한다(WYSIWYG). 오브젝트끼리·엔티티끼리는
 *   기존 byGameDepth 그대로.
 *   구현: 오브젝트(멀티셀) 표시 footprint 안에 선 비-object 엔티티의 실효 depthRow 를 그 오브젝트
 *   앞줄(+0.5)로 끌어올린다. 표시용(entityDisplayFootprintCells, 앵커 고정)을 써서 에디터가 보여주는
 *   점유와 일치시킨다. O(엔티티×오브젝트) — 에디터 규모에선 무시.
 */
export function sortEntitiesForDraw(entities: MapEntity[]): MapEntity[] {
  const objRects = entities
    .filter((e) => e.kind === "object" && (footprintWH(e)[0] > 1 || footprintWH(e)[1] > 1))
    .map((e) => ({ rect: displayRect(e), frontRow: depthRow(e) }));

  const effRow = (e: MapEntity): number => {
    if (e.kind === "object") return depthRow(e);
    let row = e.gy;
    for (const o of objRects) {
      if (insideRect(o.rect, e.gx, e.gy) && o.frontRow + 0.5 > row) row = o.frontRow + 0.5;
    }
    return row;
  };
  const key = (e: MapEntity) => effRow(e) * ORDER_PER_ROW + (e.sortOffset ?? 0);

  return [...entities].sort(
    (a, b) => bandRank(a) - bandRank(b) || key(a) - key(b) || a.gx - b.gx,
  );
}
