import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drawGameObjectSelection, gameObjectHitCandidates, gameObjectsInScreenRect, objectCellOffset, offsetObjectPosition, previewScreenToWorld,
  previewSpritePixelAt, sceneWithGameObjectGroupDraft, sceneWithObjectDraft, snapObjectPosition,
} from "../lib/gameObjectPreview";
import {
  previewSpriteGeometry, previewWorldToScreen,
  type GamePreviewAsset, type GamePreviewImages, type GamePreviewScene, type GamePreviewSprite,
} from "../lib/gamePreview";
import type { GameObjectDescriptor } from "../lib/gameObjects";

const constants = { TILE_W: 2.56, TILE_H: 1.28, ORIGIN_X: 15, ORIGIN_Y: 15, PPU: 100, DEPTH_SCALE: 0.21875, GROUND_ORDER: -1000 };
const scene: GamePreviewScene = {
  version: 1, baselineId: "geometry", mapName: "geometry", constants, groundOrigin: [0, 0],
  defaultSortingLayer: "Default", sprites: [], warnings: [],
};
const camera = { x: 83, y: -37, zoom: 1.75 };
const asset: GamePreviewAsset = { width: 120, height: 240, pivot: [0.3, 0.12], pixelsPerUnit: 100 };
const sprite = (id: string, extra: Partial<GamePreviewSprite> = {}): GamePreviewSprite => ({
  id: "sprite-" + id, objectEntityId: id, path: "/maps/geometry/" + id, name: id, ruid: "ruid-" + id,
  kind: "object", position: [0.123, -2.456, 3], scale: [1, 1], quaternion: [0, 0, 0, 1],
  rotationDeg: 0, flipX: false, flipY: false, sortingLayer: null, orderInLayer: 0, sourceOrder: 0, ...extra,
});
function descriptor(item: GamePreviewSprite): GameObjectDescriptor {
  return {
    entityId: item.objectEntityId!, prototypeId: item.objectEntityId!, spriteId: item.id,
    name: item.name, ruid: item.ruid, position: [...item.position], sourcePosition: [...item.position],
    canMove: true, canDuplicate: true, canDelete: true,
  };
}
function near(actual: readonly number[], expected: readonly number[], digits = 8) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], digits));
}
function screenPixel(item: GamePreviewSprite, image: GamePreviewAsset, px: number, py: number): [number, number] {
  const [a, b, c, d, tx, ty] = previewSpriteGeometry(item, image, scene, camera).matrix;
  return [a * px + c * py + tx, b * px + d * py + ty];
}
afterEach(() => vi.unstubAllGlobals());

describe("native object pointer coordinates", () => {
  it("inverts native world projection across ground origins, pan and zoom", () => {
    for (const groundOrigin of [[0, 0], [15, 15], [-3.25, 21.75]] as [number, number][]) {
      const current = { ...scene, groundOrigin };
      for (const cam of [{ x: 0, y: 0, zoom: 1 }, camera, { x: -431, y: 810, zoom: 0.15 }]) {
        for (const position of [[0, 0], [18.371, -29.642], [-37.2, 8.137]] as [number, number][]) {
          const [x, y] = previewWorldToScreen(position, current, cam);
          near(previewScreenToWorld(x, y, current, cam), position);
        }
      }
    }
  });
  it("preserves a native fractional anchor when moving by iso grid cells", () => {
    const origin = [0.13742153, -9.38127164, -2.75];
    for (const [gx, gy] of [[0, 0], [1, 0], [0, 1], [-4, 7], [31, -12]]) {
      const position = offsetObjectPosition(origin, gx, gy, scene);
      near(position, [origin[0] + (gx - gy) * 1.28, origin[1] - (gx + gy) * 0.64]);
      const delta = objectCellOffset(position, origin, scene);
      expect(delta.every(Number.isInteger)).toBe(true);
      near(delta, [gx, gy]); // Math.round may return -0, which is the same zero-cell movement.
      near(snapObjectPosition(position, origin, scene), position);
    }
  });
  it("snaps pointer movement relative to the original anchor, including negative cell deltas", () => {
    const origin = [-3.14159265, 2.71828183, 0];
    const target = offsetObjectPosition(origin, -3, 5, scene);
    const jittered = offsetObjectPosition(target, 0.2, -0.3, scene);
    near(snapObjectPosition(jittered, origin, scene), target);
    expect(objectCellOffset(jittered, origin, scene)).toEqual([-3, 5]);
    near(snapObjectPosition(offsetObjectPosition(origin, 0.49, 0.24, scene), origin, scene), origin.slice(0, 2));
    near(snapObjectPosition(offsetObjectPosition(origin, 0.51, 0.24, scene), origin, scene), offsetObjectPosition(origin, 1, 0, scene));
  });
});

