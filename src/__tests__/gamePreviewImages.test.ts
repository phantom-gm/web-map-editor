import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadSceneImages } from "../lib/useGamePreview";
import { fetchSpriteAssets, fetchSpriteStamps } from "../lib/apiClient";
import type { GamePreviewScene } from "../lib/gamePreview";

vi.mock("../lib/apiClient", () => ({ fetchSpriteAssets: vi.fn(), fetchSpriteStamps: vi.fn() }));
const fetchAssets = vi.mocked(fetchSpriteAssets);
const fetchStamps = vi.mocked(fetchSpriteStamps);
function scene(ruids: string[], prototypes: string[] = []): GamePreviewScene {
  return { version: 1, baselineId: "images", mapName: "velos", groundOrigin: [0, 0],
    constants: { TILE_W: 2.56, TILE_H: 1.28, ORIGIN_X: 0, ORIGIN_Y: 0, PPU: 100, DEPTH_SCALE: 0.21875, GROUND_ORDER: -1000 },
    defaultSortingLayer: "Default", warnings: [],
    sprites: ruids.map(ruid => ({ id: ruid, path: ruid, name: ruid, ruid, kind: "object", position: [0, 0, 0],
      scale: [1, 1], quaternion: [0, 0, 0, 1], rotationDeg: 0, flipX: false, flipY: false, sortingLayer: null, orderInLayer: 0, sourceOrder: 0 })),
    objectPrototypes: prototypes.map(ruid => ({ entityId: ruid, prototypeId: ruid, spriteId: ruid, name: ruid, ruid,
      position: [0, 0, 0], sourcePosition: [0, 0, 0], canMove: true, canDelete: true, canDuplicate: true })),
  };
}
beforeEach(() => {
  fetchAssets.mockReset();
  vi.stubGlobal("Image", class {
    onload?: () => void;
    onerror?: () => void;
    set src(value: string) { queueMicrotask(() => value === "broken" ? this.onerror?.() : this.onload?.()); }
  });
  fetchAssets.mockImplementation(async ruids => ({
    images: Object.fromEntries(ruids.map(ruid => [ruid, ruid === "missing" ? null : ruid])),
    sprites: Object.fromEntries(ruids.filter(ruid => ruid !== "missing").map(ruid => [ruid,
      { width: 256, height: 128, pivot: [0.5, 0], pixelsPerUnit: 100, version: "test", pivotSource: "storage" }])),
    errors: { missing: "resource-not-found" },
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("keeps a valid map ready when a deleted original's resource no longer exists", async () => {
  const cache = new Map();
  const loaded = await loadSceneImages([scene(["tree"], ["missing", "house"])], cache, new AbortController().signal);
  expect(loaded.missingImages).toBe(0);
  expect([...loaded.images.keys()]).toEqual(["tree", "house"]);
  expect(cache.has("missing")).toBe(false);
});
it("warns again if a missing resource is actually placed, counting a shared resource once", async () => {
  const loaded = await loadSceneImages([scene(["missing", "missing"], ["missing"])], new Map(), new AbortController().signal);
  expect(loaded.missingImages).toBe(1);
});
it("still warns for a missing original image when viewing the before/after comparison", async () => {
  const loaded = await loadSceneImages([scene(["tree"], ["missing"]), scene(["missing"])], new Map(), new AbortController().signal);
  expect(loaded.missingImages).toBe(1);
  expect(loaded.images.has("tree")).toBe(true);
});
it("handles image decode failures with the same map-versus-library boundary", async () => {
  const controller = new AbortController();
  expect((await loadSceneImages([scene([], ["broken"])], new Map(), controller.signal)).missingImages).toBe(0);
  expect((await loadSceneImages([scene(["broken"])], new Map(), controller.signal)).missingImages).toBe(1);
});
it("revalidates cached images cheaply and reloads only a RUID updated in place", async () => {
  const cache = new Map(), signal = new AbortController().signal;
  let version = "v1", now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  fetchAssets.mockImplementation(async ruids => ({
    images: Object.fromEntries(ruids.map(ruid => [ruid, ruid])),
    sprites: Object.fromEntries(ruids.map(ruid => [ruid, { width: ruid === "tree" && version === "v2" ? 512 : 256, height: 128, pivot: [0.5, 0], pixelsPerUnit: 100, version, pivotSource: "storage" }])),
    errors: {}, stamps: Object.fromEntries(ruids.map(ruid => [ruid, ruid === "tree" ? version : "same"])),
  }));
  fetchStamps.mockReset();
  fetchStamps.mockImplementation(async ruids => Object.fromEntries(ruids.map(ruid => [ruid, ruid === "tree" ? version : "same"])));
  await loadSceneImages([scene(["tree", "house"])], cache, signal);
  expect(fetchAssets).toHaveBeenCalledTimes(1);
  await loadSceneImages([scene(["tree", "house"])], cache, signal);
  expect(fetchStamps).not.toHaveBeenCalled();                 // within the revalidation window
  version = "v2"; now += 61_000;
  const loaded = await loadSceneImages([scene(["tree", "house"])], cache, signal);
  expect(fetchStamps).toHaveBeenCalledTimes(1);
  expect(fetchAssets).toHaveBeenLastCalledWith(["tree"], signal); // only the updated RUID is downloaded again
  expect(loaded.images.get("tree")?.asset.width).toBe(512);
});
