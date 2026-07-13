import { describe, it, expect } from "vitest";
import { toolForCategory } from "../store/editorStore";

// 팔레트 타일 category(스토리지 subcategory) → 선택 시 활성 도구.
describe("toolForCategory", () => {
  it("foothold → 브러시(바닥 타일)", () => {
    expect(toolForCategory("foothold")).toBe("brush");
    expect(toolForCategory("FootHold")).toBe("brush"); // 대소문자 무관
  });
  it("npc → npc 배치, monster → monster 배치", () => {
    expect(toolForCategory("npc")).toBe("npc");
    expect(toolForCategory("monster")).toBe("monster");
  });
  it("그 외(object/background/폴더명/미설정) → 오브젝트 배치", () => {
    expect(toolForCategory("object")).toBe("object");
    expect(toolForCategory("background")).toBe("object");
    expect(toolForCategory("내폴더")).toBe("object");
    expect(toolForCategory(undefined)).toBe("object");
    expect(toolForCategory("")).toBe("object");
  });
});
