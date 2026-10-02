import { describe, expect, it } from "vitest";
import { cellToScreen } from "../lib/grid";
import {
  previewWorldToScreen, previewSpriteGeometry, fitPreviewCamera, sortPreviewSprites, validPreviewAsset,
  type GamePreviewAsset, type GamePreviewScene, type GamePreviewSprite,
} from "../lib/gamePreview";

const constants = { TILE_W: 2.56, TILE_H: 1.28, ORIGIN_X: 15, ORIGIN_Y: 15, PPU: 100, DEPTH_SCALE: 0.21875, GROUND_ORDER: -1000 };
const scene: GamePreviewScene = {
  version: 1, baselineId: "baseline", mapName: "test", constants, groundOrigin: [0, 0],
  defaultSortingLayer: "Default", sprites: [], warnings: [],
};
const camera = { x: 0, y: 0, zoom: 1 };
const sprite = (extra: Partial<GamePreviewSprite> = {}): GamePreviewSprite => ({
  id: "s", name: "s", path: "/maps/test/s", ruid: "r", kind: "object",
  position: [0, 0, 0], scale: [1, 1], quaternion: [0, 0, 0, 1],
  rotationDeg: 0, flipX: false, flipY: false, sortingLayer: null, orderInLayer: 0, sourceOrder: 0, ...extra,
});
const worldCell = (gx: number, gy: number): [number, number, number] => [
  (gx - gy) * constants.TILE_W / 2,
  -((gx - constants.ORIGIN_X) + (gy - constants.ORIGIN_Y)) * constants.TILE_H / 2,
  0,
];
const near = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 8));
};

describe("actual game preview projection", () => {
  it("실제2.56/1.28좌표를64/32편집격자와일치시킨다", () => {
    for (const cell of [[0, 0], [15, 15], [59, 59], [4, 28]]) {
      const [gx, gy] = cell;
      near(previewWorldToScreen(worldCell(gx, gy), scene, camera), cellToScreen(gx, gy, camera));
    }
  });
  it("원점·팬·줌을반영한다", () => {
    const local = { ...scene, groundOrigin: [3, 4] as [number, number] };
    const cam = { x: 37, y: 91, zoom: 1.75 };
    near(previewWorldToScreen(worldCell(3, 4), local, cam), [37, 91]);
    near(previewWorldToScreen(worldCell(5, 8), local, cam), cellToScreen(2, 4, cam));
  });
  it("실제4×4이미지를1칸으로축소하지않는다", () => {
    const block = sprite({
      kind: "ground", position: worldCell(11.5, 13.5), ground: { gx: 10, gy: 12, size: 4 },
    });
    const asset: GamePreviewAsset = { width: 1024, height: 512, pivot: [0.5, 0.5], pixelsPerUnit: 100 };
    const result = previewSpriteGeometry(block, asset, scene, camera);
    near(result.anchor, cellToScreen(11.5, 13.5, camera));
    near(result.bounds, [-192, 336, 64, 464]);
    near([result.bounds[2] - result.bounds[0], result.bounds[3] - result.bounds[1]], [256, 128]);
  });
  it("1×1·2×2·4×4바닥이각각64·128·256폭이다", () => {
    for (const size of [1, 2, 4]) {
      const asset: GamePreviewAsset = { width: 256 * size, height: 128 * size, pivot: [0.5, 0.5] };
      const geometry = previewSpriteGeometry(sprite({ kind: "ground" }), asset, scene, camera);
      near([geometry.bounds[2] - geometry.bounds[0], geometry.bounds[3] - geometry.bounds[1]], [64 * size, 32 * size]);
    }
  });
});

