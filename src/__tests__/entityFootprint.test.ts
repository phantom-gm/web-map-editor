import { describe, it, expect } from "vitest";
import { entityFootprintCells, entityDisplayFootprintCells, offsetCellShift, type MapEntity } from "../types/entity";

// entityFootprintCells 는 **export/게임/충돌/sortOffset** 경로용 — build_map offset-정렬과 셀이
//   일치해야 한다(offset 큰 오브젝트에서 어긋나면 게임 정렬·충돌이 틀어진다).
//   ⚠ 에디터 캔버스 표시는 이제 entityDisplayFootprintCells(offset 무시, 앵커 고정)를 쓴다 —
//   아래 별도 describe 참고. 둘의 분리가 이번 수정의 핵심.
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

describe("entityDisplayFootprintCells — 에디터 표시(offset 무시, 앵커 고정)", () => {
  it("offset=0 이면 entityFootprintCells 와 동일", () => {
    const e = ent({ gx: 55, gy: 31, tilesW: 10, tilesH: 5 });
    expect(bounds(entityDisplayFootprintCells(e))).toEqual([46, 55, 27, 31]);
  });

  it("offset 이 있어도 앵커(gx,gy)에 고정 — offset 을 따라가지 않는다", () => {
    // entityFootprintCells 는 offset 으로 [45..54]×[28..32] 로 밀리지만(위 describe),
    //   표시용은 offset 을 무시하고 [46..55]×[27..31] 에 그대로 머문다. 이게 사용자 요구.
    const noOff = ent({ gx: 55, gy: 31, tilesW: 10, tilesH: 5 });
    const withOff = ent({ gx: 55, gy: 31, tilesW: 10, tilesH: 5, offsetX: -72, offsetY: 7 });
    expect(bounds(entityDisplayFootprintCells(withOff))).toEqual([46, 55, 27, 31]);
    expect(entityDisplayFootprintCells(withOff)).toEqual(entityDisplayFootprintCells(noOff));
    // 그리고 offset 정렬(export)과는 실제로 달라야 한다(분리 확인).
    expect(bounds(entityDisplayFootprintCells(withOff))).not.toEqual(bounds(entityFootprintCells(withOff)));
  });

  it("포탈은 footprint 없음", () => {
    expect(entityDisplayFootprintCells(ent({ kind: "portal" }))).toEqual([]);
  });
});
