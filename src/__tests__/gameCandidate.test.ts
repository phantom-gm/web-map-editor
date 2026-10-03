import { describe, expect, it } from "vitest";
import {
  formatCandidateReview, formatCandidateNpcSummary, formatCandidateRuntimeSummary, validateCandidateReview, validateCandidateHistory, validateCandidateIdentity, candidateZipFilename, validateCandidateZipHeaders,
  type CandidateIdentity, type GameCandidateReview, type GameCandidateHistory,
} from "../lib/gameCandidate";

const identity: CandidateIdentity = {
  candidateId: "11111111-2222-4333-8444-555555555555",
  mapName: "ferendel",
  baselineId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
};
const originalHash = "a".repeat(64), candidateHash = "b".repeat(64);
function receipt(): GameCandidateReview {
  return {
    ...identity, candidateDir: "D:/web-map-editor/.game-sync/candidates/ferendel-" + identity.candidateId,
    createdAt: "2026-10-03T00:00:00.000Z", checkedAt: "2026-10-03T00:01:00.000Z",
    status: "ready",
    files: [
      { path: "map/ferendel.map", bytes: 12345, sourceSha256: originalHash, candidateSha256: candidateHash,
        currentSourceSha256: originalHash, currentCandidateSha256: candidateHash, sourceMatches: true, candidateMatches: true },
      { path: "RootDesk/MyDesk/DataSet/DT_Walk.csv", bytes: 2345, sourceSha256: "c".repeat(64), candidateSha256: "d".repeat(64),
        currentSourceSha256: "c".repeat(64), currentCandidateSha256: "d".repeat(64), sourceMatches: true, candidateMatches: true },
    ],
    referenceFiles: 42,
    checks: [{ label: "출력 파일 무결성", passed: true }, { label: "현재 원본 일치", passed: true, detail: "생성 기준 원본과 일치" }],
    issues: [],
    summary: { groundChangedCells: 1, groundRepackedCells: 15, objectsMoved: 2, objectsAdded: 3, objectsRemoved: 4,
      walkChangedCells: 5, blockedAdded: 2, blockedRemoved: 3 },
    gameApplied: false, runtimeVerified: false,
  };
}
function blockedReceipt(): GameCandidateReview {
  const current = receipt();
  current.status = "blocked"; current.checkedAt = "2026-10-03T00:02:00.000Z";
  current.files[0].currentSourceSha256 = "e".repeat(64); current.files[0].sourceMatches = false;
  current.files[1].currentCandidateSha256 = null; current.files[1].candidateMatches = false;
  current.checks[1] = { label: "현재 원본 일치", passed: false, detail: "생성 후 게임 원본이 변경됨" };
  current.issues = ["현재 게임 원본이 변경되었습니다.", "후보 DT_Walk.csv가 없습니다."];
  return current;
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}

describe("candidate review identity and honest status", () => {
  it("accepts an immutable ready receipt without modifying it or upgrading it to game/runtime success", () => {
    const review = freezeDeep(receipt()), before = JSON.stringify(review);
    expect(() => validateCandidateReview(review, identity)).not.toThrow();
    expect(JSON.stringify(review)).toBe(before);
    expect(review.gameApplied).toBe(false); expect(review.runtimeVerified).toBe(false);
  });
  it.each(["candidateId", "mapName", "baselineId"] as const)("rejects a late receipt for another %s", key => {
    const review = receipt();
    const expected = { ...identity, [key]: key === "mapName" ? "velos" : "99999999-8888-4777-8666-555555555555" };
    expect(() => validateCandidateReview(review, expected)).toThrow("일치하지");
  });
  it.each([
    ["no apply files", (r: GameCandidateReview) => { r.files = []; }],
    ["no checks", (r: GameCandidateReview) => { r.checks = []; }],
    ["reported issue", (r: GameCandidateReview) => { r.issues = ["원본 변경"]; }],
    ["failed check", (r: GameCandidateReview) => { r.checks[0].passed = false; }],
    ["changed source flag", (r: GameCandidateReview) => { r.files[0].sourceMatches = false; }],
    ["changed candidate flag", (r: GameCandidateReview) => { r.files[0].candidateMatches = false; }],
    ["changed source hash", (r: GameCandidateReview) => { r.files[0].currentSourceSha256 = "e".repeat(64); }],
    ["missing candidate hash", (r: GameCandidateReview) => { r.files[0].currentCandidateSha256 = null; }],
  ] as const)("rejects contradictory ready status: %s", (_label, mutate) => {
    const review = receipt(); mutate(review);
    expect(() => validateCandidateReview(review, identity)).toThrow("서로 맞지");
  });
  it("allows blocked diagnostics, including changed originals and missing candidate files", () => {
    const review = blockedReceipt();
    expect(() => validateCandidateReview(review, identity)).not.toThrow();
    expect(formatCandidateReview(review)).toContain("검토 결과: 다시 확인 필요");
  });
  it("allows an empty file list when a blocked receipt explains why it cannot identify apply files", () => {
    const review = blockedReceipt(); review.files = [];
    review.issues = ["후보 파일 목록을 확인할 수 없습니다."];
    expect(() => validateCandidateReview(review, identity)).not.toThrow();
    expect(formatCandidateReview(review)).toContain("후보 파일 목록을 확인할 수 없습니다.");
  });
  it.each(["gameApplied", "runtimeVerified"] as const)("rejects an unsupported %s success claim", key => {
    const review = { ...receipt(), [key]: true } as unknown as GameCandidateReview;
    expect(() => validateCandidateReview(review, identity)).toThrow("일치하지");
  });
});

