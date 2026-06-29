import { useRef } from "react";
import { useEditorStore } from "../store/editorStore";
import { parseBlueprint, downloadText } from "../lib/blueprintIO";
import { validateMap } from "../lib/validate";

export function TopBar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const mapName = useEditorStore((s) => s.mapName);
  const size = useEditorStore((s) => s.size);
  const setMapName = useEditorStore((s) => s.setMapName);
  const setSize = useEditorStore((s) => s.setSize);
  const requestFit = useEditorStore((s) => s.requestFit);
  const importBlueprint = useEditorStore((s) => s.importBlueprint);

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const text = await f.text();
      const result = parseBlueprint(JSON.parse(text));
      importBlueprint(result);
    } catch (err) {
      alert("blueprint import 실패: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const onExport = () => {
    const s = useEditorStore.getState();
    const { errors, warnings } = validateMap({
      size: s.size,
      ground: s.ground,
      blocked: s.blocked,
      paletteCount: s.palette.length,
    });
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
        맵 <input value={mapName} onChange={(e) => setMapName(e.target.value)} />
      </label>
      <label>
        W{" "}
        <input
          className="num"
          type="number"
          min={1}
          value={size[0]}
          onChange={(e) => setSize(parseInt(e.target.value, 10) || 1, size[1])}
        />
      </label>
      <label>
        H{" "}
        <input
          className="num"
          type="number"
          min={1}
          value={size[1]}
          onChange={(e) => setSize(size[0], parseInt(e.target.value, 10) || 1)}
        />
      </label>
      <button onClick={() => fileRef.current?.click()}>Import</button>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />
      <button onClick={onExport}>Export</button>
      <button onClick={onExportRuids} title="palette_ruids_<Map>.json — build_map.cjs 가 소비">
        RUID export
      </button>
      <button onClick={requestFit}>뷰 맞춤</button>
      <span className="hint">아이소 그리드 · 좌클릭=페인팅 · 스페이스+드래그=팬 · 휠=줌</span>
    </div>
  );
}
