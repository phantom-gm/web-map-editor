import type { ReactNode } from "react";
import { useEditorStore, type Tool } from "../store/editorStore";
import { ENTITY_KINDS, ENTITY_META } from "../types/entity";

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
  { id: "cursor", label: "커서 (V)" },
  { id: "brush", label: "브러시 (B)" },
  { id: "rect", label: "사각" },
  { id: "eraser", label: "지우개" },
  { id: "block", label: "이동불가 — 좌클릭 생성·우클릭 지우기" },
  { id: "eyedropper", label: "스포이드" },
];

export function Toolbar() {
  const tool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);
  const clearAll = useEditorStore((s) => s.clearAll);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.undoStack.length > 0);
  const canRedo = useEditorStore((s) => s.redoStack.length > 0);
  const painted = useEditorStore((s) => s.ground.size);
  const blockedCount = useEditorStore((s) => s.blocked.size);

  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={"tool-btn" + (tool === t.id ? " sel" : "")}
          data-label={t.label}
          aria-label={t.label}
          aria-pressed={tool === t.id}
          onClick={() => setTool(t.id)}
        >
          {ICONS[t.id]}
        </button>
      ))}
      <span className="sep" />
      {ENTITY_KINDS.map((k) => {
        const meta = ENTITY_META[k];
        return (
          <button
            key={k}
            className={"tool-btn ent-btn" + (tool === k ? " sel" : "")}
            data-label={`${meta.label} 배치`}
            aria-label={`${meta.label} 배치`}
            aria-pressed={tool === k}
            onClick={() => setTool(k)}
          >
            <span className="ent-badge" style={{ background: meta.color }}>
              {meta.marker}
            </span>
          </button>
        );
      })}
      <span className="sep" />
      <button onClick={undo} disabled={!canUndo} title="실행취소 (⌘/Ctrl+Z)">
        ↶ 취소
      </button>
      <button onClick={redo} disabled={!canRedo} title="다시실행 (⌘/Ctrl+Shift+Z)">
        ↷ 다시
      </button>
      <button onClick={clearAll} disabled={painted === 0 && blockedCount === 0}>
        전체 지우기
      </button>
      <span className="toolbar-info">
        칠해진 셀: {painted} · 이동불가: {blockedCount}
      </span>
    </div>
  );
}
