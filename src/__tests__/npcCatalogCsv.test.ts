import { describe, it, expect } from "vitest";
import { npcCsvToRows, parseNpcCatalog } from "../lib/npcClass";

// 게임 DT_NpcClass.csv 를 에디터 'NPC목록' 로드에 그대로 넣을 수 있어야 한다(연동: 단일 소스).
const CSV = `\uFEFFNpcClassID,NpcName,NpcType,StatID,Exp,Level,Grade,AtkNature,DefNature,IsAggressive,AppearanceID,ModelID
101,엘드릭,Npc,1000,0,1,Normal,Earth,Earth,FALSE,,npc01
1000,말벌,Monster,1000,10,1,Normal,Wind,Wind,TRUE,9000,monster01
`;

describe("npcCsvToRows — DT_NpcClass.csv 직접 로드", () => {
  it("BOM·추가컬럼 무관하게 id/name/type 추출", () => {
    const rows = npcCsvToRows(CSV);
    expect(rows).toEqual([
      { NpcClassID: "101", NpcName: "엘드릭", NpcType: "Npc" },
      { NpcClassID: "1000", NpcName: "말벌", NpcType: "Monster" },
    ]);
  });

  it("parseNpcCatalog 로 이어 붙이면 카탈로그가 된다", () => {
    const cat = parseNpcCatalog(npcCsvToRows(CSV));
    expect(cat.byId.get(101)).toEqual({ id: 101, name: "엘드릭", type: "Npc" });
    expect(cat.byId.get(1000)?.type).toBe("Monster");
  });

  it("컬럼 순서가 바뀌어도 헤더 기준으로 매핑", () => {
    const rows = npcCsvToRows("NpcType,NpcName,NpcClassID\nNpc,엘린,110\n");
    expect(rows[0]).toEqual({ NpcClassID: "110", NpcName: "엘린", NpcType: "Npc" });
  });

  it("NpcClassID 컬럼 없으면 빈 배열(DT_NpcClass 아님)", () => {
    expect(npcCsvToRows("foo,bar\n1,2\n")).toEqual([]);
  });
});
