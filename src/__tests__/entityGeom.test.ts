import { describe, it, expect } from "vitest";
import { byGameDepth, gameDepthZ, entityImageRect, entityPivot } from "../lib/entityGeom";
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

// 계약: 에디터 정렬키 = 게임 z(build_map.cjs:392) 를 그대로 미러한다.
//   z = pos.y − sortOffset×0.14,  pos.y = −(gx+gy)×0.14 − offsetY_px×PX_TO_WORLD.  작을수록 앞(위).
// 이 describe 가 그 등가성을 잠근다 — 하나라도 어긋나면 기획자가 에디터에서 본 앞뒤가 게임에서 달라진다.
describe("byGameDepth / gameDepthZ — 게임 z 미러", () => {
  const CELL = 0.14;

  it("밴드: below < auto < above (깊이 무관)", () => {
    const below = ent({ layer: "below", gy: 99 });
    const auto = ent({ gy: 0 });
    const above = ent({ layer: "above", gy: 0 });
    expect(byGameDepth(below, auto)).toBeLessThan(0);
    expect(byGameDepth(auto, above)).toBeLessThan(0);
  });

  it("z 식이 build_map 과 같다 — −(gx+gy)·0.14 − offsetY·PX_TO_WORLD − sortOffset·0.14", () => {
    expect(gameDepthZ(ent({ gx: 3, gy: 4 }))).toBeCloseTo(-7 * CELL, 6);
    expect(gameDepthZ(ent({ gx: 3, gy: 4, sortOffset: 2 }))).toBeCloseTo(-9 * CELL, 6);
    // offsetY 64px = 한 타일 = 0.56 world (PX_TO_WORLD = 0.56/64)
    expect(gameDepthZ(ent({ gx: 3, gy: 4, offsetY: 64 }))).toBeCloseTo(-7 * CELL - 0.56, 6);
  });

  it("깊이축은 gx+gy — gy 만 보면 안 된다(구 버그 #1)", () => {
    const east = ent({ id: "east", gx: 10, gy: 0 }); // 깊이 10 → 앞
    const south = ent({ id: "south", gx: 0, gy: 5 }); // 깊이 5 → 뒤
    expect(byGameDepth(south, east)).toBeLessThan(0); // east 가 나중에(위에) 그려짐
  });

  it("sortOffset 1 = 정확히 한 칸(구 버그 #2: 0.1행이 아니다)", () => {
    const a = ent({ gx: 5, gy: 5, sortOffset: 1 }); // 깊이 10 + 1칸
    const b = ent({ gx: 5, gy: 6 }); // 깊이 11
    expect(gameDepthZ(a)).toBeCloseTo(gameDepthZ(b), 6); // 정확히 동률
    const a2 = ent({ gx: 5, gy: 5, sortOffset: 2 });
    expect(byGameDepth(b, a2)).toBeLessThan(0); // 2칸 올리면 한 칸 앞 오브젝트를 앞지른다
  });

  it("offsetY 가 정렬에 반영된다(구 버그 #3)", () => {
    const plain = ent({ id: "p", gx: 5, gy: 5 });
    const nudged = ent({ id: "n", gx: 5, gy: 5, offsetY: 32 }); // 화면 아래로 → 앞
    expect(byGameDepth(plain, nudged)).toBeLessThan(0);
  });

  it("tilesH 는 깊이를 밀지 않는다 — 앵커(gx,gy)가 이미 앞-아래 tip(구 버그 #4)", () => {
    expect(gameDepthZ(ent({ gx: 5, gy: 5, tilesH: 1 })))
      .toBeCloseTo(gameDepthZ(ent({ gx: 5, gy: 5, tilesH: 4 })), 6);
  });

  it("몬스터/포탈도 같은 깊이축(auto 대)", () => {
    const mob = ent({ kind: "monster", gx: 0, gy: 4 }); // 깊이 4
    const obj = ent({ gx: 0, gy: 5 }); // 깊이 5 → 앞
    expect(byGameDepth(mob, obj)).toBeLessThan(0);
  });
});
