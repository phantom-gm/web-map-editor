/** A read-only check of candidate files, never a game application receipt. */
export interface CandidateIdentity { candidateId: string; mapName: string; baselineId: string }
export interface GameCandidateReview extends CandidateIdentity {
  candidateDir: string;
  createdAt: string;
  checkedAt: string;
  status: "ready" | "blocked";
  files: Array<{
    path: string; bytes: number;
    sourceSha256: string; candidateSha256: string;
    currentSourceSha256: string | null; currentCandidateSha256: string | null;
    sourceMatches: boolean; candidateMatches: boolean;
  }>;
  referenceFiles: number;
  checks: Array<{ label: string; passed: boolean; detail?: string }>;
  issues: string[];
  summary: {
    groundChangedCells: number; groundRepackedCells: number;
    objectsMoved: number; objectsAdded: number; objectsRemoved: number;
    walkChangedCells: number; blockedAdded?: number; blockedRemoved?: number;
    npcsMoved?: number; npcsAdded?: number; npcsRemoved?: number; npcsUpdated?: number;
  };
  gameApplied: false;
  runtimeVerified: false;
}

const npcSummaryCounts = ["npcsMoved", "npcsAdded", "npcsRemoved", "npcsUpdated"] as const;
const optionalSummaryCounts = ["blockedAdded", "blockedRemoved", ...npcSummaryCounts] as const;

/** Do not show another map's or an internally contradictory receipt as a successful check. */
export function validateCandidateReview(review: GameCandidateReview, expected: CandidateIdentity): void {
  validateCandidateIdentity(expected);
  if (!review || review.candidateId !== expected.candidateId || review.mapName !== expected.mapName ||
    review.baselineId !== expected.baselineId || !["ready", "blocked"].includes(review.status) ||
    review.gameApplied !== false || review.runtimeVerified !== false || !Array.isArray(review.files) ||
    !Array.isArray(review.checks) || !Array.isArray(review.issues) || !review.summary ||
    (review.createdAt !== "" || review.status === "ready") && !Number.isFinite(Date.parse(review.createdAt)) || !Number.isFinite(Date.parse(review.checkedAt))) {
    throw new Error("현재 후보와 검토 결과가 일치하지 않습니다. 다시 확인해 주세요.");
  }
  const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const requiredCounts = ["groundChangedCells", "groundRepackedCells", "objectsMoved", "objectsAdded", "objectsRemoved", "walkChangedCells"] as const;
  if (typeof review.candidateDir !== "string" || !count(review.referenceFiles) ||
    review.issues.some(issue => typeof issue !== "string") ||
    requiredCounts.some(key => !count(review.summary[key])) ||
    optionalSummaryCounts.some(key => review.summary[key] !== undefined && !count(review.summary[key])) ||
    review.checks.some(check => !check || typeof check.label !== "string" || typeof check.passed !== "boolean" ||
      (check.detail !== undefined && typeof check.detail !== "string")) ||
    review.files.some(file => !file || typeof file.path !== "string" || !file.path ||
      file.path.includes("\\") || file.path.includes(":") || file.path.startsWith("/") ||
      file.path.split("/").some(part => !part || part === "." || part === "..") ||
      file.path.startsWith("reference/") || !count(file.bytes) ||
      !sha(file.sourceSha256) || !sha(file.candidateSha256) ||
      (file.currentSourceSha256 !== null && !sha(file.currentSourceSha256)) ||
      (file.currentCandidateSha256 !== null && !sha(file.currentCandidateSha256)) ||
      typeof file.sourceMatches !== "boolean" || typeof file.candidateMatches !== "boolean") ||
    new Set(review.files.map(file => file.path)).size !== review.files.length) {
    throw new Error("후보 검토 정보의 형식이 올바르지 않습니다. 후보 맵을 다시 구워 주세요.");
  }
  if (review.status === "ready" && (!review.files.length || !review.checks.length || review.issues.length ||
    review.files.some(file => !file.sourceMatches || !file.candidateMatches ||
      file.sourceSha256 !== file.currentSourceSha256 || file.candidateSha256 !== file.currentCandidateSha256) ||
    review.checks.some(check => !check.passed))) {
    throw new Error("파일 검토 결과가 서로 맞지 않습니다. 후보 맵을 다시 구워 주세요.");
  }
}

/** Missing fields identify a legacy receipt; do not relabel it as zero NPC edits. */
export function formatCandidateNpcSummary(summary: GameCandidateSummary): string | null {
  if (!npcSummaryCounts.some(key => summary[key] !== undefined)) return null;
  return "이동 " + (summary.npcsMoved ?? 0) + " / 추가 " + (summary.npcsAdded ?? 0) +
    " / 삭제 " + (summary.npcsRemoved ?? 0) + " / 반전·대사 " + (summary.npcsUpdated ?? 0);
}

