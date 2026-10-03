import { useEditorStore, type Tool } from "../store/editorStore";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import { selectSouthCounts } from "../store/southSelectors";

const TOOL_LABEL: Record<Tool, string> = {
  spawn: "시작점",
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
  const linked = useEditorStore(s => !!s.gameSync);
  const preview = useGamePreviewStore();
  const hover = useEditorStore((s) => s.hover);
  const size = useEditorStore((s) => s.size);
  const zoom = useEditorStore((s) => s.camera.zoom);
  const tool = useEditorStore((s) => s.activeTool);
  const activeIdx = useEditorStore((s) => s.activeIdx);
  const palette = useEditorStore((s) => s.palette);
  const painted = useEditorStore((s) => s.ground.size);
  const blockedCount = useEditorStore((s) => s.blocked.size);
  const entityCount = useEditorStore((s) => s.entities.length);
  // 1×1 오브젝트 남쪽 침범(요청서 R1) 건수 — 엔티티/이동불가가 바뀔 때만 다시 센다(버전 memo selector).
  const south = useEditorStore(selectSouthCounts);

  const inRange =
    hover != null && hover[0] >= 0 && hover[1] >= 0 && hover[0] < size[0] && hover[1] < size[1];
  // 타일/스프라이트 에셋을 쓰는 도구는 활성 팔레트 타일명을, 그 외(포탈/지우개 등)는 도구명 표시.
  const usesTile =
    tool === "brush" || tool === "rect" || tool === "eyedropper" || tool === "monster" || tool === "npc" || tool === "object";
  const activeName = linked && tool === "object"
    ? preview.scene?.objectPrototypes?.find(object => object.prototypeId === preview.placementPrototypeId)?.name ?? "원본 소재 선택"
    : usesTile ? palette[activeIdx]?.name ?? "(타일 없음)" : TOOL_LABEL[tool];

  return (
    <div className="statusbar">
      <span>셀: {inRange ? `(${hover![0]}, ${hover![1]})` : "—"}</span>
      <span>
        맵: {size[0]}×{size[1]}
      </span>
      <span>도구: {TOOL_LABEL[tool]}</span>
      <span>활성: {activeName}</span>
      <span>
        셀 {painted} · 이동불가 {blockedCount} · {linked ? `오브젝트 ${preview.scene?.objects?.length ?? 0}` : `엔티티 ${entityCount}`}
      </span>
      {!linked && (south.block > 0 || south.watch > 0) && (
        <span title="1×1 지면 오브젝트의 정렬 바닥선이 앞 칸 중심에 붙었거나 넘었습니다 — 오브젝트를 선택하면 바닥선과 처방이 보입니다">
          정렬 바닥선: {south.block > 0 && <b className="sb-block">차단 {south.block}</b>}
          {south.block > 0 && south.watch > 0 && " · "}
          {south.watch > 0 && <b className="sb-warn">경고 {south.watch}</b>}
        </span>
      )}
      <span>줌: {Math.round(zoom * 100)}%</span>
    </div>
  );
}
