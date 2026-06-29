import { describe, it, expect } from "vitest";
import { getStore, storeKind } from "../server/registryStore";

// KV 환경변수 없으면 시드 메모리 스토어.
describe("registryStore (memory seed)", () => {
  it("KV env 없으면 memory", () => {
    expect(storeKind()).toBe("memory");
  });

  it("getAll 은 시드(tile_registry)를 반환", async () => {
    const all = await getStore().getAll();
    expect(all.length).toBeGreaterThan(0);
    expect(all.find((e) => e.name === "tile000_0")?.ruid).toBe("3bdc9927f3394f1782f58efc5d0cf676");
  });

  it("appendMany 는 name 기준 덮어쓰기 + 신규 추가", async () => {
    const store = getStore();
    await store.appendMany([
      { name: "tile000_0", ruid: "NEWRUID", hash: null }, // 기존 덮어쓰기
      { name: "zzz_uploaded", ruid: "R2", hash: "h2" }, // 신규
    ]);
    const all = await store.getAll();
    expect(all.find((e) => e.name === "tile000_0")?.ruid).toBe("NEWRUID");
    expect(all.find((e) => e.name === "zzz_uploaded")?.ruid).toBe("R2");
  });
});
