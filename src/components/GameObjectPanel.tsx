import { useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import { useWorkspaceSession } from "../lib/gameWorkspace";
import { objectCellOffset } from "../lib/gameObjectPreview";
import { previewSpriteGeometry, previewWorldToScreen } from "../lib/gamePreview";
import type { GameObjectDescriptor } from "../lib/gameObjects";
import { NumberField } from "./NumberField";

export function selectBlockedMode() {
  const preview = useGamePreviewStore.getState(), editor = useEditorStore.getState();
  if (preview.status !== "ready" || preview.scene?.baselineId !== editor.gameSync?.baselineId || preview.scene?.report?.walkEditingSupported !== true) return;
  preview.setSelectionMode("blocked"); preview.setShowObjects(true);
  preview.setShowScene(true); preview.setShowOverlays(true);
  if (!editor.visual.blocked) editor.toggleVisual("blocked");
  editor.setTool("cursor");
}
function focusObject(object: GameObjectDescriptor) {
  const preview = useGamePreviewStore.getState(), editor = useEditorStore.getState();
  const rect = document.querySelector(".canvas-wrap")?.getBoundingClientRect();
  if (!rect || !preview.scene) return;
  const sprite = preview.scene.sprites.find(item => item.objectEntityId === object.entityId);
  const asset = sprite && preview.images.get(sprite.ruid)?.asset;
  let center = previewWorldToScreen(object.position, preview.scene, editor.camera);
  if (sprite && asset) {
    const [x0, y0, x1, y1] = previewSpriteGeometry(sprite, asset, preview.scene, editor.camera).bounds;
    center = [(x0 + x1) / 2, (y0 + y1) / 2];
  }
  editor.setCamera({ ...editor.camera, x: editor.camera.x + rect.width / 2 - center[0],
    y: editor.camera.y + rect.height / 2 - center[1] });
}
export function GameObjectLibrary() {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const preview = useGamePreviewStore();
  const linked = useEditorStore(s => s.gameSync);
  const selected = useEditorStore(s => s.selectedGameObjectIds);
  const loading = useWorkspaceSession(s => s.loading);
  const current = preview.scene?.baselineId === linked?.baselineId;
  const objects = current ? preview.scene?.objects ?? [] : [];
  const prototypes = current ? preview.scene?.objectPrototypes ?? [] : [];
  const unique = new Map<string, GameObjectDescriptor>();
  for (const object of prototypes) if (object.canDuplicate && !unique.has(object.ruid + object.name)) unique.set(object.ruid + object.name, object);
  const items = (adding ? [...unique.values()] : objects).filter(object => !search ||
    object.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) || object.entityId.includes(search));
  const ready = current && preview.status === "ready" && !loading;
  return <section className="game-object-library" aria-label="게임 오브젝트 목록">
    <div className="palette-head"><strong>건물·장식·오브젝트 바닥</strong>
      <button onClick={() => { preview.setShowObjects(false); preview.setSelectionMode("objects"); useEditorStore.getState().setTool("brush"); }}>바닥 소재</button>
    </div>
    <div className="object-tabs">
      <button aria-pressed={!adding} onClick={() => setAdding(false)}>배치된 오브젝트 {objects.length}</button>
      <button aria-pressed={adding} onClick={() => setAdding(true)}>원본 소재로 추가</button>
    </div>
    <input className="object-search" aria-label="오브젝트 검색" placeholder="건물·나무·광산바닥 검색" value={search} onChange={e => setSearch(e.target.value)} />
    <p className="object-help">{adding ? "원본 모양을 선택한 뒤 맵을 클릭하면 추가합니다." : "Ctrl·Shift+클릭으로 여러 개를 선택합니다. Shift+빈 곳 드래그로 범위를 추가하고, 선택한 대상을 잡아 함께 옮깁니다."}</p>
    {!adding && <div className="object-selection-tools">
      <button aria-pressed={preview.multiSelect} onClick={() => {
        preview.setMultiSelect(!preview.multiSelect); preview.setSelectionMode("objects");
        useEditorStore.getState().setTool("cursor");
      }}>여러 개 선택 {preview.multiSelect ? "켜짐" : "꺼짐"}</button>
      <button aria-pressed={preview.selectionMode === "blocked"} disabled={!ready || preview.scene?.report?.walkEditingSupported !== true} onClick={selectBlockedMode}>이동불가 칸 선택</button>
    </div>}
    {preview.placementPrototypeId && <div className="object-placement" role="status">추가 위치를 클릭하세요. <button onClick={() => {
      preview.setPlacementPrototype(null); useEditorStore.getState().setTool("cursor");
    }}>배치 취소 (Esc)</button></div>}
    <div className="game-object-list">
      {items.map((object, i) => <button key={object.entityId} className={"game-object-item" + (selected.includes(object.entityId) && !adding ? " selected" : "")}
        disabled={!ready} aria-label={(adding ? "추가 소재 " : "맵 오브젝트 ") + (i + 1) + " " + object.name}
        title={object.reason || object.name} aria-pressed={!adding && selected.includes(object.entityId)} onClick={e => {
          preview.setShowScene(true); preview.setSelectionMode("objects");
          if (adding) {
            preview.setPlacementPrototype(object.prototypeId); useEditorStore.getState().setTool("object");
          } else {
            preview.setPlacementPrototype(null); useEditorStore.getState().setTool("cursor");
            useEditorStore.getState().selectGameObjects([object.entityId], e.ctrlKey || e.metaKey || e.shiftKey || preview.multiSelect ? "toggle" : "replace");
          }
        }}>
        {preview.images.get(object.ruid)?.image.src && <img src={preview.images.get(object.ruid)!.image.src} alt="" />}
        <span>{object.name}<small>{adding ? "클릭하여 추가 배치" : object.canMove ? "선택 · 이동" : "원본 보존"}</small></span>
      </button>)}
      {!items.length && <p className="object-help">{ready ? "검색 결과가 없습니다." : "게임 오브젝트를 읽는 중…"}</p>}
    </div>
    <p className="object-help">함께 옮길 이동불가 칸은 직접 선택하세요. 선택된 칸만 오브젝트와 함께 이동·복제됩니다.</p>
  </section>;
}

