import type { GameSyncReport } from "../lib/gameSync";
import { GameCandidatePanel } from "./GameCandidatePanel";
import { GameCandidateHistory } from "./GameCandidateHistory";
import { useEffect, useRef, useState } from "react";
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
  candidateId?: string;
  resumed?: boolean;
}
import { GameComparisonPanel } from "./GameComparisonPanel";

export function GameSyncPanel() {
  const [maps, setMaps] = useState<string[]>([]);
  const [selected, setSelected] = useState("ferendel");
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"open" | "export" | null>(null);
  const mapSelect = useRef<HTMLSelectElement>(null);
  const diagnostics = useRef<HTMLDetailsElement>(null);
  const [confirmation, setConfirmation] = useState<"fresh" | "discard" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [candidate, setCandidate] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [report, setReport] = useState<SyncReport | null>(null);
  const [resultFor, setResultFor] = useState("");
  const gameSync = useEditorStore(s => s.gameSync);
  const dirty = useEditorStore(s => s.dirty);
  const groundVer = useEditorStore(s => s.groundVer);
  const blockedVer = useEditorStore(s => s.blockedVer);
  const gameNpcsVer = useEditorStore(s => s.gameNpcsVer);
  const gameObjectsVer = useEditorStore(s => s.gameObjectsVer);
  const gameRuntimeVer = useEditorStore(s => s.gameRuntimeVer);
  const contentVersion = [groundVer, blockedVer, gameObjectsVer, gameNpcsVer, gameRuntimeVer].join(":");
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
      const currentMap = useEditorStore.getState().gameSync?.mapName;
      setSelected(currentMap && names.includes(currentMap) ? currentMap : names.includes("ferendel") ? "ferendel" : names[0] ?? "");
    }).catch(() => { if (active) setError("로컬 게임 연결을 확인해 주세요."); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message, resultFor]);
  useEffect(() => {
    const closeOutside = (event: MouseEvent) => { if (diagnostics.current?.open && !diagnostics.current.contains(event.target as Node)) diagnostics.current.open = false; };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
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
    setCandidate(""); setCandidateId(""); setReport(null); setMessage("");
  }

  const openMap = async (fresh = false, discardUnsaved = false) => {
    setConfirmation(null);
    setBusy(true); setBusyAction("open"); setError("");
    const targetMap = fresh || discardUnsaved ? useEditorStore.getState().gameSync?.mapName || selected : selected;
    let token: number | undefined;
    try {
      if (!discardUnsaved && !await preserveCurrentWork()) return;
      token = beginProjectLoad();
      const current = useWorkspaceSession.getState();
      const result = await gameRequest<SyncResult>({
        action: fresh ? "import" : "open", mapName: targetMap,
        ...(fresh ? { expectedRevision: current.revision } : {}),
      });
      if (!isCurrentProjectLoad(token)) return;
      if (!result.project) throw new Error("불러올 맵이 없습니다.");
      if (!await loadEditorProject(result.project, token, result)) return;
      setResultFor(result.project.gameSync?.baselineId ?? "");
      setReport(result.report ?? null);
      setMessage(result.resumed ? "저장된 작업을 열었습니다." : "게임 원본을 열었습니다.");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { if (token !== undefined) finishProjectLoad(token); setBusy(false); setBusyAction(null); }
  };
  const save = async () => {
    setError("");
    try { await saveManagedProject(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const bake = async () => {
    setBusy(true); setBusyAction("export"); setError(""); setCandidate(""); setCandidateId(""); setMessage("");
    const project = useEditorStore.getState().exportProject();
    const captured = JSON.stringify(project);
    try {
      await saveManagedProject();
      const result = await gameRequest<SyncResult>({ action: "export", project });
      if (JSON.stringify(useEditorStore.getState().exportProject()) !== captured) {
        setError("출력을 만드는 동안 맵이 수정되었습니다. 현재 작업을 다시 출력해 주세요.");
        return;
      }
      setReport(result.report ?? null); setCandidate(result.candidateDir ?? "");
      setCandidateId(result.candidateId ?? "");
      setResultFor(project.gameSync?.baselineId ?? "");
      setMessage("");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); setBusyAction(null); }
  };
  const currentPreview = preview.baselineId === gameSync?.baselineId;
  const currentReport = resultFor === gameSync?.baselineId ? report : null;
  const counts = currentPreview ? preview.scene?.report?.counts : currentReport?.counts;
  const locked = busy || session.loading;
  const saveLabel = session.status === "saving" ? "저장 중…" : session.status === "error" ? "저장 실패" :
    dirty ? "변경 내용 자동 저장 대기" : managed ? "이 PC에 저장됨" : "저장 버튼으로 이 PC에 등록";
  const saveState = session.status === "error" ? "error" : session.status === "saving" ? "saving" : dirty ? "dirty" : managed ? "saved" : "idle";
  useEffect(() => {
    const openSelected = () => { if (!locked && maps.length) void openMap(); else mapSelect.current?.focus(); };
    window.addEventListener("msw:open-map", openSelected);
    return () => window.removeEventListener("msw:open-map", openSelected);
  });

  return (
    <section className="game-sync-panel workflow-panel" aria-label="게임 맵 작업">
      <div className="workflow-steps">
        <div className="workflow-step workflow-open-step">
          <span className="workflow-step-number" aria-hidden="true">1</span>
          <div className="workflow-step-content">
            <label htmlFor="game-map-select" className="workflow-step-label">게임 맵 열기</label>
            <div className="workflow-step-actions">
              <select id="game-map-select" ref={mapSelect} aria-label="열 게임 맵" value={selected} onChange={e => setSelected(e.target.value)} disabled={locked || !maps.length}>
                {!maps.length && <option value="">맵 목록 불러오는 중…</option>}
                {maps.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
              <button className="workflow-button workflow-open-button" onClick={() => void openMap()} disabled={locked || !maps.length}>{busyAction === "open" ? "여는 중…" : "맵 열기"}</button>
            </div>
          </div>
        </div>
        <div className="workflow-step workflow-save-step">
          <span className="workflow-step-number" aria-hidden="true">2</span>
          <div className="workflow-step-content">
            <span className="workflow-step-label">작업 저장</span>
            <div className="workflow-step-actions">
              <button className="workflow-button" onClick={() => void save()} disabled={locked || !linked || session.status === "saving"} title="현재 편집 내용을 이 PC에 저장 · Ctrl+S">{session.status === "saving" ? "저장 중…" : "작업 저장"}</button>
              <span className="workflow-save-status" data-state={saveState} role="status">
                {linked ? <><span aria-hidden="true" className="workflow-status-dot" />{saveLabel}{managed && session.savedAt && !dirty && session.status === "saved" && <time dateTime={session.savedAt}>{new Date(session.savedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</time>}</> : "맵을 열면 자동 저장됩니다"}
              </span>
            </div>
          </div>
        </div>
        <div className="workflow-step workflow-export-step">
          <span className="workflow-step-number" aria-hidden="true">3</span>
          <div className="workflow-step-content">
            <span className="workflow-step-label">검토하고 가져가기</span>
            <div className="workflow-step-actions">
              <button className="workflow-button workflow-export-button" onClick={() => void bake()} disabled={locked || !linked}>{busyAction === "export" ? "출력 만드는 중…" : "게임용 출력 만들기"}</button>
              {gameSync && !session.loading && <GameCandidateHistory key={gameSync.baselineId} mapName={gameSync.mapName} baselineId={gameSync.baselineId} disabled={locked} />}
            </div>
          </div>
        </div>
      </div>
      {linked && <div className="workflow-context-row">
        <GameComparisonPanel />
      <details ref={diagnostics} className="game-sync-details workflow-diagnostics" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.stopPropagation(); } }}>
        <summary>표시·진단 정보 · 원본 관리</summary>
        <div className="workflow-diagnostics-popover">
        <div className="game-sync-view">
          <label><input type="checkbox" checked={preview.showScene} disabled={preview.comparisonEnabled} onChange={e => preview.setShowScene(e.target.checked)} />게임 배치 보기</label>
          <label><input type="checkbox" checked={preview.showOverlays} onChange={e => preview.setShowOverlays(e.target.checked)} />편집 표시</label>
          <button onClick={preview.refresh} disabled={preview.status === "loading" || locked}>이미지 다시 읽기</button>
          <span>{currentPreview && preview.status === "loading" ? "게임 배치·이미지 읽는 중…" : currentPreview && preview.status === "ready" ? "미리보기 준비됨" : "미리보기 준비 중"}</span>
        </div>
        {counts && <p className="workflow-counts">
          현재 작업 · {counts.groundCells.toLocaleString()}칸 / 타일 바닥 {counts.groundEntities.toLocaleString()}개
          {" · "}4×4 {counts.bySize["4"] ?? 0} / 2×2 {counts.bySize["2"] ?? 0} / 1×1 {counts.bySize["1"] ?? 0}
          {currentReport?.exactMapBytes === true && currentReport?.unchanged !== false && " · 원본 맵과 완전 일치"}
          {currentPreview && preview.scene?.objects && " · 오브젝트 " + preview.scene.objects.length + "개"}
          {currentPreview && preview.scene?.npcs && " · NPC " + preview.scene.npcs.length + "개"}
          {currentPreview && preview.scene?.monsters && " · 출현 지점 " + preview.scene.monsters.length + "개"}
          {currentPreview && preview.scene?.portals && " · 포털 " + preview.scene.portals.length + "개"}
          {currentReport?.unchanged === false && <>
            {" · 바닥 수정 " + (currentReport.changedCells ?? 0) + "칸 / 재구성 " + (currentReport.affectedCells ?? 0) + "칸"}
            {currentReport.objectChanges && " · 오브젝트 이동 " + currentReport.objectChanges.moved + " / 추가 " + currentReport.objectChanges.added + " / 삭제 " + currentReport.objectChanges.removed}
            {" · 이동불가 변경 " + (currentReport.walkChangedCells ?? 0) + "칸"}
          </>}
        </p>}
        <div className="workflow-source-actions"><strong>원본 관리</strong><button onClick={() => { if (diagnostics.current) diagnostics.current.open = false; setConfirmation("fresh"); }} disabled={locked || !managed}>게임 원본 다시 가져오기…</button></div>
        <p>작업은 이 PC에 자동 저장됩니다. 전체 작업을 백업하려면 에디터의 .game-sync 폴더를 함께 보관하세요.</p>
        <details><summary>편집·미리보기 지원 범위</summary>
          <p>타일 바닥은 큰 묶음을 유지합니다. 건물·장식·오브젝트 바닥은 원본 모양과 배율을 유지하며 이동·복제·삭제할 수 있습니다.</p>
          <p>Ctrl·Shift+클릭으로 여러 오브젝트를 선택합니다. 이동불가 칸은 직접 선택해야 함께 이동·복제·삭제됩니다. 선택하지 않은 칸은 유지됩니다.</p>
          <p>NPC·몬스터는 게임 원본의 정지 외형으로 표시합니다. 몬스터는 출현 지점·수량·범위를, 포털은 도착지를, 시작 위치는 좌표를 편집합니다. 애니메이션·실제 맵 이동·플레이어에 따른 가림물 투명화는 게임에서 확인해야 합니다.</p>
        </details>
        {currentPreview && preview.warnings.length > 0 && <details className="workflow-warnings"><summary>미리보기 참고 사항 {preview.warnings.length}개</summary>{preview.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}
        </div>
      </details>
        {message && resultFor === gameSync?.baselineId && <span className="workflow-result-message" role="status">{message}<button type="button" aria-label="열기 안내 닫기" onClick={() => setMessage("")}>×</button></span>}
        <span className="workflow-output-scope">출력은 검토용 파일로 만듭니다 · 게임 자동 반영 없음</span>
      </div>}
      {session.status === "error" && linked && <div className="workflow-save-failure" role="alert">
        <div><strong>현재 변경 내용을 저장하지 못했습니다.</strong><p>{session.error || "연결을 확인하고 다시 저장해 주세요."}</p></div>
        <button className="workflow-button" onClick={() => void save()} disabled={locked}>다시 저장</button>
        <button className="workflow-text-button" onClick={() => setConfirmation("discard")} disabled={locked}>이전 저장본 다시 열기</button>
      </div>}
      {error && error !== session.error && <div className="game-sync-error" role="alert">{error}</div>}
      {currentPreview && preview.error && <div className="game-sync-error" role="alert">미리보기: {preview.error}</div>}
      {currentPreview && preview.missingImages > 0 && <div className="workflow-image-warning" role="status">이미지 {preview.missingImages}종을 불러오지 못했습니다. 표시·진단 정보에서 다시 읽을 수 있습니다.</div>}
      {confirmation && <div className="game-sync-confirm workflow-confirm" role="alert">
        <p>{confirmation === "fresh" ? "현재 작업을 이력에 보관한 뒤 이 맵의 게임 원본으로 다시 시작합니다." : "미저장 수정을 닫고 이 맵의 이전 저장본을 엽니다. 보관할 수정은 먼저 파일·백업 메뉴에서 사본으로 저장하세요."}</p>
        <button className="workflow-button" onClick={() => void openMap(confirmation === "fresh", confirmation === "discard")} disabled={locked}>확인하고 열기</button>
        <button className="workflow-button" onClick={() => setConfirmation(null)}>취소</button>
      </div>}
      {candidate && resultFor === gameSync?.baselineId && <div className="game-sync-output workflow-output">
        <strong>출력 준비 완료</strong>
        {candidateId && gameSync && !session.loading && <GameCandidatePanel key={candidateId}
          candidateId={candidateId} mapName={gameSync.mapName} baselineId={gameSync.baselineId} />}
        <details><summary>출력 폴더 위치</summary><code>{candidate}</code></details>
      </div>}

    </section>
  );
}
