import { afterEach, describe, it, expect, vi } from "vitest";
import { fetchSpriteAsset, type SpriteResourceMetadata } from "../server/mswMcp";
import { parseSpriteMod, extractEmbeddedPng } from "../server/spriteMetadata";

const uint = (n: number) => { const a: number[] = []; do { const b = n % 128; n = Math.floor(n / 128); a.push(b | (n ? 128 : 0)); } while (n); return Buffer.from(a); };
const bytes = (field: number, body: Buffer) => Buffer.concat([uint(field * 8 + 2), uint(body.length), body]);
const integer = (field: number, value: number) => Buffer.concat([uint(field * 8), uint(value)]);
const float = (field: number, value: number) => { const b = Buffer.alloc(4); b.writeFloatLE(value); return Buffer.concat([uint(field * 8 + 5), b]); };
function fixture(width = 397, height = 720, pngWidth = width, ppu = 100): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13); ihdr.write("IHDR", 4); ihdr.writeUInt32BE(pngWidth, 8); ihdr.writeUInt32BE(height, 12);
  const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), ihdr, Buffer.from("0000000049454e44ae426082", "hex")]);
  const payload = Buffer.concat([integer(1, width), integer(2, height), bytes(4, Buffer.concat([float(1, .5), float(2, .5)])), float(5, ppu), bytes(10, Buffer.concat([integer(1, 1), bytes(2, png)]))]);
  return Buffer.concat([uint(0), uint(payload.length), payload]);
}

describe("native UGC sprite metrics", () => {
  it("keeps original tree canvas, native PPU and center pivot", () => {
    const result = parseSpriteMod(fixture(), [], "version-one");
    expect(result.metadata).toEqual({ width: 397, height: 720, pivot: [.5, .5], pixelsPerUnit: 100, version: "version-one", pivotSource: "mod" });
    expect(result.png.equals(extractEmbeddedPng(fixture())!)).toBe(true);
  });
  it("uses storage bottom-center override without cropping or resizing the PNG", () => {
    const result = parseSpriteMod(fixture(1170, 1244), [{ key: "pivot_x", value: "0.5" }, { key: "pivot_y", value: "0" }], "building");
    expect(result.metadata).toEqual({ width: 1170, height: 1244, pivot: [.5, 0], pixelsPerUnit: 100, version: "building", pivotSource: "storage" });
  });
  it("preserves large 4x4 ground dimensions and center pivot", () => {
    expect(parseSpriteMod(fixture(1024, 512)).metadata).toMatchObject({ width: 1024, height: 512, pivot: [.5, .5], pixelsPerUnit: 100 });
  });
  it("rejects mismatched native and PNG canvas dimensions", () => {
    expect(() => parseSpriteMod(fixture(512, 256, 256))).toThrow(/dimensions/);
  });
  it("rejects truncated envelopes and invalid PPU instead of guessing render metrics", () => {
    expect(() => parseSpriteMod(fixture().subarray(0, 40))).toThrow();
    expect(() => parseSpriteMod(fixture(256, 128, 256, 0))).toThrow(/pixels per unit/);
  });
  it("rejects partial or invalid storage pivots", () => {
    expect(() => parseSpriteMod(fixture(), [{ key: "pivot_y", value: "0" }])).toThrow(/pivot/);
    expect(() => parseSpriteMod(fixture(), [{ key: "pivot_x", value: "NaN" }, { key: "pivot_y", value: "0" }])).toThrow(/pivot/);
  });
  it("does not return a truncated PNG to image-only consumers", () => {
    const full = fixture();
    expect(extractEmbeddedPng(full.subarray(0, full.length - 1))).toBeNull();
  });
});

afterEach(() => vi.unstubAllGlobals());
const resource = (ruid: string, version = "v1", properties: SpriteResourceMetadata["properties"] = []): SpriteResourceMetadata => ({
  ruid, version, properties, resourceType: "sprite", contentHash: version, modPath: ruid + "/" + version + ".mod",
});

describe("versioned native sprite bytes", () => {
  it("refreshes image bytes when the same RUID has a new version", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array(fixture(256, 128))))
      .mockResolvedValueOnce(new Response(new Uint8Array(fixture(512, 256))));
    vi.stubGlobal("fetch", fetch);
    expect((await fetchSpriteAsset(resource("changed-sprite", "v1"))).metadata?.width).toBe(256);
    expect((await fetchSpriteAsset(resource("changed-sprite", "v2"))).metadata?.width).toBe(512);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("reuses versioned pixels but re-applies fresh storage pivot overrides", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array(fixture())));
    vi.stubGlobal("fetch", fetch);
    expect((await fetchSpriteAsset(resource("pivot-update"))).metadata?.pivot).toEqual([.5, .5]);
    const updated = resource("pivot-update", "v1", [{ key: "pivot_x", value: "0.5" }, { key: "pivot_y", value: "0" }]);
    expect((await fetchSpriteAsset(updated)).metadata?.pivot).toEqual([.5, 0]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps image-only fallback but exposes unsupported native metadata", async () => {
    const legacy = Buffer.concat([Buffer.from("legacy-container"), extractEmbeddedPng(fixture())!]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(legacy))));
    const result = await fetchSpriteAsset(resource("unknown-container"));
    expect(result.imageUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.metadata).toBeNull();
    expect(result.error).toBe("native-metadata-unsupported");
  });
});
