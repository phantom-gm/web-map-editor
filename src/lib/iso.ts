// 엔진 IsoProjectLogic 미러 — 아이소 프리뷰 + round-trip 검증용. 상수/공식 동일하게 유지.
// (MVP 편집뷰는 grid.ts(정사각)를 쓰고, 이 모듈은 Phase 2+ 프리뷰/단위테스트에서 사용)
export const TILE_W = 0.56;
export const TILE_H = 0.28;
export const ORIGIN_X = 15;
export const ORIGIN_Y = 15;

/** 셀 → world(2D). 엔진 CellToWorld2D 와 동일. */
export function cellToWorld(gx: number, gy: number): [number, number] {
  const relX = gx - ORIGIN_X;
  const relY = gy - ORIGIN_Y;
  return [(relX - relY) * TILE_W * 0.5, -(relX + relY) * TILE_H * 0.5];
}

/** world → 셀(정수). 엔진 WorldToCellInt 와 동일. */
export function worldToCellInt(sx: number, sy: number): [number, number] {
  const a = sx / (TILE_W * 0.5); // = relX - relY
  const b = -sy / (TILE_H * 0.5); // = relX + relY
  const relX = (a + b) * 0.5;
  const relY = (b - a) * 0.5;
  return [Math.floor(relX + ORIGIN_X), Math.floor(relY + ORIGIN_Y)];
}
