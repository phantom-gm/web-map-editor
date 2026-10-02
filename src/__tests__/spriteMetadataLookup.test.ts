import { describe, it, expect, vi } from "vitest";
import { getGroupResourceMetadata } from "../server/mswMcp";

describe("resource metadata lookup", () => {
  it("uses direct GUID lookups in batches of 50, including older resources omitted by listing", async () => {
    const ruids = Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(32, "0"));
    const callTool = vi.fn(async request => ({
      content: [{ type: "text", text: JSON.stringify({ resultList: request.arguments.guids.map((ruid: string) => ({
        resultCode: 0,
        resultData: { ruid, resourceType: "sprite", versionString: "latest", files: { win: { path: ruid + ".mod", md5: "hash" } }, properties: [{ key: "pivot_x", value: ".5" }, { key: "pivot_y", value: "0" }] },
      })) }) }],
    }));
    const client = { callTool } as unknown as Parameters<typeof getGroupResourceMetadata>[0];
    const result = await getGroupResourceMetadata(client, ruids);
    expect(callTool.mock.calls.map(([r]) => r.arguments.guids.length)).toEqual([50, 50, 1]);
    expect(callTool.mock.calls.every(([r]) => r.name === "asset_get_group_resource_metadata_bulk")).toBe(true);
    expect(result.size).toBe(101);
    expect(result.get(ruids[100])).toMatchObject({ version: "latest", modPath: ruids[100] + ".mod", contentHash: "hash" });
  });
  it("does not treat a failed metadata lookup as a resolved image", async () => {
    const client = { callTool: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ resultList: [{ resultCode: 404 }] }) }] })) } as unknown as Parameters<typeof getGroupResourceMetadata>[0];
    expect((await getGroupResourceMetadata(client, ["missing"])).size).toBe(0);
  });
  it("rejects malformed responses instead of returning an empty successful lookup", async () => {
    const client = { callTool: vi.fn(async () => ({ content: [{ type: "text", text: "{}" }] })) } as unknown as Parameters<typeof getGroupResourceMetadata>[0];
    await expect(getGroupResourceMetadata(client, ["missing"])).rejects.toThrow(/메타데이터/);
  });
});
