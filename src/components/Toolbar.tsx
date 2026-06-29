import { useEditorStore, type Tool } from "../store/editorStore";

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: "brush", label: "브러시" },
  { id: "rect", label: "사각" },
  { id: "eraser", label: "지우개" },
  { id: "block", label: "이동불가" },
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
        <button key={t.id} className={tool === t.id ? "sel" : ""} onClick={() => setTool(t.id)}>
          {t.label}
        </button>
      ))}
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
