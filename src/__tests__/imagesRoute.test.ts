import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ withMcpClient: vi.fn(), getGroupResourceMetadata: vi.fn(), fetchSpriteAsset: vi.fn(), fetchAnimationPreviewFrame: vi.fn(), fetchAnimationFrameAsset: vi.fn() }));
vi.mock("../server/mswMcp", () => mocks);
import { POST } from "../../app/api/images/route";
const clipId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", spriteId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const clip = { ruid: clipId, resourceType: "animationclip", modPath: "clip.mod" }, sprite = { ruid: spriteId, resourceType: "sprite", modPath: "sprite.mod" };
const frame = { spriteRuid: spriteId, offset: [-8, 25], frameCount: 1 };
const metrics = { width: 256, height: 256, pixelsPerUnit: 100, pivot: [.53125, -.09765625], pivotSource: "animation" };
const post = (ruids: string[]) => POST(new Request("http://localhost/api/images", { method: "POST", body: JSON.stringify({ ruids }) }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.withMcpClient.mockImplementation(fn => fn({ client: true }));
  mocks.getGroupResourceMetadata.mockImplementation(async (_client, ids: string[]) => new Map(ids.map(id => [id, id.toLowerCase() === clipId ? clip : sprite])));
  mocks.fetchAnimationPreviewFrame.mockResolvedValue(frame);
  mocks.fetchAnimationFrameAsset.mockResolvedValue({ imageUrl: "data:image/png;base64,frame", metadata: metrics });
  mocks.fetchSpriteAsset.mockResolvedValue({ imageUrl: "data:image/png;base64,sprite", metadata: { ...metrics, pivotSource: "mod" } });
});
describe("NPC animation image API", () => {
  it("resolves clip and sprite metadata in one connection and preserves the requested clip image key", async () => {
    const response = await post([clipId, clipId]); const result = await response.json();
    expect(response.status).toBe(200); expect(result).toMatchObject({ resolved: 1, missing: 0, errors: {}, images: { [clipId]: "data:image/png;base64,frame" }, sprites: { [clipId]: metrics } });
    expect(mocks.withMcpClient).toHaveBeenCalledTimes(1);
    expect(mocks.getGroupResourceMetadata.mock.calls.map(call => call[1])).toEqual([[clipId], [spriteId]]);
    expect(mocks.fetchAnimationFrameAsset).toHaveBeenCalledWith(clip, frame, sprite);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("supports a mixed sprite/clip request with uppercase sprite IDs", async () => {
    const result = await (await post([clipId, spriteId.toUpperCase()])).json();
    expect(result.resolved).toBe(2); expect(result.errors).toEqual({});
    expect(result.images[spriteId.toUpperCase()]).toBe("data:image/png;base64,sprite");
    expect(mocks.fetchAnimationFrameAsset).toHaveBeenCalledWith(clip, frame, sprite);
  });
  it("reports unsupported clip composition without inventing an image or geometry", async () => {
    mocks.fetchAnimationPreviewFrame.mockRejectedValue(new Error("multilayer"));
    const result = await (await post([clipId])).json();
    expect(result).toMatchObject({ resolved: 0, missing: 1, images: { [clipId]: null }, sprites: {}, errors: { [clipId]: "animation-frame-unsupported" } });
    expect(mocks.fetchAnimationFrameAsset).not.toHaveBeenCalled();
  });
  it("reports missing frame sprites while retaining independent ordinary sprites", async () => {
    const ordinary = "cccccccccccccccccccccccccccccccc";
    mocks.getGroupResourceMetadata.mockImplementation(async (_client, ids: string[]) => new Map(ids.filter(id => id !== spriteId).map(id => [id, id === clipId ? clip : { ...sprite, ruid: ordinary }])));
    const result = await (await post([clipId, ordinary])).json();
    expect(result).toMatchObject({ resolved: 1, missing: 1, errors: { [clipId]: "animation-frame-sprite-not-found" } });
    expect(result.images[ordinary]).toBeTruthy();
  });
});
