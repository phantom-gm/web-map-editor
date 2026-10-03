import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ProjectFile } from "../lib/projectIO";
import { readWorkspace, saveWorkspace } from "./gameWorkspace";

export class GameSyncError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// Local filesystem access is deliberately unavailable from a deployed editor.
export function assertLocalGameSyncRequest(req: Request): void {
  const url = new URL(req.url);
  const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const host = req.headers.get("host");
  if (!local.has(url.hostname) || !host || !local.has(new URL("http://" + host).hostname)) {
    throw new GameSyncError("게임 동기화는 이 PC의 로컬 에디터에서만 사용할 수 있습니다.", 403);
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(url.protocol + "//" + host).origin) throw new GameSyncError("같은 에디터 화면에서 요청해 주세요.", 403);
  if (process.env.VERCEL || !process.env.MSW_GAME_ROOT) {
    throw new GameSyncError("로컬 MSW_GAME_ROOT 설정이 필요합니다.", 403);
  }
}

export function gameSyncPaths() {
  const gameRoot = path.resolve(process.env.MSW_GAME_ROOT!);
  return {
    gameRoot,
    baselineRoot: path.join(process.cwd(), ".game-sync", "baselines"),
    outputRoot: path.join(process.cwd(), ".game-sync", "candidates"),
    workspaceRoot: path.join(process.cwd(), ".game-sync", "workspaces"),
  };
}

type SyncReport = Record<string, unknown>;
interface SyncCore {
  validateStorageRoot(target: string, gameRoot: string): string;
  previewEditedProject(project: ProjectFile, options: ReturnType<typeof gameSyncPaths>): unknown;
  previewBaselineProject(input: { mapName: string; baselineId: string }, options: ReturnType<typeof gameSyncPaths>): unknown;
  compareEditedProject(project: ProjectFile, options: ReturnType<typeof gameSyncPaths>): unknown;
  reviewCandidate(input: { candidateId: string; mapName: string; baselineId: string }, options: ReturnType<typeof gameSyncPaths>): unknown;
  listCandidates(input: { mapName: string; baselineId: string }, options: ReturnType<typeof gameSyncPaths>): unknown;
  packageCandidate(input: { candidateId: string; mapName: string; baselineId: string }, options: ReturnType<typeof gameSyncPaths>): { filename: string; bytes: Buffer; review: unknown };
  createSyncProject(options: { gameRoot: string; mapName: string; baselineRoot: string }): { project: ProjectFile; report: SyncReport };
  exportEditedProject(project: ProjectFile, options: ReturnType<typeof gameSyncPaths>): {
    candidateId: string; candidateDir: string; mapPath: string; reportPath: string; report: SyncReport;
  };
}

async function core(): Promise<SyncCore> {
  // Keep the local CJS compiler outside the browser/Next bundle. It uses the
  // installed MapBuilder and explicit filesystem paths at request time only.
  const modulePath = path.join(process.cwd(), "scripts", "game-sync", "core.cjs");
  const loaded = await import(/* webpackIgnore: true */ pathToFileURL(modulePath).href);
  return loaded.default as SyncCore;
}

export function listGameMaps(): string[] {
  const { gameRoot } = gameSyncPaths();
  const entries = fs.readdirSync(path.join(gameRoot, "map"), { withFileTypes: true });
  const files = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  return [...files].filter((name) => /^[\w-]+\.map$/.test(name) && files.has(name.slice(0, -4) + ".json"))
    .map((name) => name.slice(0, -4)).sort();
}