describe("sprite hit geometry matches the rendered native transform", () => {
  it("recovers image pixels after rotation, both flips, negative and nonuniform scaling", () => {
    for (const extra of [
      { rotationDeg: 37, scale: [-2, 0.6] as [number, number], flipX: true, flipY: true },
      { rotationDeg: -123, scale: [0.4, -3] as [number, number], flipX: false, flipY: true },
      { rotationDeg: 90, scale: [-0.75, -2.5] as [number, number], flipX: true, flipY: false },
    ]) {
      const item = sprite("transformed", extra);
      for (const pixel of [[2.25, 4.75], [36, 211.2], [118.5, 238.5]]) {
        const [x, y] = screenPixel(item, asset, pixel[0], pixel[1]);
        const recovered = previewSpritePixelAt(item, asset, scene, camera, x, y);
        expect(recovered).not.toBeNull();
        near(recovered!, pixel);
      }
      for (const pixel of [[-1, 30], [asset.width + 1, 30], [30, -1], [30, asset.height + 1]]) {
        const [x, y] = screenPixel(item, asset, pixel[0], pixel[1]);
        expect(previewSpritePixelAt(item, asset, scene, camera, x, y)).toBeNull();
      }
    }
  });
  it("does not hit empty corners inside the axis-aligned bounding box of a rotated sprite", () => {
    const item = sprite("rotated", { rotationDeg: 43 });
    const [x0, y0, x1, y1] = previewSpriteGeometry(item, asset, scene, camera).bounds;
    for (const [x, y] of [[x0 + 0.01, y0 + 0.01], [x1 - 0.01, y0 + 0.01], [x0 + 0.01, y1 - 0.01], [x1 - 0.01, y1 - 0.01]]) {
      expect(previewSpritePixelAt(item, asset, scene, camera, x, y)).toBeNull();
    }
  });
  it.each([[0, 1], [1, 0], [0, 0]])("rejects a singular zero-scale sprite (%s,%s)", (sx, sy) => {
    const item = sprite("zero", { scale: [sx, sy] });
    const [x, y] = previewWorldToScreen(item.position, scene, camera);
    expect(previewSpritePixelAt(item, asset, scene, camera, x, y)).toBeNull();
  });
});

describe("local object drag preview", () => {
  it("changes only the selected sprite and carries its existing depth bias by the world Y delta", () => {
    const selected = sprite("selected", { position: [1, 2, 7], scale: [2, 3], orderInLayer: 4123, color: [0.2, 0.4, 0.7, 0.9] });
    const other = sprite("other", { position: [-1, 3, -8] });
    const current = { ...scene, sprites: [selected, other], objects: [descriptor(selected), descriptor(other)] };
    const before = structuredClone(current);
    const draft = sceneWithObjectDraft(current, "selected", [10, 6]);
    near(draft.sprites[0].position, [10, 6, 7.875]);
    expect(draft.sprites[0]).toEqual({ ...selected, position: [10, 6, 7.875] });
    expect(draft.sprites[1]).toBe(other);
    expect(draft.objects).toBe(current.objects); // Ghosts do not mutate the saved/native descriptor.
    expect(current).toEqual(before);
  });
  it("does not move unrelated sprites when a stale selection is absent from the scene", () => {
    const current = { ...scene, sprites: [sprite("other")] };
    const draft = sceneWithObjectDraft(current, "missing", [100, 200]);
    expect(draft.sprites).toEqual(current.sprites);
    expect(draft.sprites[0]).toBe(current.sprites[0]);
  });
});

