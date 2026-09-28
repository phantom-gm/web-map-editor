import { describe, it, expect } from "vitest";
import { isSortGateTarget, sortGatePx } from "../lib/sortGate";
import type { MapEntity } from "../types/entity";

// 게임 기준값 — legend_of_light scripts/depth_check.cjs deriveGeom 으로 ferendel.map 의 여관(Obj_0d2a1f5c)을 잰 값(2026-09-28).
//   앵커 셀 (14,9) world = (6.4, 4.48). 에디터 1px = 게임 2.56/64 = 0.04u, 화면 아래 = world 아래.
const GAME = {
  anchorX: 6.4,
  anchorY: 4.48,
  pad2: { gateX0: -11.333394285714284, gateX1: 22.533394285714287 },
  pad0: { gateX0: -6.2134, gateX1: 17.4134 },
  // Load 의 gateY0/1 = pos.y ∓ (halfH + TILE_H/2), pos.y 4.402285714285715 · halfH 11.232822857142855
  gateY0: 4.402285714285715 - 11.232822857142855 - 0.64,
  gateY1: 4.402285714285715 + 11.232822857142855 + 0.64,
};
const PX = 0.04;
const INN: MapEntity = {
  id: "inn", kind: "object", gx: 14, gy: 9, name: "페른델여관", ruid: "r-inn", tilesW: 9, tilesH: 3,
  baseW: 11.765625, baseH: 12.546875, scaleMul: 0.7, offsetY: 2, offsetX: -20, scale: 0.612, sortPadX: 2,
};

describe("sortGatePx — 게임 SortGateSpan 과 같은 경계", () => {
  it("여관 sortPadX 2 — 가로 경계가 게임 값과 같다(이미지 없음 → 파일 scale 0.612)", () => {
    const g = sortGatePx(INN, 0)!;
    expect(GAME.anchorX + g.x0 * PX).toBeCloseTo(GAME.pad2.gateX0, 6);
    expect(GAME.anchorX + g.x1 * PX).toBeCloseTo(GAME.pad2.gateX1, 6);
    expect(g.pad).toBe(2);
  });

  it("패딩 0 경계(비교선)는 게임의 패딩 0 값 — 신고 당시 입구 광장 한가운데(x −6.21)", () => {
    const g = sortGatePx(INN, 0)!;
    expect(GAME.anchorX + g.baseX0 * PX).toBeCloseTo(GAME.pad0.gateX0, 3);
    expect(GAME.anchorX + g.baseX1 * PX).toBeCloseTo(GAME.pad0.gateX1, 3);
    expect(sortGatePx({ ...INN, sortPadX: undefined }, 0)!.x0).toBeCloseTo(g.baseX0, 9);
  });

  it("세로 범위도 게임과 같다(offset 천분의 일 반올림 차이 ≤ 0.003u)", () => {
    const g = sortGatePx(INN, 0)!;
    expect(Math.abs(GAME.anchorY - g.y1 * PX - GAME.gateY0)).toBeLessThan(0.003); // 화면 아래 = world 아래
    expect(Math.abs(GAME.anchorY - g.y0 * PX - GAME.gateY1)).toBeLessThan(0.003);
  });

  it("이미지가 있으면 export 와 같은 scale 로 계산한다 — 네이티브 753px 이면 파일 값(0.612)과 같다", () => {
    expect(sortGatePx(INN, 753)).toEqual(sortGatePx(INN, 0));
  });

  it("패딩 1칸 = 경계가 좌우로 타일 폭(64px)씩", () => {
    const a = sortGatePx({ ...INN, sortPadX: 0 }, 0)!;
    const b = sortGatePx({ ...INN, sortPadX: 1 }, 0)!;
    expect(a.x0 - b.x0).toBeCloseTo(64, 9);
    expect(b.x1 - a.x1).toBeCloseTo(64, 9);
  });

  it("음수·숫자 아님은 0 으로 본다 — 런타임 방어와 같다(빌드는 음수를 막는다)", () => {
    expect(sortGatePx({ ...INN, sortPadX: -3 }, 0)!.pad).toBe(0);
    expect(sortGatePx({ ...INN, sortPadX: Number.NaN }, 0)!.pad).toBe(0);
  });
});

describe("isSortGateTarget", () => {
  it("멀티셀 auto 오브젝트만", () => {
    expect(isSortGateTarget(INN)).toBe(true);
    expect(isSortGateTarget({ ...INN, tilesW: 1, tilesH: 1 })).toBe(false);
    expect(isSortGateTarget({ ...INN, layer: "above" })).toBe(false);
    expect(isSortGateTarget({ ...INN, layer: "below" })).toBe(false);
    expect(isSortGateTarget({ ...INN, kind: "npc" })).toBe(false);
    expect(sortGatePx({ ...INN, tilesW: 1, tilesH: 1 }, 0)).toBeNull();
  });
});
