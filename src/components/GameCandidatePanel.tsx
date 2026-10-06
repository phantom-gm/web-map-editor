import { Fragment } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatCandidateReview, formatCandidateNpcSummary, formatCandidateRuntimeSummary, validateCandidateReview, validateCandidateZipHeaders,
  type CandidateIdentity, type GameCandidateReview,
} from "../lib/gameCandidate";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function saveReviewText(review: GameCandidateReview) {
  downloadBlob(new Blob([formatCandidateReview(review)], { type: "text/plain;charset=utf-8" }),
    "candidate-review_" + review.mapName + "_" + review.candidateId + ".txt");
}
function fileState(matches: boolean, currentHash: string | null): string {
  return currentHash === null ? "파일 없음" : matches ? "일치" : "변경됨";
}

export function GameCandidatePanel(identity: CandidateIdentity) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="game-candidate-open" onClick={() => setOpen(true)}>후보 출력 검토</button>
    {open && <GameCandidateReviewDialog {...identity} onClose={() => setOpen(false)} />}
  </>;
}

export function GameCandidateReviewDialog({ candidateId, mapName, baselineId, onClose, fromHistory = false }:
  CandidateIdentity & { onClose: () => void; fromHistory?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [busy, setBusy] = useState<"checking" | "saving" | "zip" | null>(null);
  const [review, setReview] = useState<GameCandidateReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const inspect = useCallback(async (mode: "checking" | "saving" | "zip" = "checking") => {
    request.current?.abort();
    const controller = new AbortController(), requestId = ++generation.current;
    request.current = controller;
    setBusy(mode);
    if (mode !== "zip") setReview(null);
    setError(null); setNotice(null);
    const current = () => generation.current === requestId && !controller.signal.aborted && dialog.current?.open;
    const identity = { candidateId, mapName, baselineId };
    let blockedZipReview: GameCandidateReview | null = null;
    try {
      const response = await fetch(mode === "zip" ? "/api/game-sync/candidate-download" : "/api/game-sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "zip" ? identity : { action: "review-candidate", ...identity }),
        signal: controller.signal,
      });
      if (mode === "zip" && response.ok) {
        const filename = validateCandidateZipHeaders(identity, response.headers.get("Content-Type"), response.headers.get("Content-Disposition"));
        const blob = await response.blob();
        const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
        if (!current()) return;
        if (signature.length !== 4 || signature[0] !== 0x50 || signature[1] !== 0x4b ||
          signature[2] !== 0x03 || signature[3] !== 0x04) throw new Error("ZIP 파일 형식을 확인하지 못했습니다. 다시 검사해 주세요.");
        downloadBlob(blob, filename);
        setNotice("파일 검사를 통과한 후보 ZIP을 내려받았습니다. 게임에는 반영하지 않았습니다.");
        return;
      }
      const data = await response.json() as { review?: GameCandidateReview; error?: string };
      if (!current()) return;
      if (mode === "zip" && data.review) {
        validateCandidateReview(data.review, identity);
        if (data.review.status === "blocked") blockedZipReview = data.review;
      }
      if (!response.ok || !data.review) throw new Error(typeof data.error === "string" ? data.error : "후보 파일 검토 결과를 읽지 못했습니다.");
      validateCandidateReview(data.review, identity);
      if (!current()) return;
      setReview(data.review);
      if (mode === "saving") saveReviewText(data.review);
    } catch (failure) {
      if (!current()) return;
      if (mode === "zip") setReview(blockedZipReview);
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
    onClose();
  }, [cancelReview, onClose]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    void inspect();
    return () => {
      cancelReview();
      if (element.open) element.close();
    };
  }, [inspect, cancelReview]);

  return <dialog ref={dialog} className="game-candidate-dialog" aria-label="후보 출력 검토"
      onCancel={event => { event.preventDefault(); close(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(); }
      }}
      onKeyUp={event => event.stopPropagation()}>
      <header className="candidate-dialog-head">
        <div><h2>후보 출력 검토</h2><p>{mapName} · 파일 검사</p></div>
        <button type="button" autoFocus onClick={close} aria-label="후보 검토 닫기">{fromHistory ? "기록으로 (Esc)" : "닫기 (Esc)"}</button>
      </header>
      <div className="candidate-dialog-body" aria-busy={busy !== null}>
        <p className="candidate-scope">게임 적용: 안 함 · Maker 실행 검증: 안 함</p>
        <p className="candidate-help">이 후보는 생성 시점의 출력물입니다. 현재 편집 내용을 바꾸거나 되돌리지 않습니다.</p>
        <p className="candidate-help">출력된 파일과 검사 기준이 일치하는지 확인합니다. 파일 검토 통과는 게임 반영이나 실행 결과를 보장하지 않습니다.</p>
        {busy && <p className="candidate-loading" role="status">{busy === "saving" ? "요약 저장 전에 파일을 다시 검사하고 있습니다…" : busy === "zip" ? "파일을 다시 검사하고 ZIP을 준비하고 있습니다…" : "게임 원본과 후보 파일을 검사하고 있습니다…"}</p>}
        {error && <p className="candidate-error" role="alert">{error}</p>}
        {notice && <p className="candidate-loading" role="status">{notice}</p>}
        {review && <>
          <div className={"candidate-result " + review.status} role="status">
            <strong>{review.status === "ready" ? "파일 검토 통과" : "다시 확인 필요"}</strong>
            <span>확인 시각: <time dateTime={review.checkedAt}>{new Date(review.checkedAt).toLocaleString()}</time></span>
          </div>
          <section className="candidate-section" aria-label="후보 변경 요약">
            <h3>변경 요약</h3>
            <dl className="candidate-summary">
              <dt>바닥</dt><dd>직접 수정 {review.summary.groundChangedCells}칸 · 주변 재구성 {review.summary.groundRepackedCells}칸</dd>
              <dt>오브젝트</dt><dd>이동 {review.summary.objectsMoved} · 추가 {review.summary.objectsAdded} · 삭제 {review.summary.objectsRemoved} · 정렬 {review.summary.objectsSorted ?? 0}</dd>
              <dt>이동불가</dt><dd>변경 {review.summary.walkChangedCells}칸{review.summary.blockedAdded !== undefined && review.summary.blockedRemoved !== undefined
                ? " · 추가 " + review.summary.blockedAdded + " · 해제 " + review.summary.blockedRemoved : ""}</dd>
              {formatCandidateNpcSummary(review.summary) !== null && <><dt>NPC</dt><dd>{formatCandidateNpcSummary(review.summary)}</dd></>}
              {formatCandidateRuntimeSummary(review.summary).map(row => <Fragment key={row.label}><dt>{row.label}</dt><dd>{row.text}</dd></Fragment>)}
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
        <p>요약은 텍스트이며, ZIP은 서버에서 다시 검사한 후보 파일 묶음입니다. 게임에는 자동 반영하지 않습니다.</p>
        <button type="button" disabled={busy !== null} onClick={() => void inspect()}>다시 검사</button>
        <button type="button" disabled={busy !== null} onClick={() => void inspect("saving")}>검토 요약 저장</button>
        <button type="button" disabled={busy !== null || review?.status !== "ready" || !!error} onClick={() => void inspect("zip")}>적용 파일 ZIP 받기</button>
      </footer>
    </dialog>;
}
