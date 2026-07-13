import { describe, it, expect } from "vitest";
import { exportEntities } from "../lib/entityExport";
import type { MapEntity } from "../types/entity";

// 플레이어 대비 렌더 레이어(above/below/auto) export 계약.
// 계약(WEB_MAP_EDITOR_EXPORT_CONTRACT §3): 미지정=auto(동적 기본). above/below 만 명시 emit,
// auto·미설정은 생략 → convert_map 이 누락을 auto 로 해석. (below 를 생략하면 게임서 auto 가 되어버림)
describe("오브젝트 layer export", () => {
  const obj = (layer?: MapEntity["layer"]): MapEntity => ({
    id: "o", kind: "object", gx: 0, gy: 0, ruid: "r", tilesW: 1, tilesH: 1, layer,
  });

  it("above → out.layer='above' (항상 위)", () => {
    expect(exportEntities([obj("above")], [])[0].layer).toBe("above");
  });

  it("below → out.layer='below' (항상 아래 — 명시 emit, 생략하면 auto 됨)", () => {
    expect(exportEntities([obj("below")], [])[0].layer).toBe("below");
  });

  it("auto·미설정 → layer 생략 (convert_map 이 auto 로 해석)", () => {
    expect(exportEntities([obj("auto")], [])[0].layer).toBeUndefined();
    expect(exportEntities([obj(undefined)], [])[0].layer).toBeUndefined();
  });
});
