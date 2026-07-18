import { describe, it, expect } from "vitest";
import { exportEntities } from "../lib/entityExport";
import type { MapEntity } from "../types/entity";

// 오브젝트 layer export 계약: **항상 auto**. 인스펙터의 above/below 수동 선택은 제거됐다
// (정렬이 스프라이트 발위치 기준으로 정확해져 수동 레이어가 불필요). layer 를 아예 emit 안 하면
// convert_map 이 auto 로 해석한다. 레거시 데이터에 above/below 가 남아 있어도 auto 로 강제한다.
describe("오브젝트 layer export (항상 auto)", () => {
  const obj = (layer?: MapEntity["layer"]): MapEntity => ({
    id: "o", kind: "object", gx: 0, gy: 0, ruid: "r", tilesW: 1, tilesH: 1, layer,
  });

  it("레거시 above/below 는 무시하고 layer 를 생략한다 (auto 강제)", () => {
    expect(exportEntities([obj("above")], [])[0].layer).toBeUndefined();
    expect(exportEntities([obj("below")], [])[0].layer).toBeUndefined();
  });

  it("auto·미설정도 layer 생략 (convert_map 이 auto 로 해석)", () => {
    expect(exportEntities([obj("auto")], [])[0].layer).toBeUndefined();
    expect(exportEntities([obj(undefined)], [])[0].layer).toBeUndefined();
  });
});
