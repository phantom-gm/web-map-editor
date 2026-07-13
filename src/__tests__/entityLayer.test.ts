import { describe, it, expect } from "vitest";
import { exportEntities } from "../lib/entityExport";
import type { MapEntity } from "../types/entity";

// 플레이어 대비 렌더 레이어(above/below/auto) export 계약.
// below(기본)는 생략, above/auto 만 out.layer 로 emit → convert_map/build_map 가 밴드 결정.
describe("오브젝트 layer export", () => {
  const obj = (layer?: MapEntity["layer"]): MapEntity => ({
    id: "o", kind: "object", gx: 0, gy: 0, ruid: "r", tilesW: 1, tilesH: 1, layer,
  });

  it("above → out.layer='above'", () => {
    const [e] = exportEntities([obj("above")], []);
    expect(e.layer).toBe("above");
  });

  it("auto → out.layer='auto' (방식 B 예약)", () => {
    const [e] = exportEntities([obj("auto")], []);
    expect(e.layer).toBe("auto");
  });

  it("below/미설정 → layer 생략(기본 아래)", () => {
    expect(exportEntities([obj("below")], [])[0].layer).toBeUndefined();
    expect(exportEntities([obj(undefined)], [])[0].layer).toBeUndefined();
  });
});
