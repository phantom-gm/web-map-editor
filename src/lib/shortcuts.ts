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

// 키(소문자) → 도구 역참조. keydown 에서 e.key.toLowerCase() 로 조회.
export const KEY_TO_TOOL: Record<string, Tool> = Object.fromEntries(
  Object.entries(TOOL_SHORTCUTS).map(([tool, key]) => [key.toLowerCase(), tool]),
) as Record<string, Tool>;
