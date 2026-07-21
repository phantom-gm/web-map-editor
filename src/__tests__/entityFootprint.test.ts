import { describe, it, expect } from "vitest";
import { entityFootprintCells, offsetCellShift, type MapEntity } from "../types/entity";

// entityFootprintCells 는 게임(build_map offset-정렬)과 셀이 일치해야 한다 — 에디터 점유 표시 =
//   게임 on-top(정렬) 영역 = 충돌 영역(WYSIWYG). offset 큰 오브젝트(다리)에서 어긋나면 사용자가
//   에디터에서 "위"로 저작한 셀이 게임에선 위로 안 올라온다(신고: 다리_B).
const ent = (p: Partial<MapEntity>): MapEntity => ({ id: "x", kind: "object", gx: 0, gy: 0, ...p });

const bounds = (cells: Array<[number, number]>) => {
  const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
};

describe("entityFootprintCells — offset 정렬(게임 일치)", () => {
  it("offset=0 이면 앵커에서 −방향(하위호환)", () => {
    const e = ent({ gx: 55, gy: 31, tilesW: 10, tilesH: 5 });
    expect(bounds(entityFootprintCells(e))).toEqual([46, 55, 27, 31]);
  });

  it("다리_B(offset −72,7): 게임 baked footprint [45..54]×[28..32] 와 일치", () => {
    // build_map offset-정렬: offCx≈−0.907→round −1, offCy≈+1.343→round +1 ⇒ 앵커(55,31)→tip(54,32)
    const e = ent({ gx: 55, gy: 31, tilesW: 10, tilesH: 5, offsetX: -72, offsetY: 7 });
    expect(bounds(entityFootprintCells(e))).toEqual([45, 54, 28, 32]);
  });

  it("난간크롭(10×1, 같은 offset): 앞줄 [45..54]×[32]", () => {
    const e = ent({ gx: 55, gy: 31, tilesW: 10, tilesH: 1, offsetX: -72, offsetY: 7 });
    expect(bounds(entityFootprintCells(e))).toEqual([45, 54, 32, 32]);
  });

  it("offsetCellShift 는 build_map offCx/offCy 수식과 동일(부호 규약 포함)", () => {
    const e = ent({ offsetX: -72, offsetY: 7 });
    const [dcx, dcy] = offsetCellShift(e);
    expect(dcx).toBeCloseTo(-0.907, 2);
    expect(dcy).toBeCloseTo(1.343, 2);
  });

  it("포탈은 footprint 없음", () => {
    expect(entityFootprintCells(ent({ kind: "portal" }))).toEqual([]);
  });
});