describe("candidate receipt field validation", () => {
  it.each([
    "reference/RootDesk/MyDesk/DataSet/DT_Walk.csv", "../map/ferendel.map",
    "/map/ferendel.map", "C:/game/map/ferendel.map", "map\\ferendel.map",
    "map/./ferendel.map", "map//ferendel.map",
  ])("rejects a non-apply or non-normalized relative path: %s", path => {
    const review = receipt(); review.files[0].path = path;
    expect(() => validateCandidateReview(review, identity)).toThrow("형식");
  });
  it("rejects duplicate file records", () => {
    const review = receipt(); review.files.push({ ...review.files[0] });
    expect(() => validateCandidateReview(review, identity)).toThrow("형식");
  });
  it.each(["", "a".repeat(63), "z".repeat(64)])("rejects invalid SHA-256 values", hash => {
    const review = receipt(); review.files[0].sourceSha256 = hash;
    review.files[0].currentSourceSha256 = hash;
    expect(() => validateCandidateReview(review, identity)).toThrow("형식");
  });
  it.each([-1, 1.5, NaN, Infinity])("rejects invalid byte counts %s", bytes => {
    const review = receipt(); review.files[0].bytes = bytes;
    expect(() => validateCandidateReview(review, identity)).toThrow("형식");
  });
  it("rejects malformed summary/check counts and a missing review time", () => {
    const summary = receipt(); summary.summary.groundRepackedCells = -1;
    expect(() => validateCandidateReview(summary, identity)).toThrow("형식");
    const reference = receipt(); reference.referenceFiles = 0.5;
    expect(() => validateCandidateReview(reference, identity)).toThrow("형식");
    const time = receipt(); time.checkedAt = "";
    expect(() => validateCandidateReview(time, identity)).toThrow("일치하지");
    const check = receipt(); check.checks[0].passed = "yes" as unknown as boolean;
    expect(() => validateCandidateReview(check, identity)).toThrow("형식");
  });
});