// Deterministic 1-pixel image sampler, replacing only browser canvas I/O.
// Hit projection, draw ordering and alpha filtering still execute the production functions.
interface PixelImage { naturalWidth: number; naturalHeight: number; alphaAt: (x: number, y: number) => number }
let sample: { image: PixelImage; x: number; y: number } | null = null;
let unreadable = false;
const pixelContext = {
  clearRect: () => { sample = null; },
  drawImage: (image: PixelImage, x: number, y: number) => { sample = { image, x, y }; },
  getImageData: () => {
    if (unreadable) throw new Error("unreadable image");
    return { data: new Uint8ClampedArray([0, 0, 0, sample ? sample.image.alphaAt(sample.x, sample.y) : 0]) };
  },
};
const hitAsset: GamePreviewAsset = { width: 100, height: 100, pivot: [0.5, 0.5] };
function hitFixture(sprites: GamePreviewSprite[], alpha: Record<string, (x: number, y: number) => number> = {}) {
  unreadable = false;
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => pixelContext }) });
  const current: GamePreviewScene = { ...scene, sprites, objects: sprites.filter(item => item.objectEntityId).map(descriptor) };
  const images: GamePreviewImages = new Map(sprites.map(item => [item.ruid, {
    asset: hitAsset,
    image: { naturalWidth: 100, naturalHeight: 100, alphaAt: alpha[item.objectEntityId!] ?? (() => 255) } as unknown as HTMLImageElement,
  }]));
  const at = (px: number, py: number) => {
    const [x, y] = screenPixel(sprites[0], hitAsset, px, py);
    return gameObjectHitCandidates(x, y, current, images, camera).map(item => item.entityId);
  };
  return { current, images, at };
}
describe("object hits follow native draw order and source alpha", () => {
  it("returns overlapping objects front to back by order, reverse Z and source tie order", () => {
    const f = hitFixture([
      sprite("back", { position: [0, 0, 5], sourceOrder: 0 }),
      sprite("front", { position: [0, 0, -5], sourceOrder: 1 }),
      sprite("top", { position: [0, 0, 100], orderInLayer: 10, sourceOrder: 2 }),
      sprite("tie", { position: [0, 0, -5], sourceOrder: 3 }),
    ]);
    expect(f.at(50, 50)).toEqual(["top", "tie", "front", "back"]);
  });
  it("clicks through transparent image corners and holes while preserving opaque front pixels", () => {
    const f = hitFixture([sprite("back"), sprite("front", { sourceOrder: 1 })], {
      front: (x, y) => x < 10 || y < 10 || x === 50 && y === 50 ? 0 : 255,
    });
    expect(f.at(1.5, 1.5)).toEqual(["back"]);
    expect(f.at(50.5, 50.5)).toEqual(["back"]);
    expect(f.at(25.5, 25.5)).toEqual(["front", "back"]);
  });
  it("ignores hidden, unresolved, unmapped and unreadable sprites", () => {
    const f = hitFixture([
      sprite("back"),
      sprite("hidden", { color: [1, 1, 1, 0], sourceOrder: 1 }),
      sprite("missing-image", { sourceOrder: 2 }),
      sprite("not-an-object", { objectEntityId: undefined, sourceOrder: 3 }),
    ]);
    f.images.delete("ruid-missing-image");
    expect(f.at(50, 50)).toEqual(["back"]);
    unreadable = true;
    expect(f.at(50, 50)).toEqual([]);
  });
});

