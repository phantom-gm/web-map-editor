import { beginProjectLoad, finishProjectLoad, isCurrentProjectLoad, clearWorkspaceSession, useWorkspaceSession } from "../lib/gameWorkspace";
import { useEffect, useRef } from "react";
import { useEditorStore } from "../store/editorStore";
import { parseBlueprint, downloadText } from "../lib/blueprintIO";
import { validateMap } from "../lib/validate";
import { FileMenu } from "./FileMenu";
import { NumberField } from "./NumberField";
import "./WorkflowBar.css";

export function TopBar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const advancedRef = useRef<HTMLDetailsElement>(null);
  const loading = useWorkspaceSession(s => s.loading);
  useEffect(() => {
    const closeOutside = (event: MouseEvent) => { if (advancedRef.current?.open && !advancedRef.current.contains(event.target as Node)) advancedRef.current.open = false; };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, []);
  const mapName = useEditorStore((s) => s.mapName);
  const gameSync = useEditorStore((s) => s.gameSync);
  const documentNonce = useEditorStore((s) => s.documentNonce);
  const size = useEditorStore((s) => s.size);
  const setMapName = useEditorStore((s) => s.setMapName);
  const setSize = useEditorStore((s) => s.setSize);
  const requestFit = useEditorStore((s) => s.requestFit);
  const importBlueprint = useEditorStore((s) => s.importBlueprint);

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const token = beginProjectLoad();
    try {
      const text = await f.text();
      const result = parseBlueprint(JSON.parse(text));
      if (!isCurrentProjectLoad(token)) return;
      clearWorkspaceSession();
      importBlueprint(result);
    } catch (err) {
      alert("blueprint import 실패: " + (err instanceof Error ? err.message : String(err)));
    } finally { finishProjectLoad(token); }
  };

  const onFixSort = () => {
    const { fixes, cycles } = useEditorStore.getState().autoFixSortOffsets();
    const lines: string[] = [];
    if (fixes.length) lines.push(`정렬 자동수정 ${fixes.length}건:\n` + fixes.map((f) => `  • ${f.name}: sortOffset ${f.from} → ${f.to}`).join("\n"));
    if (cycles.length) lines.push(`⚠ 순환 ${cycles.length}건 — sortOffset 으로 해결 불가(에셋 분할/레이어 필요):\n` + cycles.map((c) => `  • ${c.aName} ⨯ ${c.bName}`).join("\n"));
    alert(lines.length ? lines.join("\n\n") : "겹치는 멀티셀 오브젝트 정렬 문제 없음 ✓");
  };

  const onExport = () => {
    const s = useEditorStore.getState();
    // 겹침 정렬 누락을 export 전에 자동으로 없앤다(요구서: "항상 부여"). 순환은 아래 경고에 합류.
    const sort = s.autoFixSortOffsets();
    const { errors, warnings } = validateMap({
      size: s.size,
      ground: s.ground,
      blocked: s.blocked,
      paletteCount: s.palette.length,
      entities: useEditorStore.getState().entities, // 자동수정 반영본
      npcClassIds: s.npcCatalog.byId,
    });
    if (sort.fixes.length) warnings.push(`겹침 정렬 자동수정 ${sort.fixes.length}건 적용됨 (${sort.fixes.map((f) => `${f.name}=${f.to}`).join(", ")}).`);
    for (const c of sort.cycles) errors.push(`정렬 순환: ${c.aName} ⨯ ${c.bName} — sortOffset 으로 해결 불가(에셋 분할/레이어 필요).`);
    if (errors.length > 0 || warnings.length > 0) {
      const lines = [...errors.map((e) => "• " + e), ...warnings.map((w) => "· " + w)];
      const ok = window.confirm(
        `검증 결과:\n${lines.join("\n")}\n\n그대로 export 할까요?`,
      );
      if (!ok) return;
    }
    const bp = s.exportBlueprint();
    downloadText(`map_blueprint_${bp.map}.json`, JSON.stringify(bp, null, 2));
  };

  const onExportRuids = () => {
    const { map, ruids } = useEditorStore.getState().exportPaletteRuids();
    const n = Object.keys(ruids).length;
    if (n === 0) {
      alert("알려진 RUID가 없습니다 — 먼저 'RUID 매핑 불러오기'로 레지스트리를 로드하세요.");
      return;
    }
    downloadText(`palette_ruids_${map}.json`, JSON.stringify({ map, ruids }, null, 2));
  };

  return (
    <header className="topbar workflow-topbar">
      <div className="workflow-brand"><span className="workflow-logo" aria-hidden="true">◇</span><strong>맵 에디터</strong></div>
      <div className="workflow-document" aria-label="현재 열린 작업">
        <span className={gameSync ? "workflow-document-tag linked" : "workflow-document-tag"}>{gameSync ? "게임 맵" : "일반 프로젝트"}</span>
        <strong>{gameSync?.mapName || mapName || "이름 없는 맵"}</strong>
        <span className="workflow-dimensions">{size[0]} × {size[1]}</span>
      </div>
      <div className="workflow-topbar-actions">
        <FileMenu key={documentNonce} />
        <details ref={advancedRef} className="workflow-advanced" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.stopPropagation(); } }}>
          <summary>고급 도구</summary>
          <div className="workflow-advanced-menu" onClick={event => { if ((event.target as HTMLElement).closest("button") && advancedRef.current) advancedRef.current.open = false; }}>
            <strong>프로젝트 설정·변환</strong>
            {!gameSync ? <>
              <label>맵 이름 <input disabled={loading} value={mapName} onChange={e => setMapName(e.target.value)} /></label>
              <div className="workflow-size-fields">
                <label>가로 <NumberField disabled={loading} value={size[0]} min={1} onCommit={w => setSize(w, size[1])} /></label>
                <label>세로 <NumberField value={size[1]} min={1} onCommit={h => setSize(size[0], h)} /></label>
              </div>
              <button disabled={loading} onClick={() => fileRef.current?.click()}>Blueprint 가져오기…</button>
              <button onClick={onExport}>Blueprint 내보내기…</button>
              <button onClick={onExportRuids}>RUID 매핑 내보내기…</button>
              <button onClick={onFixSort}>오브젝트 겹침 정렬</button>
            </> : <p>연결된 맵의 이름·크기는 게임 원본을 따릅니다. 게임에 전달할 파일은 아래에서 출력하세요.</p>}
            <button onClick={requestFit}>화면에 맵 맞추기</button>
          </div>
        </details>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />
    </header>
  );
}