describe("read-only text review summary", () => {
  it("lists only apply files with their hashes and clearly excludes reference copies", () => {
    const review = receipt(), text = formatCandidateReview(review);
    const fileSection = text.split("적용 대상 파일 (참고 사본 제외)\n")[1].split("\n검사 항목")[0];
    for (const file of review.files) {
      expect(fileSection).toContain(file.path + " (" + file.bytes + " bytes)");
      expect(fileSection).toContain("예상 원본 SHA-256: " + file.sourceSha256);
      expect(fileSection).toContain("현재 원본 SHA-256: " + file.currentSourceSha256);
      expect(fileSection).toContain("생성 후보 SHA-256: " + file.candidateSha256);
      expect(fileSection).toContain("현재 후보 SHA-256: " + file.currentCandidateSha256);
    }
    expect(fileSection).not.toContain("reference/");
    expect(fileSection).not.toContain("report.json"); expect(fileSection).not.toContain("editor-project.json");
    expect(text).toContain("참고 사본: reference/ 아래 42개 파일은 적용 대상이 아닙니다.");
    expect(text).toContain("검토 결과: 파일 검토 통과");
    expect(text).toContain("게임 적용: 안 함 / Maker 실행 검증: 안 함");
    expect(text).toContain("실제 반영 직전에 에디터에서 다시 검사하세요.");
  });
  it("distinguishes the latest blocked check from an earlier successful receipt for the same candidate", () => {
    const earlier = receipt(), latest = blockedReceipt();
    expect(() => validateCandidateReview(earlier, identity)).not.toThrow();
    expect(() => validateCandidateReview(latest, identity)).not.toThrow();
    const oldText = formatCandidateReview(earlier), newText = formatCandidateReview(latest);
    expect(oldText).toContain("검토 결과: 파일 검토 통과");
    expect(newText).toContain("검토 결과: 다시 확인 필요");
    expect(newText).not.toContain("검토 결과: 파일 검토 통과");
    expect(newText).toContain("확인 시각: " + latest.checkedAt);
    expect(newText).not.toContain("확인 시각: " + earlier.checkedAt);
    expect(newText).toContain("현재 원본 SHA-256: " + "e".repeat(64));
    expect(newText).toContain("현재 후보 SHA-256: 없음");
    expect(newText).toContain("생성 후 게임 원본이 변경됨");
    for (const issue of latest.issues) expect(newText).toContain("- " + issue);
  });
  it("preserves direct/repacked ground counts and all native object and walk edit counts", () => {
    const text = formatCandidateReview(receipt());
    expect(text).toContain("바닥 직접 수정 1칸 / 주변 재구성 15칸");
    expect(text).toContain("오브젝트 이동 2 / 추가 3 / 삭제 4");
    expect(text).toContain("이동불가 변경 5칸");
    expect(text).toContain("후보 ID: " + identity.candidateId);
    expect(text).toContain("만든 시각: 2026-10-03T00:00:00.000Z");
    expect(text.endsWith("\n")).toBe(true);
  });
});

