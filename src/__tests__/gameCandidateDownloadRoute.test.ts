import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/game-sync/candidate-download/route";
import { downloadGameCandidate, GameSyncError } from "../server/gameSync";

vi.mock("../server/gameSync", async (original) => ({
  ...await original<typeof import("../server/gameSync")>(),
  downloadGameCandidate: vi.fn(),
}));
const download = vi.mocked(downloadGameCandidate);
const identity = { mapName: "ferendelmotel", candidateId: "12345678-1234-1234-1234-123456789abc", baselineId: "abcdef01-1234-1234-1234-123456789abc" };
function request(body: unknown = identity, headers: Record<string, string> = {}, host = "127.0.0.1:3000") {
  return new Request("http://" + host + "/api/game-sync/candidate-download", {
    method: "POST", headers: { host, origin: "http://" + host, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.stubEnv("MSW_GAME_ROOT", "C:/game"); vi.stubEnv("VERCEL", ""); download.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("candidate download HTTP boundary", () => {
  it("returns exact verified archive bytes as a private no-store attachment", async () => {
    const bytes = Buffer.from([0x50, 0x4b, 3, 4, 0, 0xff]);
    download.mockResolvedValue({ filename: "ferendelmotel-" + identity.candidateId + ".zip", bytes, review: {} });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/zip");
    expect(response.headers.get("content-disposition")).toContain('attachment; filename="ferendelmotel-' + identity.candidateId + '.zip"');
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(identity);
  });
  it.each([
    ["remote host", () => request(identity, {}, "editor.example")],
    ["spoofed host", () => request(identity, { host: "editor.example" })],
    ["cross origin", () => request(identity, { origin: "https://other.example" })],
  ])("rejects %s before any candidate reads", async (_label, makeRequest) => {
    expect((await POST(makeRequest())).status).toBe(403);
    expect(download).not.toHaveBeenCalled();
  });
  it.each(["VERCEL", "MSW_GAME_ROOT"])("does not expose candidates with invalid %s environment", async (key) => {
    vi.stubEnv(key, key === "VERCEL" ? "1" : "");
    expect((await POST(request())).status).toBe(403);
    expect(download).not.toHaveBeenCalled();
  });
  it("requires JSON and rejects malformed payloads", async () => {
    expect((await POST(request(identity, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request("{"))).status).toBe(400);
    expect(download).not.toHaveBeenCalled();
  });
  it("bounds declared and actual body size without calling the compiler", async () => {
    expect((await POST(request(identity, { "content-length": String(20 * 1024 * 1024) }))).status).toBe(413);
    expect((await POST(request(" ".repeat(20 * 1024 * 1024)))).status).toBe(413);
    expect(download).not.toHaveBeenCalled();
  });
  it("returns a blocked review as JSON without an archive attachment", async () => {
    const review = { ...identity, status: "blocked", issues: ["candidate changed"] };
    download.mockRejectedValue(Object.assign(new GameSyncError("candidate changed", 409), { review }));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: "candidate changed", review });
  });
});

describe("candidate download identity boundary", () => {
  it.each([null, [], {}, { ...identity, candidateDir: "C:/game/map" }, { ...identity, project: {} },
    { ...identity, mapName: "../game" }, { ...identity, candidateId: "../../file" },
    { ...identity, baselineId: "invalid" }, { ...identity, candidateId: 1 },
  ])("rejects paths, project payloads and malformed identity before reading disk: %j", async body => {
    const real = await vi.importActual<typeof import("../server/gameSync")>("../server/gameSync");
    await expect(real.downloadGameCandidate(body)).rejects.toMatchObject({ status: 400 });
  });
});
