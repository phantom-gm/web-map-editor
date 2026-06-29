import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseBlueprint, buildBlueprint } from "../lib/blueprintIO";
import { cellKey } from "../lib/cell";
import { cellToWorld } from "../lib/iso";
import type { Blueprint, Cell } from "../types/blueprint";

const bpPath = fileURLToPath(
  new URL("../../../../asset/map/map_blueprint_Map000000.json", import.meta.url),
);
const original = JSON.parse(readFileSync(bpPath, "utf8")) as Blueprint;

const sortCells = (c: Cell[]) => [...c].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

describe("blueprint round-trip (map000000)", () => {
  it("import → export 가 의미적으로 동일 (핵심 게이트)", () => {
    const r = parseBlueprint(original);
    const ground = new Map<string, number>();
    for (const [gx, gy, idx] of r.cells) ground.set(`${gx},${gy}`, idx);
    const blocked = new Set(r.blocked.map(([gx, gy]) => cellKey(gx, gy)));

    const out = buildBlueprint({
      mapName: r.mapName,
      size: r.size,
      groundOrigin: r.groundOrigin,
      paletteNames: r.paletteNames,
      ground,
      blocked,
      staticLayer: r.staticLayer,
      attributeBase: r.attributeBase,
    });

    expect(out.map).toBe(original.map);

    const og = original.layers.GroundTileMap;
    const ng = out.layers.GroundTileMap;
    expect(ng.size).toEqual(og.size);
    expect(ng.origin).toEqual(og.origin);
    expect(ng.palette).toEqual(og.palette);
    expect(ng.paletteCount).toBe(og.paletteCount);
    expect(ng.cellCount).toBe(og.cellCount);
    expect(sortCells(ng.cells)).toEqual(sortCells(og.cells));

    // 에디터 미편집 레이어(Static)는 verbatim 보존
    expect(out.layers.StaticTileMap).toEqual(original.layers.StaticTileMap);

    // Attribute 레이어는 blocked Set 에서 재생성 — 의미적으로 원본과 동일해야 함(더 강한 게이트)
    const oa = original.layers.TileAttributeTileMap;
    const na = out.layers.TileAttributeTileMap;
    expect(na.size).toEqual(oa.size);
    expect(na.origin).toEqual(oa.origin);
    expect(na.palette).toEqual(oa.palette);
    expect(na.paletteCount).toBe(oa.paletteCount);
    expect(na.cellCount).toBe(oa.cellCount);
    expect(sortCells(na.cells)).toEqual(sortCells(oa.cells));
  });

  it("0-based 변환이 origin 만큼 정확히 오프셋", () => {
    const r = parseBlueprint(original);
    const [ox, oy] = r.groundOrigin;
    // 모든 에디터 셀이 0..W-1 / 0..H-1 범위 안
    const [W, H] = r.size;
    for (const [gx, gy] of r.cells) {
      expect(gx).toBeGreaterThanOrEqual(0);
      expect(gy).toBeGreaterThanOrEqual(0);
      expect(gx).toBeLessThan(W);
      expect(gy).toBeLessThan(H);
    }
    expect([ox, oy]).toEqual(original.layers.GroundTileMap.origin);
  });
});

describe("iso 엔진 미러(IsoProjectLogic 정합)", () => {
  it("cellToWorld(15,15) = (0,0)", () => {
    const [x, y] = cellToWorld(15, 15);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });
  it("cellToWorld(16,15) = (+TW/2, -TH/2)", () => {
    const [x, y] = cellToWorld(16, 15);
    expect(x).toBeCloseTo(0.28);
    expect(y).toBeCloseTo(-0.14);
  });
});