const olderIdentity: CandidateIdentity = {
  candidateId: "99999999-8888-4777-8666-555555555555", mapName: identity.mapName,
  baselineId: "12345678-1234-4234-8234-123456789abc",
};
function historyReceipt(): GameCandidateHistory {
  const current = receipt();
  return {
    mapName: identity.mapName, baselineId: identity.baselineId, skipped: 2,
    candidates: [
      { ...identity, createdAt: current.createdAt, summary: { ...current.summary },
        applyFileCount: 2, referenceFiles: 42, sameBaseline: true, reviewAvailable: true },
      { ...olderIdentity, createdAt: "2026-10-02T00:00:00.000Z", summary: { ...current.summary },
        applyFileCount: 1, referenceFiles: 41, sameBaseline: false, reviewAvailable: false },
    ],
  };
}
describe("candidate history is a snapshot inventory, not a ready receipt", () => {
  it("accepts current/older baseline records and preserves an unavailable legacy record without declaring readiness", () => {
    const history = freezeDeep(historyReceipt()), before = JSON.stringify(history);
    expect(() => validateCandidateHistory(history, identity)).not.toThrow();
    expect(history.candidates[1].reviewAvailable).toBe(false);
    for (const item of history.candidates) expect(item).not.toHaveProperty("status");
    expect(JSON.stringify(history)).toBe(before);
  });
  it("accepts an empty history and never requires a current freshly baked candidate", () => {
    const history = historyReceipt(); history.candidates = [];
    expect(() => validateCandidateHistory(history, identity)).not.toThrow();
  });
  it.each(["mapName", "baselineId"] as const)("rejects history arriving for a previous %s", key => {
    const history = historyReceipt();
    expect(() => validateCandidateHistory(history, { ...identity, [key]: key === "mapName" ? "velos" : olderIdentity.baselineId })).toThrow("일치하지");
  });
  it.each([
    ["record map", (h: GameCandidateHistory) => { h.candidates[0].mapName = "velos"; }],
    ["baseline flag", (h: GameCandidateHistory) => { h.candidates[1].sameBaseline = true; }],
    ["duplicate candidate", (h: GameCandidateHistory) => { h.candidates[1].candidateId = identity.candidateId; }],
    ["oldest first", (h: GameCandidateHistory) => { h.candidates.reverse(); }],
    ["invalid date", (h: GameCandidateHistory) => { h.candidates[0].createdAt = "yesterday"; }],
    ["negative skipped", (h: GameCandidateHistory) => { h.skipped = -1; }],
    ["negative summary", (h: GameCandidateHistory) => { h.candidates[0].summary.objectsAdded = -1; }],
    ["fractional apply count", (h: GameCandidateHistory) => { h.candidates[0].applyFileCount = 1.5; }],
    ["invalid reference count", (h: GameCandidateHistory) => { h.candidates[0].referenceFiles = NaN; }],
    ["invalid availability", (h: GameCandidateHistory) => { h.candidates[0].reviewAvailable = "ready" as unknown as boolean; }],
  ] as const)("rejects invalid history: %s", (_label, mutate) => {
    const history = historyReceipt(); mutate(history);
    expect(() => validateCandidateHistory(history, identity)).toThrow();
  });
  it("accepts the bounded latest 100 records but rejects a larger response", () => {
    const history = historyReceipt(), sample = history.candidates[0];
    history.candidates = Array.from({ length: 100 }, (_item, index) => ({
      ...sample, candidateId: "11111111-2222-4333-8444-" + String(index).padStart(12, "0"),
    }));
    expect(() => validateCandidateHistory(history, identity)).not.toThrow();
    history.candidates.push({ ...sample, candidateId: "11111111-2222-4333-8444-999999999999" });
    expect(() => validateCandidateHistory(history, identity)).toThrow();
  });
  it("keeps the older record baseline when requesting fresh review instead of substituting the current editor baseline", () => {
    const review = { ...receipt(), ...olderIdentity };
    expect(() => validateCandidateReview(review, olderIdentity)).not.toThrow();
    expect(() => validateCandidateReview(review, identity)).toThrow("일치하지");
  });
  it("preserves missing-baseline rebake guidance when a blocked result has no creation timestamp", () => {
    const blocked = blockedReceipt();
    blocked.createdAt = ""; blocked.files = [];
    blocked.issues = ["기준 스냅샷이 없습니다. 게임 원본을 다시 가져온 뒤 후보 맵을 다시 구워 주세요."];
    expect(() => validateCandidateReview(blocked, identity)).not.toThrow();
    const text = formatCandidateReview(blocked);
    expect(text).toContain(blocked.issues[0]); expect(text).toContain("만든 시각: 확인 불가");
    const ready = receipt(); ready.createdAt = "";
    expect(() => validateCandidateReview(ready, identity)).toThrow();
  });
});

describe("ZIP filenames and transport identity", () => {
  it("derives a filename only from validated map/UUID identity and accepts the exact attachment response", () => {
    const name = identity.mapName + "-" + identity.candidateId + ".zip";
    expect(candidateZipFilename(identity)).toBe(name);
    expect(validateCandidateZipHeaders(identity, "application/zip", 'attachment; filename="' + name + '"')).toBe(name);
    expect(validateCandidateZipHeaders(identity, "application/zip; charset=binary", 'attachment; filename="' + name + '"')).toBe(name);
  });
  it.each([
    { ...identity, candidateId: "ferendel-" + identity.candidateId },
    { ...identity, candidateId: "../" + identity.candidateId },
    { ...identity, baselineId: "not-a-uuid" },
    { ...identity, mapName: "../ferendel" },
    { ...identity, mapName: "ferendel/map" },
    { ...identity, mapName: "C:ferendel" },
  ])("rejects an unsafe or folder-based identity before naming a ZIP", unsafe => {
    expect(() => validateCandidateIdentity(unsafe)).toThrow("식별");
    expect(() => candidateZipFilename(unsafe)).toThrow("식별");
  });
  it.each([
    ["application/json", 'attachment; filename="' + identity.mapName + "-" + identity.candidateId + '.zip"'],
    ["application/zip", 'attachment; filename="velos-' + identity.candidateId + '.zip"'],
    ["application/zip", 'attachment; filename="ferendel-' + olderIdentity.candidateId + '.zip"'],
    ["application/zip", 'attachment; filename="../ferendel-' + identity.candidateId + '.zip"'],
    ["application/zip", 'inline; filename="ferendel-' + identity.candidateId + '.zip"'],
    ["application/zip", null],
    [null, null],
  ])("rejects non-ZIP, stale identity or unsafe attachment metadata", (contentType, disposition) => {
    expect(() => validateCandidateZipHeaders(identity, contentType, disposition)).toThrow("ZIP 응답");
  });
  it("does not turn a blocked ZIP response into success merely because it identifies the correct candidate", () => {
    const review = blockedReceipt();
    expect(() => validateCandidateReview(review, identity)).not.toThrow();
    expect(review.status).toBe("blocked");
    expect(() => validateCandidateZipHeaders(identity, "application/json", null)).toThrow();
    expect(formatCandidateReview(review)).toContain("검토 결과: 다시 확인 필요");
  });
});


