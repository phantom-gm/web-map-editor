import { describe, it, expect } from "vitest";
import { validateMap } from "../lib/validate";
import { buildBlueprint } from "../lib/blueprintIO";
import { cellKey } from "../lib/cell";
import { emptyLayer } from "../types/blueprint";

describe("validateMap", () => {
  it("빈 맵은 warning, error 없음", () => {
    const v = validateMap({ size: [10, 10], ground: new Map(), blocked: new Set(), paletteCount: 0 });
    expect(v.errors).toHaveLength(0);
    expect(v.warnings.length).toBeGreaterThan(0);
  });

  it("정상 맵은 error/warning 없음", () => {
    const ground = new Map([[cellKey(0, 0), 0]]);
    const v = validateMap({ size: [10, 10], ground, blocked: new Set(), paletteCount: 1 });
    expect(v.errors).toHaveLength(0);
    expect(v.warnings).toHaveLength(0);
  });

  it("경계 밖 셀과 팔레트 범위 초과를 잡는다", () => {
    const ground = new Map([
      [cellKey(0, 0), 0],
      [cellKey(20, 0), 0], // size 10×10 밖
      [cellKey(1, 1), 5], // 팔레트 1개인데 idx 5
    ]);
    const blocked = new Set([cellKey(99, 99)]);
    const v = validateMap({ size: [10, 10], ground, blocked, paletteCount: 1 });
    expect(v.errors.some((e) => e.includes("경계 밖 Ground 셀 1개"))).toBe(true);
    expect(v.errors.some((e) => e.includes("이동불가 셀 1개"))).toBe(true);
    expect(v.errors.some((e) => e.includes("타일 참조"))).toBe(true);
  });
});

describe("buildBlueprint 경계 클램프", () => {
  it("size 밖 ground/blocked 셀은 export 에서 제외", () => {
    const ground = new Map([
      [cellKey(0, 0), 0],
      [cellKey(5, 5), 0], // size 5×5 (0..4) 밖
    ]);
    const blocked = new Set([cellKey(1, 1), cellKey(10, 10)]);
    const bp = buildBlueprint({
      mapName: "t",
      size: [5, 5],
      groundOrigin: [0, 0],
      paletteNames: ["a"],
      ground,
      blocked,
      staticLayer: emptyLayer(),
      attributeBase: emptyLayer(),
    });
    expect(bp.layers.GroundTileMap.cellCount).toBe(1); // (5,5) 제외
    expect(bp.layers.TileAttributeTileMap.cellCount).toBe(1); // (10,10) 제외
  });
});