describe("actual sprite transform and asset pivot", () => {
  const asset: GamePreviewAsset = { width: 397, height: 720, pivot: [0.5, 0], pixelsPerUnit: 100 };
  it("bottom-center와비균일실제TransformScale을반영한다", () => {
    const geometry = previewSpriteGeometry(sprite({ scale: [1, 2] }), asset, scene, camera);
    near(geometry.bounds, [-49.625, 120, 49.625, 480]);
  });
  it("같은이미지라도centre피벗이면bounds가달라진다", () => {
    const geometry = previewSpriteGeometry(sprite(), { ...asset, pivot: [0.5, 0.5] }, scene, camera);
    near(geometry.bounds, [-49.625, 390, 49.625, 570]);
  });
  it("engineZ반시계회전은screenY반전후에도world방향을유지한다", () => {
    const geometry = previewSpriteGeometry(sprite({ rotationDeg: 90 }), {
      width: 100, height: 200, pivot: [0.5, 0],
    }, scene, camera);
    near(geometry.bounds, [-50, 467.5, 0, 492.5]);
  });
  it("비대칭피벗에서flipX/flipY·음수scale도pivot위치를고정한다", () => {
    const custom: GamePreviewAsset = { width: 80, height: 120, pivot: [0.25, 0.75] };
    const geometry = previewSpriteGeometry(sprite({ flipX: true, flipY: true, scale: [-2, 3], rotationDeg: 37 }), custom, scene, camera);
    const [a, b, c, d, tx, ty] = geometry.matrix;
    const px = custom.pivot[0] * custom.width, py = (1 - custom.pivot[1]) * custom.height;
    near([a * px + c * py + tx, b * px + d * py + ty], geometry.anchor);
  });
  it("개별metadataPPU를우선한다", () => {
    const geometry = previewSpriteGeometry(sprite(), { width: 200, height: 100, pivot: [0.5, 0.5], pixelsPerUnit: 200 }, scene, camera);
    near([geometry.bounds[2] - geometry.bounds[0], geometry.bounds[3] - geometry.bounds[1]], [25, 12.5]);
  });
  it("미해결피벗/잘못된크기를정상리소스로취급하지않는다", () => {
    expect(validPreviewAsset(asset)).toBe(true);
    expect(validPreviewAsset({ width: 397, height: 720 })).toBe(false);
    expect(validPreviewAsset({ ...asset, pixelsPerUnit: 0 })).toBe(false);
    expect(validPreviewAsset({ ...asset, pivot: [NaN, 0] })).toBe(false);
  });
});

describe("actual game drawing order", () => {
  it("order오름차순,z내림차순,원본순서를따른다", () => {
    const sprites = [
      sprite({ id: "front", position: [0, 0, -2], sourceOrder: 2 }),
      sprite({ id: "ground", orderInLayer: -1000, sourceOrder: 5 }),
      sprite({ id: "back", position: [0, 0, 2], sourceOrder: 1 }),
      sprite({ id: "above", orderInLayer: 4000, sourceOrder: 3 }),
      sprite({ id: "same", position: [0, 0, -2], sourceOrder: 4, sortingLayer: "Default" }),
    ];
    expect(sortPreviewSprites({ ...scene, sprites }).map(s => s.id)).toEqual(["ground", "back", "front", "same", "above"]);
  });
  it("모르는sortingLayer이름을알파벳순으로배치하지않는다", () => {
    const sprites = [
      sprite({ id: "z", sortingLayer: "ZLayer", sourceOrder: 0 }),
      sprite({ id: "a", sortingLayer: "ALayer", sourceOrder: 1 }),
    ];
    expect(sortPreviewSprites({ ...scene, sprites }).map(s => s.id)).toEqual(["z", "a"]);
  });
});

describe("actual scene camera fit", () => {
  it("맵 밖의 큰 건물과 회전 Sprite까지 실제 viewport 안에 맞춘다", () => {
    const asset: GamePreviewAsset = { width: 1170, height: 1244, pivot: [0.5, 0] };
    const sprites = [
      sprite({ position: worldCell(0, 0), scale: [2, 2] }),
      sprite({ position: worldCell(59, 59), rotationDeg: 127 }),
    ];
    const actual = { ...scene, sprites };
    const images = new Map([["r", { asset }]]);
    for (const dims of [{ w: 960, h: 640 }, { w: 960, h: 420 }]) {
      const fit = fitPreviewCamera(dims, [60, 60], actual, images);
      for (const item of sprites) {
        const [x0, y0, x1, y1] = previewSpriteGeometry(item, asset, actual, fit).bounds;
        expect(x0).toBeGreaterThanOrEqual(24 - 1e-8);
        expect(y0).toBeGreaterThanOrEqual(24 - 1e-8);
        expect(x1).toBeLessThanOrEqual(dims.w - 24 + 1e-8);
        expect(y1).toBeLessThanOrEqual(dims.h - 24 + 1e-8);
      }
      for (const cell of [[0, 0], [59, 0], [0, 59], [59, 59]]) {
        const [x, y] = cellToScreen(cell[0], cell[1], fit);
        expect(x - 32 * fit.zoom).toBeGreaterThanOrEqual(24 - 1e-8);
        expect(x + 32 * fit.zoom).toBeLessThanOrEqual(dims.w - 24 + 1e-8);
        expect(y - 16 * fit.zoom).toBeGreaterThanOrEqual(24 - 1e-8);
        expect(y + 16 * fit.zoom).toBeLessThanOrEqual(dims.h - 24 + 1e-8);
      }
    }
  });
  it("해결되지 않은 리소스가 있어도 논리 맵 범위를 보존한다", () => {
    const fit = fitPreviewCamera({ w: 960, h: 420 }, [60, 60], scene, new Map());
    expect(fit.zoom).toBeCloseTo(372 / 1920);
    near(cellToScreen(29.5, 29.5, fit), [480, 210]);
  });
});
