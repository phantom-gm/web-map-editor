import { activateEditorTool } from "../lib/editorCommands";
import { useWorkspaceSession } from "../lib/gameWorkspace";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import type { ReactNode } from "react";
import { useEditorStore, type Tool, type VisualLayer } from "../store/editorStore";
import { TOOL_SHORTCUTS } from "../lib/shortcuts";

// 보기 토글 — 편집 오버레이 표시 on/off
const VIEW_TOGGLES: Array<{ key: VisualLayer; label: string }> = [
  { key: "grid", label: "격자" },
  { key: "blocked", label: "이동불가" },
  { key: "footprint", label: "점유" },
];

// 라벨에 단축키 힌트 부착 — "커서" → "커서 (V)". 단축키는 shortcuts.ts 단일 출처.
const withShortcut = (label: string, tool: Tool) => {
  const sc = TOOL_SHORTCUTS[tool];
  return sc ? `${label} (${sc})` : label;
};

// 16/24 viewBox, stroke=currentColor — 선택 시 .sel 의 흰색을 그대로 따른다.
const I = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const ICONS: Partial<Record<Tool, ReactNode>> = {
  // 일반 커서(선택) — 마우스 포인터
  cursor: I(<path d="M5 3l0 14 3.5-3.5 2.5 5 2-1-2.5-5L17 12 5 3z" fill="currentColor" stroke="none" />),
  // 브러시 — 손잡이 + 붓털
  brush: I(
    <>
      <path d="M9.5 14.5 18 6a2 2 0 0 1 3 3l-8.5 8.5" />
      <path d="M9.5 14.5c-2.5-.5-4.5 1.5-5 4.5 3 .5 5-1.5 6.5-4z" />
    </>,
  ),
  // 사각 채우기 — 외곽 + 내부 채움
  rect: I(
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <rect x="8" y="8" width="8" height="8" rx="0.5" fill="currentColor" stroke="none" />
    </>,
  ),
  // 지우개
  eraser: I(
    <>
      <path d="M15 4l5 5-9 9H7l-4-4 9-9z" />
      <line x1="6" y1="20" x2="20" y2="20" />
    </>,
  ),
  // 이동불가 — 금지 표시
  block: I(
    <>
      <circle cx="12" cy="12" r="8" />
      <line x1="6.5" y1="6.5" x2="17.5" y2="17.5" />
    </>,
  ),
  // 스포이드 — 피펫
  eyedropper: I(
    <>
      <path d="M16 4l4 4" />
      <path d="M17.5 2.5a2.1 2.1 0 0 1 3 3l-9 9-4 1 1-4 9-9z" />
    </>,
  ),
};

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: "cursor", label: "커서" },
  { id: "brush", label: "브러시" },
  { id: "rect", label: "사각" },
  { id: "eraser", label: "지우개" },
  { id: "block", label: "이동불가 — 좌클릭 생성·우클릭 지우기" },
  { id: "eyedropper", label: "스포이드" },
];

