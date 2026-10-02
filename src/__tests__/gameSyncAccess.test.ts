import { afterEach, describe, expect, it, vi } from "vitest";
import { assertLocalGameSyncRequest } from "../server/gameSync";

afterEach(() => { vi.unstubAllEnvs(); });
function request(url: string, origin?: string, host?: string) {
  return new Request(url, { headers: { host: host ?? new URL(url).host, ...(origin ? { origin } : {}) } });
}
describe("local game sync access", () => {
  it("accepts same-origin localhost with an explicit game root", () => {
    vi.stubEnv("MSW_GAME_ROOT", "C:/game"); vi.stubEnv("VERCEL", "");
    expect(() => assertLocalGameSyncRequest(request("http://127.0.0.1:3000/api/game-sync", "http://127.0.0.1:3000"))).not.toThrow();
    expect(() => assertLocalGameSyncRequest(request("http://localhost:3000/api/game-sync", "http://127.0.0.1:3000", "127.0.0.1:3000"))).not.toThrow();
  });
  it("rejects remote hosts, spoofed host and cross-origin mutations", () => {
    vi.stubEnv("MSW_GAME_ROOT", "C:/game"); vi.stubEnv("VERCEL", "");
    for (const req of [
      request("https://editor.example/api/game-sync"),
      request("http://127.0.0.1:3000/api/game-sync", "https://other.example"),
      request("http://127.0.0.1:3000/api/game-sync", undefined, "editor.example"),
    ]) expect(() => assertLocalGameSyncRequest(req)).toThrow();
  });
  it("does not expose local files on hosted or unconfigured instances", () => {
    vi.stubEnv("MSW_GAME_ROOT", "");
    expect(() => assertLocalGameSyncRequest(request("http://localhost:3000/api/game-sync"))).toThrow();
    vi.stubEnv("MSW_GAME_ROOT", "C:/game"); vi.stubEnv("VERCEL", "1");
    expect(() => assertLocalGameSyncRequest(request("http://localhost:3000/api/game-sync"))).toThrow();
  });
});
