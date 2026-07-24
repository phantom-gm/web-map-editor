import { describe, it, expect } from "vitest";
import { sortEntitiesForDraw } from "../lib/entityGeom";
import type { MapEntity } from "../types/entity";

// 게임(IsoPlayerDepthLogic/MonsterAppearanceComponent)이 플레이어·NPC·몬스터를 큰 건물 footprint
//   안에서 앞(위)으로 올리는 것과 동일한 시각을 에디터가 재현해야 한다(사용자 신고: NPC 가 여관에 가려짐).
const idx = (arr: MapEntity[], id: string) => arr.findIndex((e) => e.id === id);

describe("sortEntitiesForDraw — 오브젝트 점유 위 엔티티는 위로", () => {
  // 여관(anchor 14,9, 9×3) footprint ≈ [6..14]×[7..9]. NPC(8,9) 는 그 안.
  const inn: MapEntity = { id: "inn", kind: "object", gx: 14, gy: 9, ruid: "r", tilesW: 9, tilesH: 3 };
  const npc: MapEntity = { id: "npc", kind: "npc", gx: 8, gy: 9, npcClassId: 101 };

  it("footprint 안 NPC 는 오브젝트보다 뒤에 정렬(=나중에 그려짐=위)", () => {
    const s = sortEntitiesForDraw([inn, npc]);
    expect(idx(s, "npc")).toBeGreaterThan(idx(s, "inn")); // npc 가 배열 뒤 = 위에 그려짐
  });

  it("footprint 밖(북서) NPC 는 오브젝트에 가려짐(앞에 정렬=먼저 그려짐)", () => {
    const outside: MapEntity = { id: "npc", kind: "npc", gx: 3, gy: 5, npcClassId: 101 };
    const s = sortEntitiesForDraw([inn, outside]);
    expect(idx(s, "npc")).toBeLessThan(idx(s, "inn")); // 여관 뒤(북서) → 여관에 가려짐
  });

  it("1×1 오브젝트는 점유 규칙 대상 아님(멀티셀만)", () => {
    const smallObj: MapEntity = { id: "o1", kind: "object", gx: 8, gy: 9, ruid: "r", tilesW: 1, tilesH: 1 };
    const n: MapEntity = { id: "npc", kind: "npc", gx: 8, gy: 8, npcClassId: 101 };
    // n(gy8) 은 o1(gy9) 보다 뒤줄 → 자연스레 뒤. 점유 bump 없음.
    const s = sortEntitiesForDraw([smallObj, n]);
    expect(idx(s, "npc")).toBeLessThan(idx(s, "o1"));
  });

  it("layer=above/below 밴드는 점유와 무관하게 유지", () => {
    const above = { ...inn, id: "inn", layer: "above" as const };
    const s = sortEntitiesForDraw([above, npc]);
    // above 오브젝트는 항상 최상단 밴드 → NPC 보다 뒤(위)
    expect(idx(s, "inn")).toBeGreaterThan(idx(s, "npc"));
  });
});