export function Toolbar() {
  const gameSync = useEditorStore(s => s.gameSync);
  const preview = useGamePreviewStore();
  const loading = useWorkspaceSession(s => s.loading);
  const canPaint = !gameSync || (preview.baselineId === gameSync.baselineId && preview.status === "ready" && preview.scene?.report?.groundEditingSupported === true);
  const canBlock = !gameSync || (preview.baselineId === gameSync.baselineId && preview.status === "ready" && preview.scene?.report?.walkEditingSupported === true);
  const tool = useEditorStore(s => s.activeTool);
  const canUndo = useEditorStore(s => s.undoStack.length > 0);
  const canRedo = useEditorStore(s => s.redoStack.length > 0);
  const painted = useEditorStore(s => s.ground.size);
  const blockedCount = useEditorStore(s => s.blocked.size);
  const entityCount = useEditorStore(s => s.entities.length);
  const visual = useEditorStore(s => s.visual);
  const locked = loading || preview.comparisonEnabled;
  const panels: Array<{id: Tool; name: string; marker: string; active: boolean}> = [
    {id: "object", name: "건물·장식", marker: "O", active: preview.showObjects},
    {id: "npc", name: "NPC", marker: "N", active: preview.showNpcs},
    {id: "monster", name: "몬스터", marker: "M", active: preview.runtimePanel === "monster"},
    {id: "portal", name: "포털", marker: "P", active: preview.runtimePanel === "portal"},
    {id: "spawn", name: "시작점", marker: "S", active: preview.runtimePanel === "spawn"},
    {id: "trap", name: "함정", marker: "T", active: preview.runtimePanel === "trap"},
  ];
  const toolNames: Partial<Record<Tool, string>> = { cursor: "선택", brush: "바닥", rect: "사각 채우기", eraser: "지우개", block: "이동불가", eyedropper: "스포이드" };
  const clear = () => {
    const description = gameSync ? "바닥 " + painted + "칸" : "바닥 " + painted + "칸, 이동불가 " + blockedCount + "칸, 배치 " + entityCount + "개";
    if (window.confirm(description + "를 모두 지울까요?\n실행 후 Ctrl+Z로 되돌릴 수 있습니다.")) useEditorStore.getState().clearAll();
  };
  return <div className="toolbar" role="toolbar" aria-label="맵 편집 도구">
    <div className="tool-group">
      <span className="tool-group-label">편집</span>
      {TOOLS.map(t => <button key={t.id} className={"tool-btn" + (tool === t.id ? " sel" : "")}
        title={withShortcut(t.label, t.id)} aria-label={withShortcut(toolNames[t.id] ?? t.label, t.id)}
        aria-pressed={tool === t.id}
        disabled={locked || (t.id === "block" ? !canBlock : t.id !== "cursor" && !canPaint)}
        onClick={() => activateEditorTool(t.id)}>
        {ICONS[t.id]}<span>{toolNames[t.id]}</span>
        {TOOL_SHORTCUTS[t.id] && <kbd>{TOOL_SHORTCUTS[t.id]}</kbd>}
      </button>)}
    </div>
    <div className="tool-group placement-tools" aria-label="배치 종류">
      <span className="tool-group-label">배치</span>
      {(gameSync ? panels : panels.filter(p => p.id !== "spawn" && p.id !== "trap")).map(p => <button key={p.id}
        className={"tool-btn ent-btn" + ((gameSync ? p.active : tool === p.id) ? " sel" : "")}
        aria-label={p.name + (gameSync ? " 목록·편집" : " 배치")} aria-pressed={gameSync ? p.active : tool === p.id}
        title={withShortcut(p.name, p.id)} disabled={locked} onClick={() => activateEditorTool(p.id)}>
        <span className={"kind-marker kind-" + p.id}>{p.marker}</span><span>{p.name}</span>
      </button>)}
    </div>
    <div className="tool-group history-tools">
      <button onClick={() => useEditorStore.getState().undo()} disabled={!canUndo || locked} title="실행 취소 (Ctrl+Z)" aria-label="실행 취소">↶ <span>실행 취소</span></button>
      <button onClick={() => useEditorStore.getState().redo()} disabled={!canRedo || locked} title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행">↷ <span>다시 실행</span></button>
    </div>
    <details className="toolbar-options">
      <summary>보기·설정 <span aria-hidden="true">⌄</span></summary>
      <div className="toolbar-options-popover">
        <strong>편집 표시</strong>
        {VIEW_TOGGLES.filter(v => !gameSync || v.key !== "footprint").map(v => <label key={v.key}>
          <input type="checkbox" checked={visual[v.key] && (!gameSync || preview.showOverlays)} onChange={() => {
            if (gameSync && !preview.showOverlays) {
              preview.setShowOverlays(true);
              if (!visual[v.key]) useEditorStore.getState().toggleVisual(v.key);
            } else useEditorStore.getState().toggleVisual(v.key);
          }} />{v.label}
        </label>)}
        <hr /><strong>일괄 편집</strong>
        <button className="danger-action" disabled={locked || !canPaint || (gameSync ? painted === 0 : painted + blockedCount + entityCount === 0)} onClick={clear}>
          {gameSync ? "바닥 전체 지우기…" : "모든 배치 지우기…"}
        </button>
        <small>개별 삭제는 지우개 또는 대상을 선택한 뒤 Delete</small>
      </div>
    </details>
  </div>;
}
