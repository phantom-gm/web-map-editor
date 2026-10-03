import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatCandidateReview, validateCandidateReview,
  type CandidateIdentity, type GameCandidateReview,
} from "../lib/gameCandidate";

function saveReviewText(review: GameCandidateReview) {
  const blob = new Blob([formatCandidateReview(review)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "candidate-review_" + review.mapName + "_" + review.candidateId + ".txt";
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function fileState(matches: boolean, currentHash: string | null): string {
  return currentHash === null ? "파일 없음" : matches ? "일치" : "변경됨";
}

export function GameCandidatePanel({ candidateId, mapName, baselineId }: CandidateIdentity) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"checking" | "saving" | null>(null);
  const [review, setReview] = useState<GameCandidateReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inspect = useCallback(async (save = false) => {
    request.current?.abort();
    const controller = new AbortController(), requestId = ++generation.current;
    request.current = controller;
    setBusy(save ? "saving" : "checking"); setReview(null); setError(null);
    const current = () => generation.current === requestId && !controller.signal.aborted && dialog.current?.open;
    try {
      const response = await fetch("/api/game-sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review-candidate", candidateId, mapName, baselineId }),
        signal: controller.signal,
      });
      const data = await response.json() as { review?: GameCandidateReview; error?: string };
      if (!current()) return;
      if (!response.ok || !data.review) throw new Error(typeof data.error === "string" ? data.error : "후보 파일 검토 결과를 읽지 못했습니다.");
      validateCandidateReview(data.review, { candidateId, mapName, baselineId });
      if (!current()) return;
      setReview(data.review);
      if (save) saveReviewText(data.review);
    } catch (failure) {
      if (!current()) return;
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (current()) { setBusy(null); request.current = null; }
    }
  }, [candidateId, mapName, baselineId]);

  const cancelReview = useCallback(() => {
    generation.current++; request.current?.abort(); request.current = null;
  }, []);
  const close = useCallback(() => {
    cancelReview();
    if (dialog.current?.open) dialog.current.close();
    setOpen(false); setBusy(null);
  }, [cancelReview]);

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    void inspect();
    return () => {
      cancelReview();
      if (element.open) element.close();
    };
  }, [open, inspect, cancelReview]);

  return <>
    <button className="game-candidate-open" onClick={() => setOpen(true)}>후보 출력 검토</button>
    <dialog ref={dialog} className="game-candidate-dialog" aria-label="후보 출력 검토"
      onClose={() => setOpen(false)}
      onCancel={event => { event.preventDefault(); close(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(); }
      }}
      onKeyUp={event => event.stopPropagation()}>
      <header className="candidate-dialog-head">
        <div><h2>후보 출력 검토</h2><p>{mapName} · 파일 검사</p></div>
        <button type="button" autoFocus onClick={close} aria-label="후보 검토 닫기">닫기 (Esc)</button>
      </header>
      <div className="candidate-dialog-body" aria-busy={busy !== null}>
        <p className="candidate-scope">게임 적용: 안 함 · Maker 실행 검증: 안 함</p>
        <p className="candidate-help">출력된 파일과 검사 기준이 일치하는지 확인합니다. 파일 검토 통과는 게임 반영이나 실행 결과를 보장하지 않습니다.</p>
        {busy && <p className="candidate-loading" role="status">{busy === "saving" ? "요약 저장 전에 파일을 다시 검사하고 있습니다…" : "게임 원본과 후보 파일을 검사하고 있습니다…"}</p>}
        {error && <p className="candidate-error" role="alert">{error}</p>}
        {review && <>
          <div className={"candidate-result " + review.status} role="status">
            <strong>{review.status === "ready" ? "파일 검토 통과" : "다시 확인 필요"}</strong>
            <span>확인 시각: <time dateTime={review.checkedAt}>{new Date(review.checkedAt).toLocaleString()}</time></span>
          </div>
          <section className="candidate-section" aria-label="후보 변경 요약">
            <h3>변경 요약</h3>
            <dl className="candidate-summary">
              <dt>바닥</dt><dd>직접 수정 {review.summary.groundChangedCells}칸 · 주변 재구성 {review.summary.groundRepackedCells}칸</dd>
              <dt>오브젝트</dt><dd>이동 {review.summary.objectsMoved} · 추가 {review.summary.objectsAdded} · 삭제 {review.summary.objectsRemoved}</dd>
              <dt>이동불가</dt><dd>변경 {review.summary.walkChangedCells}칸{review.summary.blockedAdded !== undefined && review.summary.blockedRemoved !== undefined
                ? " · 추가 " + review.summary.blockedAdded + " · 해제 " + review.summary.blockedRemoved : ""}</dd>
            </dl>
          </section>
          <section className="candidate-section" aria-label="원본과 후보 파일 상태">
            <h3>대상 파일 상태</h3>
            {review.files.length ? <div className="candidate-table-wrap"><table className="candidate-files">
              <thead><tr><th scope="col">파일</th><th scope="col">크기</th><th scope="col">게임 원본</th><th scope="col">후보 출력</th></tr></thead>
              <tbody>{review.files.map(file => <tr key={file.path}>
                <th scope="row"><code>{file.path}</code></th><td>{file.bytes.toLocaleString()} bytes</td>
                <td className={file.sourceMatches ? "candidate-pass" : "candidate-fail"}>{fileState(file.sourceMatches, file.currentSourceSha256)}</td>
                <td className={file.candidateMatches ? "candidate-pass" : "candidate-fail"}>{fileState(file.candidateMatches, file.currentCandidateSha256)}</td>
              </tr>)}</tbody>
            </table></div> : <p className="candidate-help">검토할 대상 파일 목록을 확인하지 못했습니다. 아래 검사 결과를 확인하세요.</p>}
            <p className="candidate-reference">reference/ 아래 {review.referenceFiles}개 파일은 참고 사본이며 적용 대상이 아닙니다.</p>
          </section>
          <section className="candidate-section" aria-label="후보 검사 항목">
            <h3>검사 항목</h3>
            <ul className="candidate-checks">{review.checks.map((check, index) => <li key={index}>
              <span className={check.passed ? "candidate-pass" : "candidate-fail"}>{check.passed ? "통과" : "확인 필요"}</span>
              <div>{check.label}{check.detail && <small>{check.detail}</small>}</div>
            </li>)}</ul>
          </section>
          {review.issues.length > 0 && <section className="candidate-section candidate-issues" aria-label="다시 확인할 내용">
            <h3>다시 확인할 내용</h3><ul>{review.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
          </section>}
          <details className="candidate-hashes">
            <summary>SHA-256 전체 값 보기</summary>
            {review.files.map(file => <section key={file.path}>
              <h4>{file.path}</h4>
              <dl><dt>생성 기준 원본</dt><dd><code>{file.sourceSha256}</code></dd>
                <dt>현재 게임 원본</dt><dd><code>{file.currentSourceSha256 ?? "파일 없음"}</code></dd>
                <dt>생성 후보</dt><dd><code>{file.candidateSha256}</code></dd>
                <dt>현재 후보</dt><dd><code>{file.currentCandidateSha256 ?? "파일 없음"}</code></dd></dl>
            </section>)}
          </details>
          <p className="candidate-location">후보 폴더 <code>{review.candidateDir}</code></p>
        </>}
      </div>
      <footer className="candidate-dialog-actions">
        <p>요약은 다시 검사한 결과를 담은 텍스트입니다. 후보 파일 묶음을 저장하지 않습니다.</p>
        <button type="button" disabled={busy !== null} onClick={() => void inspect()}>다시 검사</button>
        <button type="button" disabled={busy !== null} onClick={() => void inspect(true)}>검토 요약 저장</button>
      </footer>
    </dialog>
  </>;
}
