import { describe, it, expect } from "vitest";
import { parseRegistry, resolveTile } from "../lib/registry";

// placeholder 로 같은 PNG 를 공유하는 타일이 많아 해시가 유일하지 않을 수 있음(실데이터 발견).
// → 이름 정확매치 1차, 해시는 검증/보조(유일할 때만).
const REG = parseRegistry({
  version: 1,
  entries: [
    { name: "grass", ruid: "RUID_GRASS", hash: "h_grass" },
    { name: "water", ruid: "RUID_WATER", hash: "h_water" },
    // placeholder 공유: 두 타일이 같은 해시
    { name: "ph_a", ruid: "RUID_PH_A", hash: "h_ph" },
    { name: "ph_b", ruid: "RUID_PH_B", hash: "h_ph" },
    { name: "noPng", ruid: "RUID_NOPNG", hash: null },
  ],
});

describe("resolveTile", () => {
  it("이름+해시 일치 → registered", () => {
    const r = resolveTile(REG, "grass", "h_grass");
    expect(r.status).toBe("registered");
    expect(r.ruid).toBe("RUID_GRASS");
  });

  it("이름만(해시 없음/일치) → registered", () => {
    expect(resolveTile(REG, "water").status).toBe("registered");
    expect(resolveTile(REG, "noPng").ruid).toBe("RUID_NOPNG");
  });

  it("같은 이름, 다른 내용 → conflict(자동바인딩 금지)", () => {
    const r = resolveTile(REG, "grass", "h_DIFFERENT");
    expect(r.status).toBe("conflict");
    expect(r.ruid).toBeUndefined();
  });

  it("이름 없고 유일한 해시 → renamed", () => {
    const r = resolveTile(REG, "renamed_grass", "h_grass");
    expect(r.status).toBe("renamed");
    expect(r.ruid).toBe("RUID_GRASS");
  });

  it("이름 없고 해시 모호(placeholder 공유) → new(추측 금지)", () => {
    const r = resolveTile(REG, "unknown", "h_ph");
    expect(r.status).toBe("new");
    expect(r.ruid).toBeUndefined();
  });

  it("아무 신호 없음 → new", () => {
    expect(resolveTile(REG, "totally_new", "h_xyz").status).toBe("new");
    expect(resolveTile(REG, "totally_new").status).toBe("new");
  });
});
