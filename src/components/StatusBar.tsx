import { useEditorStore, type Tool } from "../store/editorStore";

const TOOL_LABEL: Record<Tool, string> = {
  cursor: "커서",
  brush: "브러시",
  rect: "사각",
  eraser: "지우개",
  block: "이동불가",
  eyedropper: "스포이드",
  portal: "포탈 배치",
  monster: "몬스터 배치",
  npc: "NPC 배치",
  object: "오브젝트 배치",
};

export function StatusBar() {
  const hover = useEditorStore((s) => s.hover);
  const size = useEditorStore((s) => s.size);
  const zoom = useEditorStore((s) => s.camera.zoom);
  const tool = useEditorStore((s) => s.activeTool);
  const activeIdx = useEditorStore((s) => s.activeIdx);
  const palette = useEditorStore((s) => s.palette);
  const painted = useEditorStore((s) => s.ground.size);
  const blockedCount = useEditorStore((s) => s.blocked.size);
  const entityCount = useEditorStore((s) => s.entities.length);

  const inRange =
    hover != null && hover[0] >= 0 && hover[1] >= 0 && hover[0] < size[0] && hover[1] < size[1];
  // 타일/스프라이트 에셋을 쓰는 도구는 활성 팔레트 타일명을, 그 외(포탈/지우개 등)는 도구명 표시.
  const usesTile =
    tool === "brush" || tool === "rect" || tool === "eyedropper" || tool === "monster" || tool === "npc" || tool === "object";
  const activeName = usesTile ? palette[activeIdx]?.name ?? "(타일 없음)" : TOOL_LABEL[tool];

  return (
    <div className="statusbar">
      <span>셀: {inRange ? `(${hover![0]}, ${hover![1]})` : "—"}</span>
      <span>
        맵: {size[0]}×{size[1]}
      </span>
      <span>도구: {TOOL_LABEL[tool]}</span>
      <span>활성: {activeName}</span>
      <span>
        셀 {painted} · 이동불가 {blockedCount} · 엔티티 {entityCount}
      </span>
      <span>줌: {Math.round(zoom * 100)}%</span>
    </div>
  );
}