describe("optional NPC candidate counts", () => {
  const npcCounts = { npcsMoved: 1, npcsAdded: 2, npcsRemoved: 3, npcsUpdated: 4 };
  it("preserves legacy review/history without inventing zero NPC counts", () => {
    const review = freezeDeep(receipt()), history = freezeDeep(historyReceipt());
    expect(() => validateCandidateReview(review, identity)).not.toThrow();
    expect(() => validateCandidateHistory(history, identity)).not.toThrow();
    expect(formatCandidateNpcSummary(review.summary)).toBeNull();
    expect(formatCandidateReview(review)).not.toContain("NPC ");
  });
  it("shows distinct NPC movement, addition, removal and flip/dialog counts in history and saved review text", () => {
    const review = receipt(), history = historyReceipt();
    Object.assign(review.summary, npcCounts); Object.assign(history.candidates[0].summary, npcCounts);
    const before = JSON.stringify({ review, history });
    expect(() => validateCandidateReview(review, identity)).not.toThrow();
    expect(() => validateCandidateHistory(history, identity)).not.toThrow();
    expect(formatCandidateNpcSummary(review.summary)).toBe("이동 1 / 추가 2 / 삭제 3 / 반전·대사 4");
    expect(formatCandidateReview(review)).toContain("NPC 이동 1 / 추가 2 / 삭제 3 / 반전·대사 4");
    expect(formatCandidateNpcSummary(history.candidates[0].summary)).toBe(formatCandidateNpcSummary(review.summary));
    expect(JSON.stringify({ review, history })).toBe(before);
  });
  it("keeps a newer all-zero NPC summary distinct from a legacy missing summary", () => {
    const review = receipt(); Object.assign(review.summary, { npcsMoved: 0, npcsAdded: 0, npcsRemoved: 0, npcsUpdated: 0 });
    expect(formatCandidateNpcSummary(review.summary)).toBe("이동 0 / 추가 0 / 삭제 0 / 반전·대사 0");
    expect(() => validateCandidateReview(review, identity)).not.toThrow();
  });
  it.each(["npcsMoved", "npcsAdded", "npcsRemoved", "npcsUpdated"] as const)("validates optional %s for both review and history", key => {
    for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2", null]) {
      const review = receipt(), history = historyReceipt();
      Object.assign(review.summary, { [key]: invalid }); Object.assign(history.candidates[0].summary, { [key]: invalid });
      expect(() => validateCandidateReview(review, identity)).toThrow("형식");
      expect(() => validateCandidateHistory(history, identity)).toThrow();
    }
  });
});

describe("optional runtime candidate counts", () => {
  it("retains older receipts without inventing counts and includes new edits in text", () => {
    const old=receipt();
    expect(formatCandidateRuntimeSummary(old.summary)).toEqual([]);
    const review=receipt();Object.assign(review.summary,{monstersMoved:1,monstersUpdated:2,portalsAdded:3,spawnChanged:1});
    expect(()=>validateCandidateReview(review,identity)).not.toThrow();
    const text=formatCandidateReview(review);
    expect(text).toContain("몬스터 출현 이동 1 / 추가 0 / 삭제 0 / 설정 2");
    expect(text).toContain("포털 이동 0 / 추가 3 / 삭제 0 / 설정 0");
    expect(text).toContain("시작 위치 이동 1");
  });
  it("rejects impossible singleton counts in both review and history", () => {
    const review=receipt(),history=historyReceipt();review.summary.spawnChanged=2;history.candidates[0].summary.spawnChanged=2;
    expect(()=>validateCandidateReview(review,identity)).toThrow();
    expect(()=>validateCandidateHistory(history,identity)).toThrow();
  });
});
