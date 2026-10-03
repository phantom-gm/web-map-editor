import { useRef, useState } from "react";
import { useEditorStore, type Tool } from "../store/editorStore";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import { useWorkspaceSession } from "../lib/gameWorkspace";

const GUIDES: Record<Tool, [string, string]> = {
  cursor: ["선택", "대상을 클릭해서 선택 · 드래그로 이동"],
  brush: ["바닥 칠하기", "왼쪽에서 바닥 소재 선택 → 맵에서 클릭하거나 드래그"],
  rect: ["사각 채우기", "시작 칸부터 끝 칸까지 드래그 · Esc로 취소"],
  eraser: ["바닥 지우기", "클릭하거나 드래그해서 바닥 삭제 · Ctrl+Z로 되돌리기"],
  block: ["이동불가", "왼쪽 클릭으로 막기 · 오른쪽 클릭으로 해제"],
  eyedropper: ["소재 선택", "맵의 바닥을 클릭해 같은 소재 선택"],
  object: ["건물·장식", "왼쪽 목록에서 소재를 선택한 뒤 놓을 위치 클릭"],
  npc: ["NPC", "왼쪽 목록에서 NPC를 선택한 뒤 놓을 칸 클릭"],
  monster: ["몬스터", "왼쪽 목록에서 몬스터를 선택한 뒤 놓을 칸 클릭"],
  portal: ["포털", "도착할 맵과 위치를 설정한 뒤 놓을 칸 클릭"],
  spawn: ["시작점", "플레이어가 시작할 칸 클릭"],
};

export function CanvasChrome({ onZoom }: { onZoom: (factor: number) => void }) {
  const tool = useEditorStore(s => s.activeTool);
  const zoom = useEditorStore(s => s.camera.zoom);
  const linked = useEditorStore(s => !!s.gameSync);
  const pristine = useEditorStore(s => !s.gameSync && s.mapName === "newmap" && !s.ground.size && !s.blocked.size && !s.entities.length);
  const resetNonce = useEditorStore(s => s.resetNonce);
  const loading = useWorkspaceSession(s => s.loading);
  const preview = useGamePreviewStore();
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const help = useRef<HTMLDialogElement>(null);
  const welcome = pristine && dismissedAt !== resetNonce && !loading;
  let [title, guide] = GUIDES[tool];
  if (preview.comparisonEnabled) { title = "변경 비교"; guide = "왼쪽 변경 목록에서 위치 확인 · Esc로 편집 돌아가기"; }
  else if (linked && preview.runtimePlacement) { [title, guide] = GUIDES[preview.runtimePlacement.kind]; }
  else if (linked && preview.placementNpcClassId !== null) { title = "NPC 배치 중"; guide = "놓을 칸을 클릭 · Esc로 배치 취소"; }
  else if (linked && preview.placementPrototypeId) { title = "오브젝트 배치 중"; guide = "놓을 위치를 클릭 · Esc로 배치 취소"; }
  else if (linked && preview.selectionMode === "blocked") { title = "이동불가 칸 선택"; guide = "드래그로 범위 선택 · 선택한 칸만 함께 이동"; }

  return <>
    {!welcome && !loading && <div className="canvas-context" aria-live="polite"><strong>{title}</strong><span>{guide}</span></div>}
    {welcome && <section className="canvas-welcome" aria-label="맵 편집 시작">
      <span className="welcome-eyebrow">LEGEND OF LIGHT · MAP EDITOR</span>
      <h1>어떤 맵을 편집할까요?</h1>
      <p>상단에서 게임 맵을 선택해 열면<br />이전에 저장한 작업부터 이어서 편집할 수 있어요.</p>
      <button className="primary-action" onClick={() => window.dispatchEvent(new Event("msw:open-map"))}>선택한 맵 열기 <span aria-hidden="true">→</span></button>
      <ol className="welcome-steps"><li><b>1</b>맵 열기</li><li><b>2</b>배치·수정</li><li><b>3</b>저장·출력</li></ol>
      <button className="welcome-secondary" onClick={() => setDismissedAt(resetNonce)}>빈 작업 공간 사용</button>
    </section>}
    {loading && <div className="canvas-loading" role="status"><span className="loading-orbit" />맵과 배치 이미지를 불러오는 중…</div>}
    <div className="canvas-navigation" aria-label="화면 조절">
      <span className="navigation-hint">Space + 드래그로 화면 이동</span>
      <div className="zoom-controls">
        <button onClick={() => onZoom(1 / 1.2)} aria-label="축소" title="축소">−</button>
        <button onClick={() => onZoom(1 / zoom)} className="zoom-value" title="클릭하면 100% 배율" aria-label={"현재 배율 " + Math.round(zoom * 100) + "%, 100%로 맞추기"}>{Math.round(zoom * 100)}%</button>
        <button onClick={() => onZoom(1.2)} aria-label="확대" title="확대">＋</button>
      </div>
      <button onClick={() => useEditorStore.getState().requestFit()} title="맵 전체가 보이도록 화면 맞춤">전체 보기</button>
      <button className="help-trigger" onClick={() => help.current?.showModal()} aria-label="사용법과 단축키">?</button>
    </div>
    <dialog className="editor-help-dialog" ref={help} onKeyDown={e => e.stopPropagation()} aria-labelledby="editor-help-title">
      <div className="help-dialog-head"><h2 id="editor-help-title">빠르게 익히는 맵 편집</h2><button onClick={() => help.current?.close()} aria-label="사용법 닫기">닫기</button></div>
      <p>소재는 MSW 서버에서 불러옵니다. 게임 맵은 작업을 자동 저장하며, 게임에 넣을 파일은 상단의 출력 버튼으로 만듭니다.</p>
      <dl className="shortcut-list">
        <dt>화면 이동</dt><dd><kbd>Space</kbd> + 드래그 또는 마우스 가운데 버튼</dd>
        <dt>확대·축소</dt><dd>마우스 휠 · 오른쪽 아래 배율 버튼</dd>
        <dt>선택 / 바닥 칠하기</dt><dd><kbd>V</kbd> / <kbd>B</kbd></dd>
        <dt>건물·장식 / NPC</dt><dd><kbd>O</kbd> / <kbd>N</kbd></dd>
        <dt>몬스터 / 포털</dt><dd><kbd>M</kbd> / <kbd>P</kbd></dd>
        <dt>선택 대상 한 칸 이동</dt><dd>방향키</dd>
        <dt>선택 대상 삭제</dt><dd><kbd>Delete</kbd></dd>
        <dt>실행 취소 / 다시 실행</dt><dd><kbd>Ctrl + Z</kbd> / <kbd>Ctrl + Shift + Z</kbd></dd>
        <dt>저장 / 배치·선택 취소</dt><dd><kbd>Ctrl + S</kbd> / <kbd>Esc</kbd></dd>
      </dl>
      <p className="help-note">숫자는 입력 후 Enter를 누르거나 다른 곳을 클릭하면 반영됩니다. Mac에서는 Ctrl 대신 ⌘를 사용하세요.</p>
    </dialog>
  </>;
}
