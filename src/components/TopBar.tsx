import { beginProjectLoad, finishProjectLoad, isCurrentProjectLoad, clearWorkspaceSession } from "../lib/gameWorkspace";
import { useRef } from "react";
import { useEditorStore } from "../store/editorStore";
import { parseBlueprint, downloadText } from "../lib/blueprintIO";
import { validateMap } from "../lib/validate";
import { FileMenu } from "./FileMenu";
import { NumberField } from "./NumberField";

export function TopBar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const mapName = useEditorStore((s) => s.mapName);
  const gameSync = useEditorStore((s) => s.gameSync);
  const resetNonce = useEditorStore((s) => s.resetNonce);
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
    <div className="topbar">
      <strong>MSW 맵 에디터</strong>
      <label>
        맵 <input disabled={!!gameSync} value={mapName} onChange={(e) => setMapName(e.target.value)} />
      </label>
      <label>
        W <NumberField disabled={!!gameSync} value={size[0]} min={1} onCommit={(w) => setSize(w, size[1])} />
      </label>
      <label>
        H <NumberField disabled={!!gameSync} value={size[1]} min={1} onCommit={(h) => setSize(size[0], h)} />
      </label>
      <FileMenu key={resetNonce} />
      <span className="topbar-sep" />
      {!gameSync && <button onClick={() => fileRef.current?.click()} title="게임 blueprint JSON 가져오기">
        Import
      </button>}
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />
      {!gameSync && <button onClick={onExport} disabled={!!gameSync} title={gameSync ? "동기화 맵은 후보 맵 굽기를 사용하세요." : "게임 blueprint JSON 내보내기"}>
        Export
      </button>}
      {!gameSync && <button onClick={onExportRuids} title="palette_ruids_<Map>.json — build_map.cjs 가 소비">
        RUID export
      </button>}
      {!gameSync && <button disabled={!!gameSync} onClick={onFixSort} title="겹치는 멀티셀 오브젝트에 방향 맞는 sortOffset 부여(그 위 플레이어가 뒤로 숨는 문제 해소). Export 시 자동 실행됨">
        겹침 정렬
      </button>}
      <button onClick={requestFit}>뷰 맞춤</button>
      <span className="hint">좌클릭=페인팅 · 스페이스+드래그=이동 · 휠=확대 · Ctrl+S=저장</span>
    </div>
  );
}
