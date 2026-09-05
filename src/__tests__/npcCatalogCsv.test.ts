import { describe, it, expect } from "vitest";
import { buildCatalogFromCsv, catalogFromEntries, parseNpcCatalog } from "../lib/npcClass";

// 게임 CSV 를 에디터 'NPC목록' 로드에 그대로 넣을 수 있어야 한다(연동: 단일 소스).
//
// ⚠ 2026-09-06: 게임 DataSet 재편으로 소스가 한 장 → 네 장이 됐다.
//   (1) NPC·몬스터 표 분리  (2) NpcType 컬럼 소멸  (3) 이름이 로컬라이즈 키로
//   구 스키마 한 장도 계속 받아야 한다(하위호환). 아래 픽스처는 **실제 게임 CSV 헤더 그대로**다.

// 현행 — DataSet/npc/DT_NpcClass.csv
const NPC = `\uFEFFNpcClassID,NpcName,NpcAppearanceID,ModelID,ShopID,ShadowScale,ShadowOffsetY
101,NPCNAME_101,9003,npc,1,4.571429,0
102,NPCNAME_102,,npc,2,4.571429,0
`;
// 현행 — DataSet/monster/DT_MonsterClass.csv
const MON = `\uFEFFMonsterClassID,MonsterName,MonsterStatID,Exp,Level,Grade,MonsterAppearanceID,ModelID
1000,MONSTERNAME_1000,1000,10,1,Normal,9000,monster01
1007,MONSTERNAME_1007,1007,50,5,Normal,9007,monster08
`;
// 현행 — DataSet/locale/ST_NpcName.csv · ST_MonsterName.csv
const ST_NPC = `Key,Source,Note,ko,en
NPCNAME_101,엘드릭,DT_NpcClass.NpcName,엘드릭,
NPCNAME_102,토르칸,DT_NpcClass.NpcName,토르칸,
`;
const ST_MON = `Key,Source,Note,ko,en
MONSTERNAME_1000,말벌,DT_NpcClass.NpcName,말벌,
MONSTERNAME_1007,고블린,DT_NpcClass.NpcName,고블린,
`;
const src = (name: string, text: string) => ({ name, text });

describe("buildCatalogFromCsv — 현행 스키마(4장)", () => {
  const all = [
    src("DT_NpcClass.csv", NPC),
    src("DT_MonsterClass.csv", MON),
    src("ST_NpcName.csv", ST_NPC),
    src("ST_MonsterName.csv", ST_MON),
  ];

  it("두 표를 합치고 종류를 표 출처로 정한다 (NpcType 컬럼이 없다)", () => {
    const { entries, stats } = buildCatalogFromCsv(all);
    expect(entries.map((e) => e.id)).toEqual([101, 102, 1000, 1007]);
    expect(entries.find((e) => e.id === 101)?.type).toBe("Npc");
    expect(entries.find((e) => e.id === 1000)?.type).toBe("Monster");
    expect(stats).toMatchObject({ npc: 2, monster: 2, unresolved: 0 });
  });

  it("ST 키를 실제 이름(ko)으로 해석한다", () => {
    const { entries, warnings } = buildCatalogFromCsv(all);
    expect(entries.map((e) => e.name)).toEqual(["엘드릭", "토르칸", "말벌", "고블린"]);
    expect(warnings).toEqual([]);
  });

  it("파일 순서가 달라도 같다 — 이름표가 뒤에 와도, 앞에 와도", () => {
    const reversed = buildCatalogFromCsv([...all].reverse());
    expect(reversed.entries).toEqual(buildCatalogFromCsv(all).entries);
  });

  it("이름표를 빼면 키가 남고 **경고로 알린다** (조용히 노출되지 않게)", () => {
    const { entries, warnings, stats } = buildCatalogFromCsv([src("DT_NpcClass.csv", NPC)]);
    expect(entries[0].name).toBe("NPCNAME_101");
    expect(stats.unresolved).toBe(2);
    expect(warnings.join()).toContain("이름 미해결");
  });
});

describe("buildCatalogFromCsv — 구 스키마 하위호환", () => {
  // 옛 DataSet/DT_NpcClass.csv — 한 장에 NPC·몬스터가 같이 있고 NpcType 으로 갈렸다.
  const OLD = `\uFEFFNpcClassID,NpcName,NpcType,StatID,Exp,Level,AppearanceID,ModelID
101,엘드릭,Npc,1000,0,1,,npc01
1000,말벌,Monster,1000,10,1,9000,monster01
`;
  it("NpcType 이 있으면 행마다 그 값을 쓴다", () => {
    const { entries, warnings } = buildCatalogFromCsv([src("DT_NpcClass.csv", OLD)]);
    expect(entries).toEqual([
      { id: 101, name: "엘드릭", type: "Npc" },
      { id: 1000, name: "말벌", type: "Monster" },
    ]);
    expect(warnings).toEqual([]); // 이름이 직접 들어 있어 미해결 없음
  });

  it("컬럼 순서가 바뀌어도 헤더 기준으로 매핑", () => {
    const { entries } = buildCatalogFromCsv([src("x.csv", "NpcType,NpcName,NpcClassID\nNpc,엘린,110\n")]);
    expect(entries[0]).toEqual({ id: 110, name: "엘린", type: "Npc" });
  });
});

describe("buildCatalogFromCsv — 방어", () => {
  it("관계없는 CSV 는 건너뛰고 경고한다", () => {
    const { entries, warnings } = buildCatalogFromCsv([src("foo.csv", "foo,bar\n1,2\n")]);
    expect(entries).toEqual([]);
    expect(warnings.join()).toContain("foo.csv");
  });

  it("빈 파일도 죽지 않는다", () => {
    expect(() => buildCatalogFromCsv([src("empty.csv", "")])).not.toThrow();
  });

  it("같은 id 가 겹치면 나중 파일이 이긴다", () => {
    const a = src("a.csv", "NpcClassID,NpcName,NpcType\n101,옛이름,Npc\n");
    const b = src("b.csv", "NpcClassID,NpcName,NpcType\n101,새이름,Npc\n");
    expect(buildCatalogFromCsv([a, b]).entries[0].name).toBe("새이름");
  });
});

describe("catalogFromEntries / parseNpcCatalog — 카탈로그 형태", () => {
  it("CSV 경로가 JSON 경로와 같은 형태로 합류한다", () => {
    const { entries } = buildCatalogFromCsv([src("n.csv", NPC), src("s.csv", ST_NPC)]);
    const cat = catalogFromEntries(entries);
    expect(cat.byId.get(101)).toEqual({ id: 101, name: "엘드릭", type: "Npc" });
    // JSON 스냅샷 경로(구 seed 형태)도 그대로 동작해야 한다.
    const fromJson = parseNpcCatalog({ entries: [{ id: 101, name: "엘드릭", type: "Npc" }] });
    expect(fromJson.byId.get(101)).toEqual(cat.byId.get(101));
  });
});
