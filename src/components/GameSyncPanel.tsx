import type { GameSyncReport } from "../lib/gameSync";
import { useEffect, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import {
  beginProjectLoad, finishProjectLoad, gameRequest, isCurrentProjectLoad,
  loadEditorProject, preserveCurrentWork, saveManagedProject, useWorkspaceSession,
  type WorkspaceReceipt,
} from "../lib/gameWorkspace";
import type { ProjectFileInput } from "../lib/projectIO";

type SyncReport = GameSyncReport;
interface SyncResult extends WorkspaceReceipt {
  project?: ProjectFileInput;
  report?: SyncReport;
  candidateDir?: string;
  resumed?: boolean;
}
import { GameComparisonPanel } from "./GameComparisonPanel";

export function GameSyncPanel() {
  const [maps, setMaps] = useState<string[]>([]);
  const [selected, setSelected] = useState("ferendel");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<"fresh" | "discard" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [candidate, setCandidate] = useState("");
  const [report, setReport] = useState<SyncReport | null>(null);
  const [resultFor, setResultFor] = useState("");
  const gameSync = useEditorStore(s => s.gameSync);
  const dirty = useEditorStore(s => s.dirty);
  const groundVer = useEditorStore(s => s.groundVer);
  const blockedVer = useEditorStore(s => s.blockedVer);
  const gameObjectsVer = useEditorStore(s => s.gameObjectsVer);
  const contentVersion = [groundVer, blockedVer, gameObjectsVer].join(":");
  const session = useWorkspaceSession();
  const preview = useGamePreviewStore();
  const linked = !!gameSync;
  const managed = linked && session.baselineId === gameSync.baselineId;

  useEffect(() => {
    let active = true;
    void fetch("/api/game-sync").then(async res => {
      const data = await res.json() as { maps?: string[]; error?: string };
      if (!active) return;
      if (!res.ok) { setError(data.error || "게임 연결을 확인해 주세요."); return; }
      const names = data.maps ?? [];
      setMaps(names);
      setSelected(names.includes("ferendel") ? "ferendel" : names[0] ?? "");
    }).catch(() => { if (active) setError("로컬 게임 연결을 확인해 주세요."); });
    return () => { active = false; };
  }, []);
  const [lastBaseline, setLastBaseline] = useState(gameSync?.baselineId);
  const [lastGroundVer, setLastGroundVer] = useState(contentVersion);
  if (lastBaseline !== gameSync?.baselineId) {
    setLastBaseline(gameSync?.baselineId);
    if (gameSync) setSelected(gameSync.mapName);
  }
  // Hide a previous candidate as soon as another stroke changes the current output.
  if (lastGroundVer !== contentVersion) {
    setLastGroundVer(contentVersion);
    setCandidate(""); setReport(null); setMessage("");
  }

  const openMap = async (fresh = false, discardUnsaved = false) => {
    setConfirmation(null);
    setBusy(true); setError("");
    let token: number | undefined;
    try {
      if (!discardUnsaved && !await preserveCurrentWork()) return;
      token = beginProjectLoad();
      const current = useWorkspaceSession.getState();
      const result = await gameRequest<SyncResult>({
        action: fresh ? "import" : "open", mapName: selected,
        ...(fresh ? { expectedRevision: current.revision } : {}),
      });
      if (!isCurrentProjectLoad(token)) return;
      if (!result.project) throw new Error("불러올 맵이 없습니다.");
      if (!await loadEditorProject(result.project, token, result)) return;
      setResultFor(result.project.gameSync?.baselineId ?? "");
      setReport(result.report ?? null);
      setMessage(result.resumed ? "저장된 작업을 이어서 열었습니다." : "게임 원본에서 시작했습니다. 작업은 이 PC에 자동 저장됩니다.");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { if (token !== undefined) finishProjectLoad(token); setBusy(false); }
  };
  const save = async () => {
    setError("");
    try { await saveManagedProject(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const bake = async () => {
    setBusy(true); setError(""); setCandidate(""); setMessage("");
    const project = useEditorStore.getState().exportProject();
    const captured = JSON.stringify(project);
    try {
      await saveManagedProject();
      const result = await gameRequest<SyncResult>({ action: "export", project });
      if (JSON.stringify(useEditorStore.getState().exportProject()) !== captured) {
        setError("굽는 동안 맵이 수정되었습니다. 현재 화면을 출력하려면 다시 구워 주세요.");
        return;
      }
      setReport(result.report ?? null); setCandidate(result.candidateDir ?? "");
      setResultFor(project.gameSync?.baselineId ?? "");
      setMessage("후보 맵을 만들었습니다. 게임에 적용하기 전 검토할 출력물입니다.");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const currentPreview = preview.baselineId === gameSync?.baselineId;
  const currentReport = resultFor === gameSync?.baselineId ? report : null;
  const counts = currentPreview ? preview.scene?.report?.counts : currentReport?.counts;
  const locked = busy || session.loading;
  const saveLabel = session.status === "saving" ? "저장 중…" : session.status === "error" ? "저장 실패" :
    dirty ? "저장 대기…" : managed ? "이 PC에 저장됨" : "작업 저장으로 등록";

  return (
    <section className="game-sync-panel" aria-label="게임 맵 작업">
      <div className="game-sync-controls">
        <strong>게임 맵</strong>
        <select aria-label="열 게임 맵" value={selected} onChange={e => setSelected(e.target.value)} disabled={locked || !maps.length}>
          {maps.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <button className="game-open" onClick={() => void openMap()} disabled={locked || !maps.length}>맵 열기</button>
        <button onClick={() => void save()} disabled={locked || !linked || session.status === "saving"}>작업 저장</button>
        <button onClick={() => void bake()} disabled={locked || !linked}>후보 맵 굽기</button>
        {session.status === "error" && linked && <button onClick={() => setConfirmation("discard")} disabled={locked}>저장본 다시 열기</button>}
        {linked && <span className="game-save-state" role="status">{gameSync.mapName} · {saveLabel}{managed && session.savedAt && !dirty ? " " + new Date(session.savedAt).toLocaleTimeString("ko-KR") : ""}</span>}
        {!linked && <span>맵을 선택하면 기존 작업을 이어 엽니다.</span>}
      </div>
      {confirmation && <div className="game-sync-confirm" role="alert">
        <p>{confirmation === "fresh" ? "현재 작업을 이력에 보관한 뒤 게임 원본으로 다시 시작합니다." : "미저장 수정을 닫고 이 PC의 저장본을 엽니다. 보관할 수정은 먼저 파일 사본으로 저장하세요."}</p>
        <button onClick={() => void openMap(confirmation === "fresh", confirmation === "discard")} disabled={locked}>확인하고 열기</button>
        <button onClick={() => setConfirmation(null)}>취소</button>
      </div>}
      {linked && <div className="game-sync-view">
        <label><input type="checkbox" checked={preview.showScene} disabled={preview.comparisonEnabled} onChange={e => preview.setShowScene(e.target.checked)} />게임 배치 보기</label>
        <label><input type="checkbox" checked={preview.showOverlays} onChange={e => preview.setShowOverlays(e.target.checked)} />편집 표시</label>
        <button onClick={preview.refresh} disabled={preview.status === "loading" || locked}>이미지 다시 읽기</button>
        <span>{currentPreview && preview.status === "loading" ? "게임 배치·이미지 읽는 중…" :
          currentPreview && preview.status === "ready" ? "바닥·건물·장식 실제 배치" : "미리보기 준비 중"}</span>
        {currentPreview && preview.missingImages > 0 && <strong className="game-sync-error">이미지 미해석 {preview.missingImages}종</strong>}
      </div>}
      {linked && <GameComparisonPanel />}
      {counts && <div className="game-sync-message">
        {preview.comparisonEnabled && "현재 작업 · "}{counts.groundCells.toLocaleString()}칸 / 타일 바닥 {counts.groundEntities.toLocaleString()}개
        {" · "}4×4 {counts.bySize["4"] ?? 0} / 2×2 {counts.bySize["2"] ?? 0} / 1×1 {counts.bySize["1"] ?? 0}
        {currentReport?.exactMapBytes === true && currentReport?.unchanged !== false && " · 원본 맵과 완전 일치"}
        {currentPreview && preview.scene?.objects && ` · 오브젝트 ${preview.scene.objects.length}개`}
        {currentReport?.unchanged === false && <>
          {` · 바닥 수정 ${currentReport.changedCells ?? 0}칸 / 재구성 ${currentReport.affectedCells ?? 0}칸`}
          {currentReport.objectChanges && ` · 오브젝트 이동 ${currentReport.objectChanges.moved} / 추가 ${currentReport.objectChanges.added} / 삭제 ${currentReport.objectChanges.removed}`}
          {` · 이동불가 변경 ${currentReport.walkChangedCells ?? 0}칸`}
        </>}
      </div>}
      {linked && <details className="game-sync-details">
        <summary>원본 연결·미리보기 안내</summary>
        <p>타일 바닥은 큰 묶음을 유지하며 수정합니다. 건물·장식·오브젝트 바닥은 목록이나 맵에서 선택해 이동·복제·삭제할 수 있습니다. 원본 모양과 배율은 유지합니다.</p>
        <p>Ctrl·Shift+클릭으로 여러 오브젝트를 선택할 수 있습니다. 함께 옮길 이동불가 칸을 직접 선택하면 이동·복제·삭제와 실행취소가 한 번에 적용됩니다. 선택하지 않은 칸은 그대로 유지됩니다. 변경한 맵과 이동불가 데이터는 후보 폴더에만 출력합니다.</p>
        <p>NPC·몬스터·포탈은 편집 표시의 위치 마커로 확인합니다. 움직임·애니메이션·게임 중 효과는 이 미리보기에 포함되지 않습니다.</p>
        <p>작업과 기준 배치는 에디터가 이 PC에서 관리합니다. 백업할 때는 에디터의 .game-sync 폴더를 통째로 보관하세요. PC나 게임 경로를 바꾸면 원본 연결을 다시 확인해야 합니다.</p>
        <button onClick={() => setConfirmation("fresh")} disabled={locked || !managed || selected !== gameSync.mapName}>게임 원본 다시 가져오기</button>
        {currentPreview && preview.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
      </details>}
      {(error || session.error) && <div className="game-sync-error" role="alert">{error || session.error}</div>}
      {currentPreview && preview.error && <div className="game-sync-error" role="alert">{preview.error}</div>}
      {message && resultFor === gameSync?.baselineId && <div className="game-sync-message">{message}</div>}
      {candidate && resultFor === gameSync?.baselineId && <div className="game-sync-output">출력 폴더: <code>{candidate}</code></div>}
    </section>
  );
}