import { describe, it, expect } from "vitest";
import { byGameDepth, entityImageRect, entityPivot } from "../lib/entityGeom";
import { TW, TH } from "../lib/grid";
import type { MapEntity } from "../types/entity";

// WYSIWYG 핵심 수식 잠금(OBJECT_PIVOT_ALIGNMENT.md §5 D3/D5).
const HW = TW / 2, HH = TH / 2; // zoom=1

const ent = (p: Partial<MapEntity>): MapEntity => ({ id: "x", kind: "object", gx: 0, gy: 0, ...p });

describe("entityImageRect — object (MSW 동형: bottom-center pivot @ 앵커 셀)", () => {
  it("이미지 바닥-중앙 = 앵커 셀 중심, 폭 = renderW타일, 종횡비 native", () => {
    const e = ent({ baseW: 3, baseH: 1, tilesW: 5, tilesH: 4 }); // 점유≠렌더 — 렌더는 baseW
    const [x0, y0, x1, y1] = entityImageRect(e, 100, 50, HW, HH, 200, 100);
    expect((x0 + x1) / 2).toBeCloseTo(100); // 바닥-중앙 x = 앵커
    expect(y1).toBeCloseTo(50); // 바닥 y = 앵커 (bottom-center pivot) — 이미지는 위로 뻗는다
    expect(x1 - x0).toBeCloseTo(3 * TW); // 폭 = baseW(3)타일 — 점유(5) 아님
    expect(y1 - y0).toBeCloseTo(3 * TW * 0.5); // 높이 = 폭 × 100/200
    expect(y0).toBeCloseTo(50 - 3 * TW * 0.5); // 위쪽으로만 자란다(아래로 안 내려감)
  });

  it("offset(px)·배율이 바닥점·폭에 반영 (zoom=hw/(TW/2) 복원)", () => {
    const e = ent({ baseW: 2, baseH: 1, offsetX: 10, offsetY: -4, scaleMul: 1.5 });
    const zoom = 2; // hw=TW/2*2
    const [x0, y0, x1, y1] = entityImageRect(e, 0, 0, HW * zoom, HH * zoom, 100, 100);
    expect((x0 + x1) / 2).toBeCloseTo(10 * zoom);
    expect(y1).toBeCloseTo(-4 * zoom); // 바닥점이 offset 만큼 이동
    expect(x1 - x0).toBeCloseTo(2 * TW * zoom * 1.5);
    expect(y0).toBeCloseTo(-4 * zoom - (2 * TW * zoom * 1.5)); // 종횡비 1 → 높이 = 폭
  });

  it("monster 는 기존 billboard 유지(전면 바닥-중앙 앵커) — 회귀", () => {
    const e = ent({ kind: "monster", tilesW: 2, tilesH: 1 });
    const [x0, y0, x1, y1] = entityImageRect(e, 0, 0, HW, HH, 100, 100);
    expect(y1).toBeCloseTo((2 + 1 - 1) * HH); // 바닥 = footprint 전면
    expect((x0 + x1) / 2).toBeCloseTo(((2 - 1) / 2) * HW); // 바닥-중앙 x
    expect(y1 - y0).toBeCloseTo(x1 - x0); // 종횡비 1
  });

  it("entityPivot = rect 하단-가운데 — draw/히트테스트가 공유하는 회전 기준점", () => {
    const e = ent({ baseW: 2, baseH: 1 });
    const rect = entityImageRect(e, 40, 20, HW, HH, 100, 100);
    expect(entityPivot(rect)).toEqual([(rect[0] + rect[2]) / 2, rect[3]]);
    expect(entityPivot(rect)[1]).toBeCloseTo(20); // = 앵커 셀 중심 y
  });
});

describe("byGameDepth — 게임 z순서 미러(밴드 + 앞줄)", () => {
  it("밴드: below < auto < above (행 무관)", () => {
    const below = ent({ layer: "below", gy: 99 });
    const auto = ent({ gy: 0 });
    const above = ent({ layer: "above", gy: 0 });
    expect(byGameDepth(below, auto)).toBeLessThan(0);
    expect(byGameDepth(auto, above)).toBeLessThan(0);
  });

  it("밴드 내 object 는 앞줄(gy+tilesH−1) — tilesH 큰 쪽이 앞", () => {
    const shallow = ent({ gy: 5, tilesH: 1 }); // 앞줄 5
    const deep = ent({ gy: 3, tilesH: 4 }); // 앞줄 6 → 더 앞(나중에 그림)
    expect(byGameDepth(shallow, deep)).toBeLessThan(0);
  });

  it("겹침 tiebreak: 같은 앞줄이면 sortOffset 큰 쪽이 앞(위) — 게임 order 미러", () => {
    const lo = ent({ id: "lo", gy: 5, tilesH: 1, sortOffset: 0 });
    const hi = ent({ id: "hi", gy: 5, tilesH: 1, sortOffset: 3 });
    expect(byGameDepth(lo, hi)).toBeLessThan(0); // hi 가 나중에(앞에) 그려짐
    // sortOffset ≥ 10 이면 한 줄 넘어 앞행 오브젝트도 앞지름(build_map 과 동일)
    const back = ent({ gy: 4, tilesH: 1, sortOffset: 15 }); // 키 55
    const front = ent({ gy: 5, tilesH: 1, sortOffset: 0 }); // 키 50
    expect(byGameDepth(front, back)).toBeLessThan(0);
  });

  it("몬스터/포탈은 gy 기준(auto 대)", () => {
    const mob = ent({ kind: "monster", gy: 4 });
    const obj = ent({ gy: 5, tilesH: 1 }); // 앞줄 5
    expect(byGameDepth(mob, obj)).toBeLessThan(0);
  });
});
