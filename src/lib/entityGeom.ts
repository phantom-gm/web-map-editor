// 엔티티 화면 지오메트리 — 순수 함수(캔버스/스토어 비의존). WYSIWYG 보증의 핵심 수식이라
// CanvasGrid 에서 분리해 유닛으로 잠근다(OBJECT_PIVOT_ALIGNMENT.md §5 D3/D5).
import {
  footprintWH,
  renderWH,
  entityDisplayFootprintCells,
  GAME_TILE_HALF_H,
  PX_TO_WORLD,
  type MapEntity,
} from "../types/entity";
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

const CELL_DEPTH = GAME_TILE_HALF_H; // 0.14 = 셀 1칸당 world_y 변화량 (build_map CELL_DEPTH 와 동일)

/**
 * 게임 z 미러 — **작을수록 앞(위)**. build_map.cjs:392 와 같은 식이어야 WYSIWYG 이 성립한다.
 *
 *   game:   z = pos.y − sortOffset × CELL_DEPTH
 *           pos.y = cellToWorld(gx,gy).y + offset[1]
 *                 = −(gx+gy)×CELL_DEPTH  +  (−offsetY_px × PX_TO_WORLD)
 *
 * 맵 shift·ORIGIN 은 모든 엔티티에 같은 상수라 **상대 순서에서 상쇄** → 여기선 생략한다.
 *
 * ⚠ 2026-07-24 이전 에디터는 `앞줄(gy+tilesH−1)×10 + sortOffset` 을 썼는데 게임과 4군데 어긋났다
 *   (실제 배치 데이터로 대조 확인):
 *     1) 깊이축: 게임 gx+gy ↔ 에디터 gy 만(gx 는 동률 타이브레이크) → 다른 행끼리 앞뒤 역전
 *     2) sortOffset 척도: 게임 1 = **한 칸** ↔ 에디터 1 = 0.1행 → 10배 과소, 통짜 앞/뒤 전환 불가
 *     3) offsetY: 게임 pos.y 에 포함 ↔ 에디터 무시 → offset 큰 에셋(다리 등) 어긋남
 *     4) 앵커: 앵커(gx,gy)가 이미 **앞-아래 tip**(entityFootprintCells)인데 +tilesH−1 을 더 밀었다
 *   → 기획자가 sortOffset 을 돌려도 에디터에선 거의 안 변하고 게임에선 한 칸씩 튀었다.
 *   요구(사용자 확정 2026-07-24): "벽(멀티셀) vs 화분(1×1)은 **통짜로** 앞이거나 뒤. offset 이 높으면
 *   화분이 벽 앞, 낮으면 벽에 가려진다" — 게임이 이미 그렇게 돈다. 에디터가 그걸 그대로 보여주면 끝.
 */
export function gameDepthZ(e: MapEntity): number {
  return (
    -(e.gx + e.gy) * CELL_DEPTH
    - (e.offsetY ?? 0) * PX_TO_WORLD // export 부호 규약(화면 아래+ → world 위+)
    - (e.sortOffset ?? 0) * CELL_DEPTH
  );
}

/**
 * 게임 z순서 미러(build_map 규칙) — 에디터 그리기·히트테스트가 게임과 같은 앞뒤가 되도록.
 * 밴드: below(−999) < auto(기본/비오브젝트) < above(4000) = 게임 OrderInLayer.
 *   밴드 내는 **z 내림차순**(큰 z = 뒤 = 먼저 그림). 동률이면 gx.
 */
export function byGameDepth(a: MapEntity, b: MapEntity): number {
  return bandRank(a) - bandRank(b) || gameDepthZ(b) - gameDepthZ(a) || a.gx - b.gx;
}

function bandRank(e: MapEntity): number {
  if (e.kind !== "object") return 1; // 몬스터/NPC/포탈 — 게임 엔티티 평면(auto 대)
  return e.layer === "below" ? 0 : e.layer === "above" ? 2 : 1;
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
 *   구현: 오브젝트(멀티셀) 표시 footprint 안에 선 비-object 엔티티의 실효 z 를 그 오브젝트보다
 *   **반 칸 앞**(z − CELL_DEPTH/2)으로 끌어내린다. 표시용(entityDisplayFootprintCells, 앵커 고정)을
 *   써서 에디터가 보여주는 점유와 일치시킨다. O(엔티티×오브젝트) — 에디터 규모에선 무시.
 *
 * ⚠ 이 보정은 **비-object 엔티티에만** 적용된다. 오브젝트끼리는 게임과 똑같이 순수 z 로만 정렬한다
 *   — 게임에도 오브젝트용 런타임 깊이보정이 없기 때문(build_map 이 z 를 굽고 끝). 오브젝트가 큰
 *   건물 뒤로 숨는 게 싫으면 기획자가 sortOffset(1 = 한 칸)으로 통짜로 앞에 세운다.
 */
export function sortEntitiesForDraw(entities: MapEntity[]): MapEntity[] {
  const objRects = entities
    .filter((e) => e.kind === "object" && (footprintWH(e)[0] > 1 || footprintWH(e)[1] > 1))
    .map((e) => ({ rect: displayRect(e), z: gameDepthZ(e) }));

  const effZ = (e: MapEntity): number => {
    if (e.kind === "object") return gameDepthZ(e);
    let z = gameDepthZ(e);
    for (const o of objRects) {
      if (insideRect(o.rect, e.gx, e.gy)) z = Math.min(z, o.z - CELL_DEPTH * 0.5);
    }
    return z;
  };

  return [...entities].sort(
    (a, b) => bandRank(a) - bandRank(b) || effZ(b) - effZ(a) || a.gx - b.gx,
  );
}
