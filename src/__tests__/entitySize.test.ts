import { describe, it, expect } from "vitest";
import { footprintWH, renderWH, migrateEntity, type MapEntity } from "../types/entity";

// 오브젝트 이미지 크기(renderWH=baseW) 와 점유/충돌(footprintWH=tilesW) 분리 회귀 테스트.
// W×H(점유) 를 바꿔도 이미지 렌더 기준은 그대로여야 한다.
describe("오브젝트 크기/점유 분리", () => {
  const obj = (p: Partial<MapEntity>): MapEntity => ({ id: "x", kind: "object", gx: 0, gy: 0, ...p });

  it("baseW 가 있으면 renderWH 는 baseW 를 쓰고 tilesW 변경에 영향받지 않는다", () => {
    const e = obj({ baseW: 3, baseH: 1, tilesW: 5, tilesH: 4 });
    expect(renderWH(e)).toEqual([3, 1]); // 이미지 = 배치 시 고정
    expect(footprintWH(e)).toEqual([5, 4]); // 점유(충돌) = 현재 W×H
  });

  it("migrateEntity 는 baseW 없는 레거시 object 를 현재 tilesW/tilesH 로 1회 고정한다", () => {
    const m = migrateEntity(obj({ tilesW: 3, tilesH: 2 }));
    expect(m.baseW).toBe(3);
    expect(m.baseH).toBe(2);
    // 이후 점유만 바꿔도 renderWH 는 고정된 base 유지
    expect(renderWH({ ...m, tilesW: 8, tilesH: 8 })).toEqual([3, 2]);
  });

  it("monster/npc 는 baseW 를 부여하지 않아 기존처럼 tilesW 가 이미지도 결정한다", () => {
    const mob = migrateEntity(obj({ kind: "monster", tilesW: 2, tilesH: 1 }));
    expect(mob.baseW).toBeUndefined();
    expect(renderWH(mob)).toEqual([2, 1]); // tilesW 폴백
  });
});
