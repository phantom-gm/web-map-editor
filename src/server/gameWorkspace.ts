import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isProjectFile, parseGameSync, type ProjectFile } from "../lib/projectIO";

export class WorkspaceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export interface WorkspaceOptions {
  gameRoot: string;
  workspaceRoot: string;
  validateStorageRoot: (target: string, gameRoot: string) => string;
}
export interface WorkspaceInfo { revision: string; savedAt: string }
export interface SavedWorkspace extends WorkspaceInfo { project: ProjectFile }

function mapKey(mapName: string): string {
  if (typeof mapName !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(mapName)) throw new WorkspaceError("맵 이름이 올바르지 않습니다.");
  return mapName;
}
function guarded(options: WorkspaceOptions, ...parts: string[]): string {
  const root = options.validateStorageRoot(options.workspaceRoot, options.gameRoot);
  // Managed draft/history paths must never alias another map or history entry.
  for (const checked of [path.resolve(options.workspaceRoot), ...parts.map((_, i) => path.join(root, ...parts.slice(0, i + 1)))]) {
    if (fs.lstatSync(checked, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new WorkspaceError("작업 저장 경로에는 심볼릭 링크나 정션을 사용할 수 없습니다.");
    }
  }
  const target = options.validateStorageRoot(path.join(root, ...parts), options.gameRoot);
  const relative = path.relative(root, target);
  if (relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) {
    throw new WorkspaceError("작업 파일은 에디터 작업 폴더 안에 저장해야 합니다.");
  }
  return target;
}
function digest(text: string): string { return createHash("sha256").update(text).digest("hex"); }
function validateProject(input: unknown): ProjectFile {
  if (!isProjectFile(input) || input.version !== 2 || !Array.isArray(input.ground) ||
      !Array.isArray(input.blocked) || !Array.isArray(input.palette) || !Array.isArray(input.entities) ||
      !Array.isArray(input.size) || input.size.length !== 2 ||
      !input.size.every(n => Number.isInteger(n) && n > 0) ||
      !Array.isArray(input.groundOrigin) || input.groundOrigin.length !== 2 ||
      !input.groundOrigin.every(Number.isFinite) ||
      !input.palette.every(t => t && typeof t === "object" && !Array.isArray(t)) ||
      !input.entities.every(e => e && typeof e === "object" && !Array.isArray(e)) ||
      !input.ground.every(c => Array.isArray(c) && c.length === 3 && c.every(Number.isInteger) &&
        c[0] >= 0 && c[1] >= 0 && c[0] < input.size[0] && c[1] < input.size[1] && c[2] >= 0 && c[2] < input.palette.length) ||
      !input.blocked.every(c => Array.isArray(c) && c.length === 2 && c.every(Number.isInteger))) {
    throw new WorkspaceError("저장할 맵 프로젝트 형식이 올바르지 않습니다.");
  }
  mapKey(input.map);
  try {
    if (!parseGameSync(input.gameSync, input.map)) throw new WorkspaceError("게임에 연결된 맵만 작업 저장을 사용할 수 있습니다.");
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError(error instanceof Error ? error.message : "게임 동기화 정보 형식이 올바르지 않습니다.");
  }
  return input as ProjectFile;
}
export function readWorkspace(mapName: string, options: WorkspaceOptions): SavedWorkspace | null {
  const file = guarded(options, mapKey(mapName), "project.json");
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const project = validateProject(JSON.parse(text));
  if (project.map !== mapName) throw new WorkspaceError("저장된 맵 이름이 작업 폴더와 다릅니다.");
  return { project, revision: digest(text), savedAt: fs.statSync(file).mtime.toISOString() };
}

/** Save only editor-owned drafts. Game freshness is checked by preview/bake, never by draft saving. */
export function saveWorkspace(input: unknown, expectedRevision: string | null, options: WorkspaceOptions): SavedWorkspace {
  const project = validateProject(input);
  if (expectedRevision !== null && (typeof expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(expectedRevision))) {
    throw new WorkspaceError("저장 버전이 올바르지 않습니다.");
  }
  const file = guarded(options, project.map, "project.json");
  const previous = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const text = JSON.stringify(project, null, 2) + "\n";
  // Idempotent retry after a lost response is safe even with the previous revision.
  if (previous === text) return { project, revision: digest(text), savedAt: fs.statSync(file).mtime.toISOString() };
  if ((previous === null ? null : digest(previous)) !== expectedRevision) {
    throw new WorkspaceError("다른 창에 저장된 작업이 있습니다. 파일 사본을 저장한 뒤 맵을 다시 열어 주세요.", 409);
  }
  fs.mkdirSync(guarded(options, project.map), { recursive: true });
  if (previous !== null) {
    const history = guarded(options, project.map, "history");
    fs.mkdirSync(history, { recursive: true });
    const backup = guarded(options, project.map, "history", digest(previous) + ".json");
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, previous, { encoding: "utf8", flag: "wx" });
    else if (fs.readFileSync(backup, "utf8") !== previous) throw new WorkspaceError("작업 이력 파일이 변경되었습니다. 기존 이력을 확인해 주세요.", 409);
  }
  const temporary = guarded(options, project.map, randomUUID() + ".tmp");
  try {
    fs.writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
    // Recheck after history/temp writes so an intervening external save is not overwritten.
    const destination = guarded(options, project.map, "project.json");
    const current = fs.existsSync(destination) ? fs.readFileSync(destination, "utf8") : null;
    if (current !== previous) throw new WorkspaceError("저장하는 동안 다른 작업이 저장되었습니다. 맵을 다시 열어 주세요.", 409);
    // Same-directory rename keeps a partially written draft from replacing the last saved one.
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { project, revision: digest(text), savedAt: fs.statSync(file).mtime.toISOString() };
}