describe("multi-object local drag preview", () => {
  it("moves every selected native sprite by the same cell delta and preserves each independent depth bias", () => {
    const a = sprite("a", { position: [0.13742153, -9.38127164, 7.125], rotationDeg: 32, scale: [-2, 3], flipY: true });
    const b = sprite("b", { position: [-4.91287136, 0.67823419, -2.25], orderInLayer: -999, color: [0.2, 0.3, 0.4, 0.5] });
    const untouched = sprite("other", { position: [10, 20, -9] });
    const current = { ...scene, sprites: [a, b, untouched], objects: [descriptor(a), descriptor(b), descriptor(untouched)] };
    const before = structuredClone(current);
    const draft = sceneWithGameObjectGroupDraft(current, ["a", "missing", "b", "a"], [-3, 4]);
    for (let i = 0; i < 2; i++) {
      const source = current.sprites[i], shifted = draft.sprites[i];
      near(shifted.position, [source.position[0] - 8.96, source.position[1] - 0.64, source.position[2] - 0.14]);
      near([shifted.position[2] - shifted.position[1] * constants.DEPTH_SCALE],
        [source.position[2] - source.position[1] * constants.DEPTH_SCALE]);
      expect(shifted).toEqual(sceneWithObjectDraft(current, source.objectEntityId!,
        offsetObjectPosition(source.position, -3, 4, current)).sprites[i]);
    }
    near([draft.sprites[0].position[0] - draft.sprites[1].position[0],
      draft.sprites[0].position[1] - draft.sprites[1].position[1]],
    [a.position[0] - b.position[0], a.position[1] - b.position[1]]);
    expect(draft.sprites[2]).toBe(untouched);
    expect(draft.objects).toBe(current.objects);
    expect(current).toEqual(before);
  });
  it("does not allocate a changed scene for empty, stale or zero-distance selections", () => {
    const current = { ...scene, sprites: [sprite("a"), sprite("unmapped", { objectEntityId: undefined })] };
    expect(sceneWithGameObjectGroupDraft(current, [], [1, 0])).toBe(current);
    expect(sceneWithGameObjectGroupDraft(current, ["missing"], [1, 0])).toBe(current);
    expect(sceneWithGameObjectGroupDraft(current, ["a"], [0, -0])).toBe(current);
  });
  it("rejects noninteger or nonfinite cell deltas without moving any sprite", () => {
    const current = { ...scene, sprites: [sprite("a")] };
    for (const delta of [[0.5, 1], [-1, 0.2], [NaN, 0], [Infinity, 0]] as [number, number][]) {
      expect(sceneWithGameObjectGroupDraft(current, ["a"], delta)).toBe(current);
    }
  });
});