export function formatCandidateReview(review: GameCandidateReview): string {
  const s = review.summary, npcSummary = formatCandidateNpcSummary(s);
  const lines = [
    "맵 후보 출력물 검토", "맵: " + review.mapName, "후보 ID: " + review.candidateId,
    "만든 시각: " + (review.createdAt || "확인 불가"), "확인 시각: " + review.checkedAt,
    "검토 결과: " + (review.status === "ready" ? "파일 검토 통과" : "다시 확인 필요"),
    "게임 적용: 안 함 / Maker 실행 검증: 안 함", "후보 폴더: " + review.candidateDir, "",
    "변경 요약", "바닥 직접 수정 " + s.groundChangedCells + "칸 / 주변 재구성 " + s.groundRepackedCells + "칸",
    "오브젝트 이동 " + s.objectsMoved + " / 추가 " + s.objectsAdded + " / 삭제 " + s.objectsRemoved,
    "이동불가 변경 " + s.walkChangedCells + "칸", ...(npcSummary === null ? [] : ["NPC " + npcSummary]), "", "적용 대상 파일 (참고 사본 제외)",
  ];
  for (const file of review.files) lines.push(
    file.path + " (" + file.bytes + " bytes)",
    "  게임 원본: " + (file.sourceMatches ? "일치" : "변경 또는 누락"),
    "  후보 출력: " + (file.candidateMatches ? "일치" : "변경 또는 누락"),
    "  예상 원본 SHA-256: " + file.sourceSha256, "  현재 원본 SHA-256: " + (file.currentSourceSha256 ?? "없음"),
    "  생성 후보 SHA-256: " + file.candidateSha256, "  현재 후보 SHA-256: " + (file.currentCandidateSha256 ?? "없음"));
  lines.push("", "검사 항목");
  for (const check of review.checks) lines.push((check.passed ? "통과: " : "확인 필요: ") + check.label + (check.detail ? " — " + check.detail : ""));
  if (review.issues.length) lines.push("", "다시 확인할 내용", ...review.issues.map(issue => "- " + issue));
  lines.push("", "참고 사본: reference/ 아래 " + review.referenceFiles + "개 파일은 적용 대상이 아닙니다.",
    "이 문서는 확인 시점의 검토 기록입니다. 실제 반영 직전에 에디터에서 다시 검사하세요.",
    "후보 폴더 전체나 reference/를 게임 폴더에 덮어쓰지 마세요.",
    "실제 게임 반영·백업·복구·Maker 실행 확인은 별도로 진행합니다.");
  return lines.join("\n") + "\n";
}

export type GameCandidateSummary = GameCandidateReview["summary"];
export interface GameCandidateHistoryItem extends CandidateIdentity {
  createdAt: string;
  summary: GameCandidateSummary;
  applyFileCount: number;
  referenceFiles: number;
  sameBaseline: boolean;
  reviewAvailable: boolean;
}
export interface GameCandidateHistory {
  mapName: string;
  baselineId: string;
  candidates: GameCandidateHistoryItem[];
  skipped: number;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const safeCount = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const summaryCounts = ["groundChangedCells", "groundRepackedCells", "objectsMoved", "objectsAdded", "objectsRemoved", "walkChangedCells"] as const;

export function validateCandidateIdentity(identity: CandidateIdentity): void {
  if (!identity || !uuid.test(identity.candidateId) || !uuid.test(identity.baselineId) ||
    typeof identity.mapName !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(identity.mapName)) {
    throw new Error("후보 식별 정보가 올바르지 않습니다. 후보 기록을 다시 읽어 주세요.");
  }
}
export function validateCandidateHistory(history: GameCandidateHistory, expected: Pick<CandidateIdentity, "mapName" | "baselineId">): void {
  const invalid = () => { throw new Error("현재 맵과 후보 기록이 일치하지 않습니다. 기록을 다시 읽어 주세요."); };
  if (!history || history.mapName !== expected.mapName || history.baselineId !== expected.baselineId ||
    !uuid.test(history.baselineId) || !Array.isArray(history.candidates) || history.candidates.length > 100 ||
    !safeCount(history.skipped)) invalid();
  const ids = new Set<string>();
  let previousTime = Infinity;
  for (const item of history.candidates) {
    validateCandidateIdentity(item);
    const time = Date.parse(item.createdAt);
    if (item.mapName !== expected.mapName || ids.has(item.candidateId) || !Number.isFinite(time) ||
      time > previousTime || typeof item.sameBaseline !== "boolean" ||
      item.sameBaseline !== (item.baselineId === expected.baselineId) || typeof item.reviewAvailable !== "boolean" ||
      !safeCount(item.applyFileCount) || !safeCount(item.referenceFiles) || !item.summary ||
      summaryCounts.some(key => !safeCount(item.summary[key])) ||
      optionalSummaryCounts.some(key => item.summary[key] !== undefined && !safeCount(item.summary[key]))) invalid();
    ids.add(item.candidateId); previousTime = time;
  }
}
export function candidateZipFilename(identity: CandidateIdentity): string {
  validateCandidateIdentity(identity);
  return identity.mapName + "-" + identity.candidateId + ".zip";
}
/** The attachment must describe the exact requested candidate, not a server-provided arbitrary path. */
export function validateCandidateZipHeaders(
  identity: CandidateIdentity, contentType: string | null, disposition: string | null,
): string {
  const expected = candidateZipFilename(identity);
  const filename = disposition?.match(/(?:^|;)\s*filename="([^"]+)"(?:;|$)/i)?.[1];
  if (contentType?.split(";")[0].trim().toLowerCase() !== "application/zip" ||
    !/^attachment\s*(?:;|$)/i.test(disposition ?? "") || filename !== expected) {
    throw new Error("요청한 후보의 ZIP 응답을 확인하지 못했습니다. 다시 검사해 주세요.");
  }
  return expected;
}
