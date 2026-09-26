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

describe("validateMap — 1×1 오브젝트 남쪽 침범(요청서 R1)", () => {
  const lamp = (id: string, gy: number, offsetY: number) =>
    ({ id, kind: "object", gx: 5, gy, name: "가로등_A", ruid: "r", tilesW: 1, tilesH: 1, offsetY }) as const;
  const base = { size: [20, 20] as [number, number], ground: new Map([[cellKey(0, 0), 0]]), paletteCount: 1 };

  it("offsetY 16 이상은 errors(빌드 게이트가 막음), 14~15 는 warnings, 13 이하는 없음", () => {
    const v = validateMap({ ...base, blocked: new Set(), entities: [lamp("a", 1, 17), lamp("b", 4, 14), lamp("c", 8, 11)] });
    expect(v.errors.filter((m) => m.includes("정렬 바닥선"))).toHaveLength(1);
    expect(v.errors.some((m) => m.includes("object(5,1)") && m.includes("depth_check"))).toBe(true);
    expect(v.warnings.filter((m) => m.includes("정렬 바닥선"))).toHaveLength(1);
    expect(v.warnings.some((m) => m.includes("object(5,4)"))).toBe(true);
    expect([...v.errors, ...v.warnings].some((m) => m.includes("object(5,8)"))).toBe(false);
  });

  it("남쪽 이웃 두 칸이 이동불가면 대상이 아니다(물속 바위)", () => {
    const blocked = new Set([cellKey(6, 1), cellKey(5, 2)]);
    const v = validateMap({ ...base, blocked, entities: [lamp("a", 1, 26)] });
    expect([...v.errors, ...v.warnings].some((m) => m.includes("정렬 바닥선"))).toBe(false);
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
      entities: [],
    });
    expect(bp.layers.GroundTileMap.cellCount).toBe(1); // (5,5) 제외
    expect(bp.layers.TileAttributeTileMap.cellCount).toBe(1); // (10,10) 제외
  });
});
