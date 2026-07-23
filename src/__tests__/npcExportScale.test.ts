import { describe, it, expect } from "vitest";
import { exportEntities } from "../lib/entityExport";
import type { MapEntity } from "../types/entity";
import type { PaletteTile } from "../lib/palette";

// npc 는 스폰 경로(DT_NpcSpawn)라 object 파이프라인을 안 타서 **시각 계약(scale)이 통째로 빠져 있었다**.
//   그 결과 게임이 Transform.Scale=1 로 스폰 → 네이티브 픽셀 그대로 → 에디터보다 몇 배 큼.
//   실측: 엘드릭 256×256, 점유 1×1 → 에디터 1타일 vs 게임 약 4.6타일(사용자 신고).
//   이제 object 와 동일 수식 scale = (renderW × 56) / naturalWidth × scaleMul 로 내보낸다.
const tile = (name: string, ruid: string, w: number, h: number): PaletteTile =>
  ({ name, ruid, category: "npc", img: { naturalWidth: w, naturalHeight: h } } as unknown as PaletteTile);

const npc = (p: Partial<MapEntity>): MapEntity =>
  ({ id: "n", kind: "npc", gx: 8, gy: 9, ruid: "R1", tilesW: 1, tilesH: 1, npcClassId: 101, ...p });

const PAL = [tile("엘드릭_SE", "R1", 256, 256)];

describe("npc scale export (거대화 방지)", () => {
  it("256px 스프라이트 + 점유 1×1 → scale 0.2188 (=56/256)", () => {
    expect(exportEntities([npc({})], PAL)[0].scale).toBe(0.2188);
  });

  it("점유 2×2 면 2배 (0.4375) — 저작 크기를 따른다", () => {
    expect(exportEntities([npc({ tilesW: 2, tilesH: 2 })], PAL)[0].scale).toBe(0.4375);
  });

  it("flipX·npcClassId 등 저작 필드는 그대로 통과", () => {
    const out = exportEntities([npc({ flipX: true })], PAL)[0];
    expect(out.flipX).toBe(true);
    expect(out.npcClassId).toBe(101);
  });

  it("팔레트 이미지 미해석이면 scale 생략(원본 유지) — 잘못된 값으로 굽지 않는다", () => {
    expect(exportEntities([npc({})], [])[0].scale).toBeUndefined();
  });

  it("monster 는 건드리지 않는다 — 모델에 구운 스프라이트로 정상 동작 중(회귀 차단)", () => {
    const mon = { ...npc({}), id: "m", kind: "monster" as const, npcClassId: 1000 };
    expect(exportEntities([mon], PAL)[0].scale).toBeUndefined();
  });
});
