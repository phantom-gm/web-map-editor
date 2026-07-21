import { describe, it, expect } from "vitest";
import { exportEntities } from "../lib/entityExport";
import type { MapEntity } from "../types/entity";

// 오브젝트 layer export 계약: above/below 는 **고정 평면**으로 내보내고, auto/미설정은 생략(convert_map 이
//   auto 로 해석). 큰 구조물(다리 등)은 단일 z 자동정렬이 불가능하므로 조각별 above/below 고정이 필요하다
//   (데크=below, 가까운 난간=above). 자동정렬은 작은 오브젝트에만 신뢰 가능.
describe("오브젝트 layer export", () => {
  const obj = (layer?: MapEntity["layer"]): MapEntity => ({
    id: "o", kind: "object", gx: 0, gy: 0, ruid: "r", tilesW: 1, tilesH: 1, layer,
  });

  it("above/below 는 그대로 내보낸다 (큰 구조물 고정 평면)", () => {
    expect(exportEntities([obj("above")], [])[0].layer).toBe("above");
    expect(exportEntities([obj("below")], [])[0].layer).toBe("below");
  });

  it("auto·미설정은 layer 생략 (convert_map 이 auto 로 해석)", () => {
    expect(exportEntities([obj("auto")], [])[0].layer).toBeUndefined();
    expect(exportEntities([obj(undefined)], [])[0].layer).toBeUndefined();
  });
});