describe("object marquee selection", () => {
  it("intersects transformed native bounds with offset pivots, rotation, flips, negative scales, pan and zoom", () => {
    const item = sprite("rotated", { rotationDeg: 53, scale: [-2, 0.7], flipX: true, flipY: true });
    const current = { ...scene, sprites: [item], objects: [descriptor(item)] };
    const images: GamePreviewImages = new Map([[item.ruid, {
      asset, image: { naturalWidth: asset.width, naturalHeight: asset.height } as HTMLImageElement,
    }]]);
    for (const cam of [camera, { x: -250, y: 720, zoom: 0.25 }]) {
      const [left, top, right, bottom] = previewSpriteGeometry(item, asset, current, cam).bounds;
      // A crossing selection needs only a bounds intersection, not full containment or a pixel hit.
      expect(gameObjectsInScreenRect({ x0: right + 5, y0: bottom + 5, x1: right - 0.01, y1: bottom - 0.01 },
        current, images, cam)).toEqual(["rotated"]);
      expect(gameObjectsInScreenRect({ x0: left, y0: top, x1: left, y1: top },
        current, images, cam)).toEqual(["rotated"]);
      expect(gameObjectsInScreenRect({ x0: right + 0.01, y0: top, x1: right + 10, y1: bottom },
        current, images, cam)).toEqual([]);
    }
  });
  it("returns unique valid objects front to back, including protected objects available for inspection", () => {
    const back = sprite("back", { position: [0, 0, 5], sourceOrder: 0 });
    const front = sprite("front", { position: [0, 0, -5], sourceOrder: 1 });
    const duplicate = sprite("front", { id: "another-front-sprite", position: [0, 0, -5], sourceOrder: 2 });
    const current: GamePreviewScene = { ...scene, sprites: [back, front, duplicate],
      objects: [descriptor(back), { ...descriptor(front), canMove: false, canDelete: false, canDuplicate: false }] };
    const images: GamePreviewImages = new Map([back, front].map(item => [item.ruid, {
      asset: hitAsset, image: { naturalWidth: 100, naturalHeight: 100 } as HTMLImageElement,
    }]));
    const rect = { x0: -100000, y0: -100000, x1: 100000, y1: 100000 };
    expect(gameObjectsInScreenRect(rect, current, images, camera)).toEqual(["front", "back"]);
    expect(gameObjectsInScreenRect({ x0: rect.x1, y0: rect.y1, x1: rect.x0, y1: rect.y0 },
      current, images, camera)).toEqual(["front", "back"]);
  });
  it("excludes hidden, unresolved, unmapped, singular and invalid assets or transforms", () => {
    const items = [
      sprite("valid"), sprite("hidden", { color: [1, 1, 1, 0] }), sprite("unresolved"),
      sprite("no-descriptor"), sprite("not-an-object", { objectEntityId: undefined }),
      sprite("zero-scale", { scale: [0, 1] }), sprite("bad-transform", { position: [NaN, 0, 0] }),
      sprite("bad-asset"), sprite("unloaded-image"),
    ];
    const current = { ...scene, sprites: items,
      objects: items.filter(s => s.objectEntityId && s.objectEntityId !== "no-descriptor").map(descriptor) };
    const images: GamePreviewImages = new Map(items.filter(s => s.objectEntityId !== "unresolved").map(item => [item.ruid, {
      asset: item.objectEntityId === "bad-asset" ? { ...hitAsset, width: 0 } : hitAsset,
      image: { naturalWidth: item.objectEntityId === "unloaded-image" ? 0 : 100, naturalHeight: 100 } as HTMLImageElement,
    }]));
    const rect = { x0: -100000, y0: -100000, x1: 100000, y1: 100000 };
    expect(gameObjectsInScreenRect(rect, current, images, camera)).toEqual(["valid"]);
    expect(gameObjectsInScreenRect({ ...rect, y1: Infinity }, current, images, camera)).toEqual([]);
    expect(gameObjectsInScreenRect({ ...rect, x0: NaN }, current, images, camera)).toEqual([]);
    expect(gameObjectsInScreenRect(rect, { ...current, objects: [] }, images, camera)).toEqual([]);
  });
});

describe("selection outline colors", () => {
  it("uses the requested color for native transformed outlines and anchors and keeps the default optional", () => {
    const item = sprite("selected", { rotationDeg: 35, scale: [-1.5, 0.8], flipY: true });
    const current = { ...scene, sprites: [item], objects: [descriptor(item)] };
    const images: GamePreviewImages = new Map([[item.ruid, { asset,
      image: { naturalWidth: 120, naturalHeight: 240 } as HTMLImageElement }]]);
    const ctx = {
      strokeStyle: "", fillStyle: "", lineWidth: 0,
      save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    };
    drawGameObjectSelection(ctx as unknown as CanvasRenderingContext2D, "selected", current, images, camera, "#a8ffdd");
    expect(ctx.strokeStyle).toBe("#a8ffdd"); expect(ctx.fillStyle).toBe("#a8ffdd");
    expect(ctx.moveTo).toHaveBeenCalledWith(...screenPixel(item, asset, 0, 0));
    expect(ctx.lineTo).toHaveBeenCalledWith(...screenPixel(item, asset, asset.width, asset.height));
    expect(ctx.arc).toHaveBeenCalledWith(...previewWorldToScreen(item.position, current, camera), 4, 0, Math.PI * 2);
    expect(ctx.save).toHaveBeenCalledTimes(1); expect(ctx.restore).toHaveBeenCalledTimes(1);
    drawGameObjectSelection(ctx as unknown as CanvasRenderingContext2D, "selected", current, images, camera);
    expect(ctx.strokeStyle).toBe("#ffd166"); expect(ctx.fillStyle).toBe("#ffd166");
  });
});
