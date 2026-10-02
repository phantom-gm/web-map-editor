import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchImages, fetchSpriteAssets } from "../lib/apiClient";

afterEach(() => vi.unstubAllGlobals());

describe("sprite image batching", () => {
  it("resolves more than 500 RUIDs without losing the tail and preserves metrics", async () => {
    const calls: string[][] = [];
    vi.stubGlobal("fetch", vi.fn(async (_path, init) => {
      const ruids: string[] = JSON.parse(init.body).ruids;
      calls.push(ruids);
      return new Response(JSON.stringify({
        images: Object.fromEntries(ruids.map(r => [r, "data:image/png;base64," + r])),
        sprites: Object.fromEntries(ruids.map(r => [r, { width: 397, height: 720, pivot: [.5, 0], pixelsPerUnit: 100, version: "v2", pivotSource: "storage" }])),
        errors: {},
      }), { status: 200 });
    }));
    const ids = Array.from({ length: 551 }, (_, i) => i.toString(16).padStart(32, "0"));
    const result = await fetchSpriteAssets(ids.concat(ids[0]));
    expect(calls.map(c => c.length)).toEqual([100, 100, 100, 100, 100, 51]);
    expect(Object.keys(result.images)).toHaveLength(551);
    expect(result.sprites[ids[550]].pivot).toEqual([.5, 0]);
  });
  it("preserves legacy image-only API and accounts for unresolved RUIDs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ images: { yes: "data:ok" } }), { status: 200 })));
    expect(await fetchImages(["yes", "no"])).toEqual({ yes: "data:ok", no: null });
    const result = await fetchSpriteAssets(["no"]);
    expect(result.errors.no).toBe("image-unresolved");
  });
  it("passes AbortSignal and stops before further chunks", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (_path, init) => {
      expect(init.signal).toBe(controller.signal);
      controller.abort();
      return new Response(JSON.stringify({ images: {} }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    await expect(fetchSpriteAssets(Array.from({ length: 101 }, (_, i) => String(i)), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
