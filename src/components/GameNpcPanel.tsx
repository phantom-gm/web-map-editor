import { activateEditorTool } from "../lib/editorCommands";
import { useEffect, useId, useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import { useWorkspaceSession } from "../lib/gameWorkspace";
import { npcEditsKey, parseGameNpcSync, type GameNpcDescriptor } from "../lib/gameNpc";
import { previewSpriteGeometry, previewWorldToScreen, type GamePreviewScene } from "../lib/gamePreview";
import type { ProjectFile } from "../lib/projectIO";
import { NumberField } from "./NumberField";
import { cellKey } from "../lib/cell";

export function openNpcPanel(): void {
  const view = useGamePreviewStore.getState();
  view.setShowNpcs(true); view.setPlacementNpc(null);
  useEditorStore.getState().clearGameSelection(); useEditorStore.getState().setTool("cursor");
}
function focusNpc(npc: GameNpcDescriptor): void {
  const view = useGamePreviewStore.getState(), editor = useEditorStore.getState(), scene = view.scene;
  const rect = document.querySelector(".canvas-wrap")?.getBoundingClientRect();
  if (!scene || !rect) return;
  const sprite = scene.sprites.find(item => item.npcEntityId === npc.entityId), image = sprite && view.images.get(sprite.ruid);
  let center = previewWorldToScreen(npc.position, scene, editor.camera);
  if (sprite && image) {
    const [x0,y0,x1,y1] = previewSpriteGeometry(sprite, image.asset, scene, editor.camera).bounds;
    center = [(x0+x1)/2,(y0+y1)/2];
  }
  editor.setCamera({ ...editor.camera, x: editor.camera.x + rect.width/2 - center[0], y: editor.camera.y + rect.height/2 - center[1] });
}
export function GameNpcLibrary() {
  const [search, setSearch] = useState(""), [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false), [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const view = useGamePreviewStore();
  const gameSync = useEditorStore(s => s.gameSync), selected = useEditorStore(s => s.selectedGameNpcId);
  const npcError = useEditorStore(s => s.gameNpcError);
  const loading = useWorkspaceSession(s => s.loading);
  const scene = view.scene?.baselineId === gameSync?.baselineId ? view.scene : null;
  const ready = !!scene && view.status === "ready" && !loading && !refreshing && !view.comparisonEnabled;
  const editable = ready && !scene?.npcSource?.stale;
  const query = search.trim().toLocaleLowerCase();
  const npcs = (scene?.npcs ?? []).filter(n => !query || (n.name + " " + n.npcClassId + " " + n.spawnId).toLocaleLowerCase().includes(query));
  const classes = (scene?.npcCatalog ?? []).filter(n => !query || (n.name + " " + n.npcClassId).toLocaleLowerCase().includes(query));
  async function refreshNpcSource() {
    const editor = useEditorStore.getState();
    if (!editor.gameSync) return;
    if (editor.gameNpcEdits && !window.confirm("NPC 수정 사항을 지우고 최신 게임 NPC 원본을 불러옵니다. 바닥·오브젝트·이동불가 작업은 유지하며 Ctrl+Z로 되돌릴 수 있습니다. 계속할까요?")) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const baselineId = editor.gameSync.baselineId;
    const expected = JSON.stringify([editor.gameNpcSync ?? null, npcEditsKey(editor.gameNpcEdits)]);
    setRefreshing(true); setError(null);
    try {
      const response = await fetch("/api/game-sync", { method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ action:"refresh-npcs", project:editor.exportProject() }), signal:controller.signal });
      const result = await response.json() as { project?: ProjectFile; error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok || !result.project || result.project.gameSync?.baselineId !== baselineId) throw new Error(result.error || "NPC 원본을 다시 읽지 못했습니다.");
      const sync = parseGameNpcSync(result.project.gameNpcSync);
      if (!sync) throw new Error("NPC 원본 연결이 응답에 없습니다.");
      useEditorStore.getState().replaceGameNpcSource(sync, baselineId, expected);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    } finally { if (!controller.signal.aborted) setRefreshing(false); }
  }
  return <section className="game-npc-library" aria-label="NPC 목록">
    <div className="palette-head"><strong>NPC</strong>
      <button onClick={() => activateEditorTool("brush")}>바닥 소재</button>
      <button onClick={() => { view.setShowObjects(true); useEditorStore.getState().selectGameNpc(null); useEditorStore.getState().setTool("cursor"); }}>건물·장식</button>
    </div>
    <div className="object-tabs">
      <button aria-pressed={!adding} onClick={() => setAdding(false)}>배치된 NPC {scene?.npcs?.length ?? 0}</button>
      <button aria-pressed={adding} onClick={() => setAdding(true)}>NPC 추가</button>
    </div>
    <input className="object-search" aria-label="NPC 검색" placeholder="이름 또는 종류 번호 검색" value={search} onChange={e => setSearch(e.target.value)} />
    <p className="object-help">{adding ? "추가할 NPC를 고른 뒤 맵에서 놓을 칸을 클릭하세요." : "그림이나 목록에서 선택하세요. 선택한 그림을 드래그하거나 속성에서 위치를 바꿀 수 있습니다."}</p>
    <p className="object-help">실제 NPC 스폰 데이터 · Idle 정지 모습 · 이름과 종류별 크기 표시</p>
    {scene?.npcSource?.stale && <p className="selection-error" role="alert">게임 NPC 원본이 바뀌었습니다. 아래에서 NPC 원본을 다시 불러오세요.</p>}
    {(error || npcError) && <p className="selection-error" role="alert">{error || npcError}</p>}
    {view.placementNpcClassId !== null && <div className="object-placement" role="status">NPC를 놓을 칸을 클릭하세요. <button onClick={() => { view.setPlacementNpc(null); useEditorStore.getState().setTool("cursor"); }}>추가 취소 (Esc)</button></div>}
    <div className="game-object-list game-npc-list">
      {adding ? classes.map(npc => <button key={npc.npcClassId} className="game-object-item" disabled={!editable || !npc.canAdd} title={npc.reason || npc.name}
        aria-label={"NPC 추가 " + npc.name} onClick={() => {
          view.setShowScene(true); view.setPlacementNpc(npc.npcClassId);
          useEditorStore.getState().selectGameNpc(null); useEditorStore.getState().setTool("npc");
        }}>
        {view.images.get(npc.ruid)?.image.src && <img src={view.images.get(npc.ruid)!.image.src} alt="" />}
        <span>{npc.name}<small>종류 {npc.npcClassId} · 크기 {npc.bodyScale}배{npc.canAdd ? "" : " · 추가 불가"}</small></span>
      </button>) : npcs.map(npc => <button key={npc.entityId} className={"game-object-item" + (selected === npc.entityId ? " selected" : "")}
        disabled={!ready} aria-pressed={selected === npc.entityId} aria-label={"배치된 NPC " + npc.name} title={npc.reason || npc.spawnId}
        onClick={() => { view.setPlacementNpc(null); view.setShowScene(true); useEditorStore.getState().setTool("cursor"); useEditorStore.getState().selectGameNpc(npc.entityId); focusNpc(npc); }}>
        {view.images.get(npc.ruid)?.image.src && <img src={view.images.get(npc.ruid)!.image.src} alt="" />}
        <span>{npc.name}<small>칸 {npc.cell[0]}, {npc.cell[1]} · 종류 {npc.npcClassId}{npc.enabled ? "" : " · 비활성"}</small></span>
      </button>)}
      {!(adding ? classes.length : npcs.length) && <p className="object-help">{ready ? "표시할 NPC가 없습니다." : "NPC 데이터를 읽는 중…"}</p>}
    </div>
    <div className="npc-source-actions">
      <button disabled={!ready || !scene?.npcSource?.refreshAvailable} onClick={() => void refreshNpcSource()}>{refreshing ? "NPC 원본 읽는 중…" : "NPC 원본 다시 불러오기"}</button>
      <p className="object-help">NPC만 최신 게임 데이터로 읽습니다. 바닥·건물·장식 작업은 유지됩니다. 수정 결과는 후보 파일로만 출력합니다.</p>
    </div>
  </section>;
}
export function GameNpcInspector() {
  const selected = useEditorStore(s => s.selectedGameNpcId), link = useEditorStore(s => s.gameSync);
  const view = useGamePreviewStore();
  const scene = view.scene?.baselineId === link?.baselineId ? view.scene : null;
  const npc = scene?.npcs?.find(item => item.entityId === selected);
  if (!scene || !npc || view.comparisonEnabled) return null;
  return <NpcProperties key={npc.entityId + ":" + npc.dialogId} npc={npc} scene={scene} />;
}
function NpcProperties({ npc, scene }: { npc: GameNpcDescriptor; scene: GamePreviewScene }) {
  const [dialogId, setDialogId] = useState(npc.dialogId);
  const dialogListId = useId();
  const dialogGroups = scene.npcDialogGroups ?? [];
  const dialogValid = dialogId === npc.dialogId || dialogId === "" || (scene.npcDialogGroupsAvailable === true && dialogGroups.includes(dialogId));
  const error = useEditorStore(s => s.gameNpcError);
  const onBlockedCell = useEditorStore(s => s.blocked.has(cellKey(...npc.cell)));
  const view = useGamePreviewStore(), loading = useWorkspaceSession(s => s.loading);
  const locked = loading || view.status !== "ready" || view.comparisonEnabled || !npc.canEdit || scene.npcSource?.stale;
  const update = (patch: Parameters<ReturnType<typeof useEditorStore.getState>["updateGameNpc"]>[1]) => useEditorStore.getState().updateGameNpc(npc.entityId, patch, scene);
  const move = (dx:number,dy:number) => update({cell:[npc.cell[0]+dx,npc.cell[1]+dy]});
  return <section className="entity-inspector game-npc-inspector" aria-label="NPC 속성">
    <div className="ei-head"><strong>{npc.name}</strong><button className="ei-close" aria-label="NPC 선택 해제" onClick={() => useEditorStore.getState().selectGameNpc(null)}>✕</button></div>
    <p className="object-help">종류 {npc.npcClassId} · 실제 크기 {npc.bodyScale}배 · Idle 정지 모습</p>
    {error && <p className="selection-error" role="alert">{error}</p>}
    {npc.reason && <p className="object-help">{npc.reason}</p>}
    <div className="ei-grid2">
      <label className="ei-row"><span>X 칸</span><NumberField value={npc.cell[0]} disabled={!!locked} min={0} onCommit={x => update({cell:[x,npc.cell[1]]})} /></label>
      <label className="ei-row"><span>Y 칸</span><NumberField value={npc.cell[1]} disabled={!!locked} min={0} onCommit={y => update({cell:[npc.cell[0],y]})} /></label>
    </div>
    <div className="object-nudge" aria-label="NPC 한 칸 이동">
      <button disabled={!!locked} aria-label="NPC 북서로 한 칸" onClick={() => move(-1,0)}>↖</button>
      <button disabled={!!locked} aria-label="NPC 북동으로 한 칸" onClick={() => move(0,-1)}>↗</button>
      <button disabled={!!locked} aria-label="NPC 남서로 한 칸" onClick={() => move(0,1)}>↙</button>
      <button disabled={!!locked} aria-label="NPC 남동으로 한 칸" onClick={() => move(1,0)}>↘</button>
    </div>
    <label className="ei-row"><span>좌우 반전</span><input type="checkbox" checked={npc.flipX} disabled={!!locked} onChange={e => update({flipX:e.target.checked})} /></label>
    <label className="ei-row"><span>대사 ID</span><input value={dialogId} list={dialogListId} aria-invalid={!dialogValid} disabled={!!locked} onChange={e => setDialogId(e.target.value)} placeholder="그룹 ID 선택 또는 빈값" title="실제 대사 그룹 ID입니다. 대사 실행은 게임에서 별도로 확인합니다." /></label>
    <datalist id={dialogListId}>{dialogGroups.map(id => <option key={id} value={id} />)}</datalist>
    <p className="object-help">{scene.npcDialogGroupsAvailable ? "대사 그룹 " + dialogGroups.length + "개 중 선택하세요. 빈값은 게임의 기존 기본 정책을 따릅니다." : "대사 그룹 목록을 읽을 수 없습니다. 기존 값은 유지되며 새 대사는 NPC 원본을 다시 불러온 뒤 지정하세요."}</p>
    {!dialogValid && <p className="selection-error" role="alert">목록에 있는 대사 그룹 ID를 입력하거나 비워두세요.</p>}
    <button disabled={!!locked || !dialogValid || dialogId === npc.dialogId} onClick={() => update({dialogId})}>대사 ID 적용</button>
    <button className="ei-fit" onClick={() => focusNpc(npc)}>선택 위치 보기</button>
    {onBlockedCell && <p className="object-help">이동불가 칸에 배치되어 있습니다. NPC 배치는 허용하며 이동불가 영역은 그대로 유지합니다.</p>}
    <button className="ei-delete" disabled={!!locked} onClick={() => useEditorStore.getState().removeGameNpc(npc.entityId, scene)}>NPC 삭제 (Del)</button>
    <p className="object-help">방향키: 한 칸 이동 · Esc: 선택 해제 · Ctrl+Z: 실행취소. 대화 실행과 애니메이션은 게임에서 확인합니다.</p>
  </section>;
}
