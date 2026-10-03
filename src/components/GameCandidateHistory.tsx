import { Fragment } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  validateCandidateHistory, formatCandidateNpcSummary, formatCandidateRuntimeSummary, type CandidateIdentity, type GameCandidateHistory as CandidateHistory,
} from "../lib/gameCandidate";
import { GameCandidateReviewDialog } from "./GameCandidatePanel";

export function GameCandidateHistory({ mapName, baselineId, disabled = false }:
  Pick<CandidateIdentity, "mapName" | "baselineId"> & { disabled?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const historyRef = useRef<CandidateHistory | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CandidateIdentity | null>(null);
  const [history, setHistory] = useState<CandidateHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRequest = useCallback(() => {
    generation.current++; request.current?.abort(); request.current = null;
  }, []);
  const loadHistory = useCallback(async () => {
    cancelRequest();
    const controller = new AbortController(), requestId = generation.current;
    request.current = controller;
    historyRef.current = null; setHistory(null); setError(null); setBusy(true);
    const current = () => generation.current === requestId && !controller.signal.aborted && dialog.current?.open;
    try {
      const response = await fetch("/api/game-sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-candidates", mapName, baselineId }), signal: controller.signal,
      });
      const result = await response.json() as { history?: CandidateHistory; error?: string };
      if (!current()) return;
      if (!response.ok || !result.history) throw new Error(typeof result.error === "string" ? result.error : "후보 기록을 읽지 못했습니다.");
      validateCandidateHistory(result.history, { mapName, baselineId });
      historyRef.current = result.history; setHistory(result.history);
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (current()) { setBusy(false); request.current = null; }
    }
  }, [mapName, baselineId, cancelRequest]);
  const close = useCallback(() => {
    cancelRequest();
    if (dialog.current?.open) dialog.current.close();
    setOpen(false); setSelected(null); setBusy(false);
  }, [cancelRequest]);

  useEffect(() => {
    if (!open || selected) return;
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    if (!historyRef.current) void loadHistory();
    return () => { cancelRequest(); if (element.open) element.close(); };
  }, [open, selected, loadHistory, cancelRequest]);

  const openReview = (identity: CandidateIdentity) => {
    // Close the current top-layer dialog before mounting the review. Never stack modal focus traps.
    cancelRequest();
    if (dialog.current?.open) dialog.current.close();
    setSelected(identity);
  };

  return <>
    <button className="game-candidate-open" disabled={disabled} onClick={() => {
      historyRef.current = null; setHistory(null); setSelected(null); setOpen(true);
    }}>후보 기록</button>
    <dialog ref={dialog} className="game-candidate-dialog candidate-history-dialog" aria-label="후보 기록"
      onCancel={event => { event.preventDefault(); close(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(); }
      }} onKeyUp={event => event.stopPropagation()}>
      <header className="candidate-dialog-head">
        <div><h2>후보 기록</h2><p>{mapName} · 최근 100개까지</p></div>
        <button type="button" autoFocus onClick={close}>닫기 (Esc)</button>
      </header>
      <div className="candidate-dialog-body" aria-busy={busy}>
        <p className="candidate-scope">구워 둔 생성 시점의 출력물입니다. 현재 편집 내용을 바꾸거나 복원하지 않습니다.</p>
        <p className="candidate-help">현재 기준과 이전 기준의 후보를 함께 보여줍니다. 파일 상태는 후보를 열 때 다시 검사하며, 기록 목록만으로 검토 통과를 판단하지 않습니다.</p>
        {busy && <p className="candidate-loading" role="status">후보 기록을 읽는 중…</p>}
        {error && <p className="candidate-error" role="alert">{error}</p>}
        {history && <>
          <p className="candidate-help">{history.candidates.length}개 기록{history.skipped > 0 ? " · 식별 정보를 확인할 수 없는 " + history.skipped + "개 제외" : ""}</p>
          {!history.candidates.length ? <p className="candidate-loading">이 맵의 후보 기록이 없습니다. 편집 화면에서 후보 맵을 구우면 여기에 남습니다.</p> :
            <ol className="candidate-history-list">{history.candidates.map(item => <li key={item.candidateId}>
              <button type="button" className="candidate-history-item" disabled={!item.reviewAvailable}
                onClick={() => openReview({ candidateId: item.candidateId, mapName: item.mapName, baselineId: item.baselineId })}>
                <span className="candidate-history-top"><strong><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></strong>
                  <span className={item.sameBaseline ? "candidate-history-current" : "candidate-history-previous"}>{item.sameBaseline ? "현재 기준" : "이전 기준"}</span></span>
                <code className="candidate-history-id">{item.candidateId}</code>
                <span>바닥 수정 {item.summary.groundChangedCells}칸 · 주변 재구성 {item.summary.groundRepackedCells}칸</span>
                <span>오브젝트 이동 {item.summary.objectsMoved} · 추가 {item.summary.objectsAdded} · 삭제 {item.summary.objectsRemoved} / 이동불가 변경 {item.summary.walkChangedCells}칸</span>
                {formatCandidateNpcSummary(item.summary) !== null && <span>NPC {formatCandidateNpcSummary(item.summary)}</span>}
                {formatCandidateRuntimeSummary(item.summary).map(row => <Fragment key={row.label}><span>{row.label} {row.text}</span></Fragment>)}
                <span className="candidate-history-bottom">대상 파일 {item.applyFileCount}개 · 참고 사본 {item.referenceFiles}개
                  <strong>{item.reviewAvailable ? "검토 열기 →" : "검토 자료 없음 · 다시 굽기 필요"}</strong></span>
              </button>
            </li>)}</ol>}
        </>}
      </div>
      <footer className="candidate-dialog-actions">
        <p>후보를 열어 파일을 검토한 뒤 요약이나 적용 파일 ZIP을 받을 수 있습니다. 게임에는 자동 반영하지 않습니다.</p>
        <button type="button" disabled={busy} onClick={() => void loadHistory()}>기록 새로고침</button>
      </footer>
    </dialog>
    {open && selected && <GameCandidateReviewDialog {...selected} fromHistory onClose={() => setSelected(null)} />}
  </>;
}
