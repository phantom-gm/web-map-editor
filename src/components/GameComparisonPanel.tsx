import { useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import { useWorkspaceSession } from "../lib/gameWorkspace";
import { getComparisonCounts, type GameComparisonFilters } from "../lib/gameComparison";
import { previewWorldToScreen } from "../lib/gamePreview";
import { cellToScreen } from "../lib/grid";

export function GameComparisonPanel() {
  const view = useGamePreviewStore();
  const gameSync = useEditorStore(s => s.gameSync);
  const loading = useWorkspaceSession(s => s.loading);
  if (!gameSync) return null;
  const current = view.scene?.baselineId === gameSync.baselineId;
  const ready = current && view.status === "ready" && !!view.comparison && !!view.comparisonBaseline;
  const enter = () => {
    const editor = useEditorStore.getState();
    editor.clearGameSelection(); editor.setTool("cursor");
    view.setComparisonEnabled(true);
  };
  return <div className="game-comparison-controls" aria-label="원본과 수정본 비교">
    {!view.comparisonEnabled ? <button disabled={loading || !current || view.status !== "ready"} onClick={enter}>원본과 비교</button> : <>
      <strong>원본 비교</strong>
      <div className="comparison-modes" role="group" aria-label="비교 화면">
        {([["original", "원본 보기"], ["edited", "수정본 보기"], ["changes", "변경 강조"]] as const).map(([mode, label]) =>
          <button key={mode} aria-pressed={view.comparisonMode === mode} disabled={!ready} onClick={() => view.setComparisonMode(mode)}>{label}</button>)}
      </div>
      <button className="comparison-exit" onClick={() => view.setComparisonEnabled(false)}>비교 닫고 편집</button>
      <span className="comparison-hint" role="status">{view.status === "error" ? "비교를 불러오지 못했습니다. 안내를 확인하세요."
        : !ready ? "원본과 수정본을 읽는 중…" : "보기 전용 · 드래그로 화면 이동 · 휠로 확대"}</span>
    </>}
  </div>;
}

interface ChangeRow { key: string; label: string; kind: keyof GameComparisonFilters; cell?: [number, number]; position?: [number, number, number]; originalPosition?: [number, number, number] }
export function GameComparisonSidebar() {
  const view = useGamePreviewStore();
  const [limit, setLimit] = useState(80);
  const scene = view.scene, baseline = view.comparisonBaseline, comparison = view.comparison;
  const ready = view.status === "ready" && scene && baseline && comparison;
  if (!ready) return <section className="comparison-sidebar" aria-label="변경 내역">
    <h3>변경 내역</h3><p>{view.error || "원본과 수정본을 읽는 중…"}</p>
    <button onClick={() => view.setComparisonEnabled(false)}>비교 닫고 편집</button>
  </section>;
  const counts = getComparisonCounts(comparison);
  const currentObjects = new Map(scene.objects?.map(object => [object.entityId, object]));
  const originalObjects = new Map(baseline.scene.objects?.map(object => [object.entityId, object]));
  const currentNpcs = new Map(scene.npcs?.map(npc => [npc.entityId, npc]));
  const originalNpcs = new Map(baseline.scene.npcs?.map(npc => [npc.entityId, npc]));
  const runtimeRows: ChangeRow[] = [];
  for (const [kind, label] of [["monsters", "몬스터 출현"], ["portals", "포털"], ["traps", "함정 영역"]] as const) {
    const diff = comparison[kind]; if (!diff) continue;
    const name = (id: string) => { const item = (scene[kind] ?? []).find(value => value.entityId === id) ?? (baseline.scene[kind] ?? []).find(value => value.entityId === id); return item && "name" in item ? item.name : id; };
    for (const item of diff.moved) runtimeRows.push({key:kind+"-move-"+item.entityId,label:label+" 이동 · "+name(item.entityId),kind,position:item.to,originalPosition:item.from});
    for (const [type, text] of [["added","추가"],["removed","삭제"],["updated","설정"]] as const) for (const item of diff[type]) runtimeRows.push({key:kind+"-"+type+"-"+item.entityId,label:label+" "+text+" · "+name(item.entityId),kind,position:item.position,originalPosition:(baseline.scene[kind] ?? []).find(value=>value.entityId===item.entityId)?.position});
  }
  if (comparison.spawn) runtimeRows.push({key:"spawn",label:"시작 위치 이동",kind:"spawn",position:comparison.spawn.to,originalPosition:comparison.spawn.from});
  const rows: ChangeRow[] = [
    ...runtimeRows,
    ...(comparison.npcs?.moved ?? []).map(item => ({ key: "npc-move-" + item.entityId, label: "NPC 이동 · " + (currentNpcs.get(item.entityId)?.name || item.entityId), kind: "npcs" as const, position: item.to, originalPosition: item.from })),
    ...(comparison.npcs?.added ?? []).map(item => ({ key: "npc-add-" + item.entityId, label: "NPC 추가 · " + (currentNpcs.get(item.entityId)?.name || item.entityId), kind: "npcs" as const, position: item.position })),
    ...(comparison.npcs?.removed ?? []).map(item => ({ key: "npc-remove-" + item.entityId, label: "NPC 삭제 · " + (originalNpcs.get(item.entityId)?.name || item.entityId), kind: "npcs" as const, position: item.position })),
    ...(comparison.npcs?.updated ?? []).map(item => ({ key: "npc-update-" + item.entityId, label: "NPC 설정 · " + (currentNpcs.get(item.entityId)?.name || item.entityId), kind: "npcs" as const, position: item.position, originalPosition: originalNpcs.get(item.entityId)?.position })),
    ...(comparison.objects.sorted ?? []).map(item => ({ key: "sort-" + item.entityId, label: "정렬 · " + (currentObjects.get(item.entityId)?.name || item.entityId), kind: "objects" as const, position: item.position })),
    ...comparison.objects.moved.map(item => ({ key: "move-" + item.entityId, label: "이동 · " + (currentObjects.get(item.entityId)?.name || item.entityId), kind: "objects" as const, position: item.to, originalPosition: item.from })),
    ...comparison.objects.added.map(item => ({ key: "add-" + item.entityId, label: "추가 · " + (currentObjects.get(item.entityId)?.name || item.entityId), kind: "objects" as const, position: item.position })),
    ...comparison.objects.removed.map(item => ({ key: "remove-" + item.entityId, label: "삭제 · " + (originalObjects.get(item.entityId)?.name || item.entityId), kind: "objects" as const, position: item.position })),
    ...comparison.ground.changedCells.map(item => ({ key: "ground-" + item.gx + "," + item.gy, label: "바닥 " + (item.beforeRuid === null ? "추가" : item.afterRuid === null ? "삭제" : "변경") + " · " + item.gx + ", " + item.gy, kind: "ground" as const, cell: [item.gx, item.gy] as [number, number] })),
    ...comparison.blocked.added.map(cell => ({ key: "block-add-" + cell.join(","), label: "이동불가 추가 · " + cell.join(", "), kind: "blocked" as const, cell })),
    ...comparison.blocked.removed.map(cell => ({ key: "block-remove-" + cell.join(","), label: "이동불가 해제 · " + cell.join(", "), kind: "blocked" as const, cell })),
  ];
  const visible = rows.filter(row => view.comparisonFilters[row.kind]);
  const focus = (row: ChangeRow) => {
    const editor = useEditorStore.getState();
    const rect = document.querySelector(".canvas-wrap")?.getBoundingClientRect();
    if (!rect) return;
    const position = view.comparisonMode === "original" ? row.originalPosition ?? row.position : row.position;
    const point = row.cell ? cellToScreen(...row.cell, editor.camera)
      : previewWorldToScreen(position!, scene, editor.camera);
    editor.setCamera({ ...editor.camera, x: editor.camera.x + rect.width / 2 - point[0], y: editor.camera.y + rect.height / 2 - point[1] });
  };
  return <section className="comparison-sidebar" aria-label="변경 내역">
    <h3>변경 내역</h3>
    <p className="comparison-basis">이 작업을 시작할 때 가져온 게임 원본과 비교합니다.{baseline.npcSourceId || baseline.runtimeSourceId ? " NPC·몬스터·포털·시작 위치는 각각 마지막으로 가져온 원본이 기준입니다." : ""}</p>
    <div className="comparison-totals" aria-label="변경 수량">
      <label><input type="checkbox" checked={view.comparisonFilters.ground} onChange={e => view.setComparisonFilter("ground", e.target.checked)} />바닥 수정 {counts.groundChangedCells}칸</label>
      <small>주변 타일 재구성 {counts.groundRepackedCells}칸</small>
      <label><input type="checkbox" checked={view.comparisonFilters.objects} onChange={e => view.setComparisonFilter("objects", e.target.checked)} />오브젝트</label>
      <small>이동 {counts.objectsMoved} · 추가 {counts.objectsAdded} · 삭제 {counts.objectsRemoved} · 정렬 {counts.objectsSorted ?? 0}</small>
      <label><input type="checkbox" checked={view.comparisonFilters.npcs} onChange={e => view.setComparisonFilter("npcs", e.target.checked)} />NPC</label>
      <small>이동 {counts.npcsMoved} · 추가 {counts.npcsAdded} · 삭제 {counts.npcsRemoved} · 설정 {counts.npcsUpdated}</small>
      {([["monsters", "몬스터 출현", counts.monstersMoved, counts.monstersAdded, counts.monstersRemoved, counts.monstersUpdated], ["portals", "포털", counts.portalsMoved, counts.portalsAdded, counts.portalsRemoved, counts.portalsUpdated]] as const).map(([kind,label,moved,added,removed,updated]) => <div key={kind}><label><input type="checkbox" checked={!!view.comparisonFilters[kind]} onChange={e=>view.setComparisonFilter(kind,e.target.checked)} />{label}</label><small>이동 {moved} · 추가 {added} · 삭제 {removed} · 설정 {updated}</small></div>)}
      <label><input type="checkbox" checked={!!view.comparisonFilters.spawn} onChange={e=>view.setComparisonFilter("spawn",e.target.checked)} />시작 위치 {counts.spawnChanged ? "이동" : "변경 없음"}</label>
      <label><input type="checkbox" checked={!!view.comparisonFilters.traps} onChange={e=>view.setComparisonFilter("traps",e.target.checked)} />함정 영역</label>
      <small>이동 {counts.trapsMoved??0} · 추가 {counts.trapsAdded??0} · 삭제 {counts.trapsRemoved??0} · 범위·효과 {counts.trapsUpdated??0}</small>
      <label><input type="checkbox" checked={view.comparisonFilters.blocked} onChange={e => view.setComparisonFilter("blocked", e.target.checked)} />이동불가</label>
      <small>추가 {counts.blockedAdded} · 해제 {counts.blockedRemoved}</small>
    </div>
    <details className="comparison-legend">
      <summary>색상·표시 안내</summary>
      <div className="comparison-legend-items">
        <span className="compare-blue">파랑 · 바닥 수정 / 배치 설정</span>
        <span className="compare-amber">주황 · 이동 / 주변 재구성</span>
        <span className="compare-green">초록 · 추가</span>
        <span className="compare-red">빨강 · 삭제 / 해제</span>
        <small>변경 강조에서 잔상·화살표·색 테두리로 표시합니다.</small>
      </div>
    </details>
    {!rows.length ? <p className="comparison-empty">원본과 바닥·배치·이동불가 변경이 없습니다.</p> : <>
      <p className="comparison-basis">항목을 누르면 해당 위치로 이동합니다.</p>
      <div className="comparison-change-list">
        {visible.slice(0, limit).map(row => <button key={row.key} onClick={() => focus(row)} title={row.label}>{row.label}</button>)}
        {!visible.length && <p>표시할 종류를 선택하세요.</p>}
        {visible.length > limit && <button onClick={() => setLimit(limit + 80)}>변경 {visible.length - limit}곳 더 보기</button>}
      </div>
    </>}
  </section>;
}