export function GameObjectInspector() {
  const [deltaX, setDeltaX] = useState(1), [deltaY, setDeltaY] = useState(0);
  const selected = useEditorStore(s => s.selectedGameObjectIds);
  const cells = useEditorStore(s => s.selectedBlockedCells);
  const error = useEditorStore(s => s.gameSelectionError);
  const gameSync = useEditorStore(s => s.gameSync);
  const preview = useGamePreviewStore();
  const loading = useWorkspaceSession(s => s.loading);
  const scene = preview.scene?.baselineId === gameSync?.baselineId ? preview.scene : null;
  const objects = selected.map(id => scene?.objects?.find(item => item.entityId === id)).filter((item): item is GameObjectDescriptor => !!item);
  const object = objects[objects.length - 1];
  const pickingCells = preview.selectionMode === "blocked";
  if (!gameSync || !scene || (!selected.length && !cells.length && !pickingCells && !error)) return null;
  const locked = loading || preview.status !== "ready" || objects.length !== selected.length;
  const hasSelection = !!(selected.length || cells.length);
  const canEditCells = scene.report?.walkEditingSupported === true;
  const selectionReady = !locked && (!cells.length || canEditCells);
  const canMove = hasSelection && selectionReady && objects.every(item => item.canMove);
  const canCopy = hasSelection && selectionReady && objects.every(item => item.canDuplicate);
  const canDelete = hasSelection && selectionReady && objects.every(item => item.canDelete);
  const transform = (operation: "move" | "duplicate" | "delete", dx = 0, dy = 0) =>
    useEditorStore.getState().transformGameSelection(operation, scene, [dx, dy]);
  const single = objects.length === 1 && !cells.length;
  const [gx, gy] = object ? objectCellOffset(object.position, object.sourcePosition, scene) : [0, 0];
  return <section className="entity-inspector game-object-inspector" aria-label="게임 오브젝트 속성">
    <div className="ei-head"><strong>{single ? object.name : "묶음 편집"}</strong>
      <button className="ei-close" aria-label="오브젝트 선택 해제" onClick={() => {
        useEditorStore.getState().clearGameSelection(); preview.setSelectionMode("objects");
      }}>✕</button>
    </div>
    <p className="selection-count" role="status">오브젝트 {selected.length}개 · 이동불가 {cells.length}칸 선택</p>
    {error && <div className="selection-error" role="alert">{error}</div>}
    <div className="object-tabs" aria-label="묶음에 넣을 대상">
      <button aria-pressed={!pickingCells} onClick={() => { preview.setSelectionMode("objects"); useEditorStore.getState().setTool("cursor"); }}>오브젝트 선택</button>
      <button aria-pressed={pickingCells} disabled={locked || !canEditCells} onClick={selectBlockedMode}>이동불가 칸 선택</button>
    </div>
    {!canEditCells && <p className="object-help">현재 맵의 이동불가 원본 연결을 확인할 수 없어 칸 묶음 편집이 잠겨 있습니다.</p>}
    {pickingCells ? <p className="object-help selection-help">빨간 칸을 클릭하면 선택·해제됩니다. 드래그한 범위의 이동불가 칸을 묶음에 추가합니다. 선택 후 「오브젝트 선택」으로 돌아가 함께 옮기세요.</p>
      : <p className="object-help">선택한 대상을 드래그하거나 아래 버튼으로 옮기세요. 원본 모양·배율·깊이 설정을 유지하며, Ctrl+Z 한 번으로 함께 되돌립니다.</p>}
    {!!cells.length && <button className="ei-fit" onClick={() => useEditorStore.getState().selectBlockedCells([])}>이동불가 선택 비우기</button>}
    {object && <button className="ei-fit" onClick={() => focusObject(object)}>선택 위치 보기</button>}
    {single && <div className="ei-grid2">
      <label className="ei-row"><span>원본에서 X칸</span><NumberField value={gx} disabled={!canMove} onCommit={n => transform("move", n - gx, 0)} /></label>
      <label className="ei-row"><span>원본에서 Y칸</span><NumberField value={gy} disabled={!canMove} onCommit={n => transform("move", 0, n - gy)} /></label>
    </div>}
    <div className="object-nudge" aria-label="선택 묶음 한 칸 이동">
      <button aria-label="북서로 한 칸" disabled={!canMove} onClick={() => transform("move", -1, 0)}>↖</button>
      <button aria-label="북동으로 한 칸" disabled={!canMove} onClick={() => transform("move", 0, -1)}>↗</button>
      <button aria-label="남서로 한 칸" disabled={!canMove} onClick={() => transform("move", 0, 1)}>↙</button>
      <button aria-label="남동으로 한 칸" disabled={!canMove} onClick={() => transform("move", 1, 0)}>↘</button>
    </div>
    {hasSelection && <><div className="ei-grid2">
      <label className="ei-row"><span>X 이동 칸</span><NumberField value={deltaX} min={-10000} max={10000} onCommit={setDeltaX} /></label>
      <label className="ei-row"><span>Y 이동 칸</span><NumberField value={deltaY} min={-10000} max={10000} onCommit={setDeltaY} /></label>
    </div>
    <div className="ei-actions">
      <button disabled={!canMove} onClick={() => transform("move", deltaX, deltaY)}>지정한 칸만큼 이동</button>
      <button disabled={!canCopy} onClick={() => transform("duplicate", deltaX, deltaY)}>지정한 칸에 복제</button>
    </div></>}
    {objects.find(item => item.reason)?.reason && <p className="object-help">{objects.find(item => item.reason)?.reason}</p>}
    <p className="object-collision">{cells.length
      ? "하늘색으로 선택한 이동불가 칸만 함께 옮깁니다. 다른 이동불가 칸과 겹치거나 맵 밖으로 나가면 전체 작업을 취소합니다."
      : "함께 옮길 이동불가 칸은 위에서 직접 선택하세요. 오브젝트만 선택하면 이동불가 영역은 그대로 유지됩니다."}</p>
    {single && <button className="ei-fit" disabled={!canCopy} onClick={() => {
      preview.setShowScene(true); preview.setShowObjects(true); preview.setSelectionMode("objects");
      preview.setPlacementPrototype(object.prototypeId); useEditorStore.getState().setTool("object");
    }}>같은 모양 추가 배치</button>}
    <button className="ei-delete" disabled={!canDelete} onClick={() => transform("delete")}>선택한 대상 모두 삭제 (Del)</button>
    <p className="object-help">방향키: 한 칸 이동 · Ctrl+D: X 방향 한 칸 옆에 복제 · Esc: 선택 해제</p>
  </section>;
}
