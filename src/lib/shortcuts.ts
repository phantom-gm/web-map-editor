import type { Tool } from "../store/editorStore";

// 도구 단축키의 단일 출처 — 동작(CanvasGrid keydown)과 툴팁(Toolbar)이 공유한다.
// 여기만 고치면 키 동작과 표시가 함께 바뀐다.
export const TOOL_SHORTCUTS: Partial<Record<Tool, string>> = {
  cursor: "V",
  brush: "B",
  portal: "P",
  monster: "M",
  npc: "N",
  object: "O",
};

// KeyboardEvent.code(물리 키: "KeyV" 등) → 도구. e.key 는 한글 IME/레이아웃에 따라
// 자모("ㅠ")로 바뀌어 매칭이 깨지므로, IME·레이아웃 무관한 code 로 조회한다.
export const CODE_TO_TOOL: Record<string, Tool> = Object.fromEntries(
  Object.entries(TOOL_SHORTCUTS).map(([tool, key]) => [`Key${key}`, tool]),
) as Record<string, Tool>;