export async function downloadGameCandidate(body: unknown): Promise<{ filename: string; bytes: Buffer; review: unknown }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new GameSyncError("후보 ID 정보가 필요합니다.");
  const input = body as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (keys.join(",") !== "baselineId,candidateId,mapName" || typeof input.mapName !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(input.mapName) ||
    typeof input.candidateId !== "string" || !uuid.test(input.candidateId) || typeof input.baselineId !== "string" || !uuid.test(input.baselineId)) {
    throw new GameSyncError("다운로드 요청에는 올바른 후보·맵·기준 ID만 포함해 주세요.");
  }
  const compiler = await core();
  try {
    return compiler.packageCandidate({ candidateId: input.candidateId, mapName: input.mapName, baselineId: input.baselineId }, gameSyncPaths());
  } catch (error) {
    const blocked = new GameSyncError(error instanceof Error ? error.message : String(error), 409) as GameSyncError & { review?: unknown };
    if (error && typeof error === "object" && "review" in error) blocked.review = error.review;
    throw blocked;
  }
}

export async function runGameSync(body: unknown) {
  if (!body || typeof body !== "object") throw new GameSyncError("요청 형식을 확인해 주세요.");
  const input = body as { action?: unknown; mapName?: unknown; baselineId?: unknown; candidateId?: unknown; project?: unknown; expectedRevision?: unknown };
  const paths = gameSyncPaths();
  const compiler = await core();
  const workspace = { ...paths, validateStorageRoot: compiler.validateStorageRoot };
  if (input.action === "open" || input.action === "import") {
    if (typeof input.mapName !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.mapName)) throw new GameSyncError("맵 이름이 올바르지 않습니다.");
    const saved = readWorkspace(input.mapName, workspace);
    if (input.action === "open" && saved) return { action: "open", resumed: true, ...saved };
    // Fresh import replaces a draft only when the caller holds its current revision.
    if (input.action === "import" && (input.expectedRevision ?? null) !== (saved?.revision ?? null)) {
      throw new GameSyncError("이 맵에 저장된 작업이 있습니다. 맵을 먼저 열어 확인한 후 원본을 다시 가져와 주세요.", 409);
    }
    const imported = compiler.createSyncProject({ ...paths, mapName: input.mapName });
    const written = saveWorkspace(imported.project, saved?.revision ?? null, workspace);
    return { action: input.action, resumed: false, ...imported, ...written };
  }
  if (input.action === "save") {
    const saved = saveWorkspace(input.project, (input.expectedRevision ?? null) as string | null, workspace);
    return { action: "save", revision: saved.revision, savedAt: saved.savedAt };
  }
  if (input.action === "list-candidates") {
    if (typeof input.mapName !== "string" || typeof input.baselineId !== "string") throw new GameSyncError("맵과 동기화 기준 정보가 필요합니다.");
    return { history: compiler.listCandidates({ mapName: input.mapName, baselineId: input.baselineId }, paths) };
  }
  if (input.action === "review-candidate") {
    if (typeof input.candidateId !== "string" || typeof input.mapName !== "string" || typeof input.baselineId !== "string") {
      throw new GameSyncError("후보와 맵의 기준 정보가 필요합니다.");
    }
    return { review: compiler.reviewCandidate({ candidateId: input.candidateId, mapName: input.mapName, baselineId: input.baselineId }, paths) };
  }
  if (input.action === "baseline-preview") {
    if (typeof input.mapName !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(input.mapName) ||
      typeof input.baselineId !== "string" || !/^[a-f0-9-]{36}$/.test(input.baselineId)) {
      throw new GameSyncError("게임 동기화 기준 정보가 올바르지 않습니다.");
    }
    return { baseline: compiler.previewBaselineProject({ mapName: input.mapName, baselineId: input.baselineId }, paths) };
  }
  if (input.action === "preview" || input.action === "compare" || input.action === "export") {
    if (!input.project || typeof input.project !== "object") throw new GameSyncError("프로젝트가 필요합니다.");
    if (input.action === "preview") return { scene: compiler.previewEditedProject(input.project as ProjectFile, paths) };
    if (input.action === "compare") return compiler.compareEditedProject(input.project as ProjectFile, paths);
    return { action: "export", ...compiler.exportEditedProject(input.project as ProjectFile, paths) };
  }
  throw new GameSyncError("지원하지 않는 작업입니다.");
}