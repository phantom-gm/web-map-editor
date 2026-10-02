import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readWorkspace, saveWorkspace, WorkspaceError, type WorkspaceOptions } from "../server/gameWorkspace";
import type { ProjectFile } from "../lib/projectIO";

const { validateStorageRoot } = createRequire(import.meta.url)("../../scripts/game-sync/core.cjs") as {
  validateStorageRoot(target: string, gameRoot: string): string;
};
const tempParent = fs.realpathSync(os.tmpdir());
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== tempParent || !path.basename(root).startsWith("web-map-workspace-test-")) throw new Error("Unsafe test cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const temp = fs.mkdtempSync(path.join(tempParent, "web-map-workspace-test-")); roots.push(temp);
  const gameRoot = path.join(temp, "game"), workspaceRoot = path.join(temp, "workspaces");
  fs.mkdirSync(path.join(gameRoot, "map"), { recursive: true });
  fs.writeFileSync(path.join(gameRoot, "map", "fixture.map"), "game source stays read-only");
  const options: WorkspaceOptions = { gameRoot, workspaceRoot, validateStorageRoot };
  return { temp, options, file: path.join(workspaceRoot, "fixture", "project.json") };
}
function project(): ProjectFile {
  const layer = () => ({ size: [0, 0] as [number, number], origin: [0, 0] as [number, number], paletteCount: 0, palette: [], cellCount: 0, cells: [] });
  return {
    type: "web-map-editor-project", version: 2, map: "fixture",
    gameSync: { version: 1, baselineId: "baseline-fixture", mapName: "fixture" },
    size: [2, 2], groundOrigin: [0, 0], ground: [[0, 0, 0]], blocked: [], entities: [],
    palette: [{ name: "ground", ruid: "known-ruid", px: [256, 128] }],
    staticLayer: layer(), attributeBase: layer(),
  };
}
const bytes = (p: ProjectFile) => JSON.stringify(p, null, 2) + "\n";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const junction = (target: string, link: string) => fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");

describe("editor-owned game workspace", () => {
  it("saves and resumes the complete linked draft without touching the game", () => {
    const f = fixture(), p = project(), source = path.join(f.options.gameRoot, "map", "fixture.map");
    const before = fs.readFileSync(source);
    expect(readWorkspace("fixture", f.options)).toBeNull();
    const saved = saveWorkspace(p, null, f.options), resumed = readWorkspace("fixture", f.options);
    expect(resumed).toEqual(saved);
    expect(resumed?.project).toEqual(p);
    expect(saved.revision).toBe(sha(bytes(p)));
    expect(Number.isFinite(Date.parse(saved.savedAt))).toBe(true);
    expect(fs.readFileSync(f.file, "utf8")).toBe(bytes(p));
    expect(fs.readFileSync(source).equals(before)).toBe(true);
  });
  it("rejects a stale revision and preserves the newer saved draft", () => {
    const f = fixture(), p = project(), first = saveWorkspace(p, null, f.options);
    const next = { ...p, ground: [] };
    const saved = saveWorkspace(next, first.revision, f.options);
    expect(() => saveWorkspace({ ...p, blocked: [[1, 1]] }, first.revision, f.options)).toThrowError(expect.objectContaining({ status: 409 }));
    expect(() => saveWorkspace(p, null, f.options)).toThrowError(expect.objectContaining({ status: 409 }));
    expect(readWorkspace("fixture", f.options)).toEqual(saved);
  });
  it("treats an identical retry as success without creating extra history or changing its timestamp", () => {
    const f = fixture(), p = project(), first = saveWorkspace(p, null, f.options), next = { ...p, ground: [] };
    const saved = saveWorkspace(next, first.revision, f.options);
    expect(saveWorkspace(next, first.revision, f.options)).toEqual(saved);
    expect(saveWorkspace(next, null, f.options)).toEqual(saved);
    expect(fs.readdirSync(path.join(f.options.workspaceRoot, "fixture", "history"))).toEqual([first.revision + ".json"]);
  });
  it("preserves exact previous versions under their content hashes", () => {
    const f = fixture(), p = project(), first = saveWorkspace(p, null, f.options);
    const secondProject = { ...p, ground: [] }, second = saveWorkspace(secondProject, first.revision, f.options);
    const third = saveWorkspace({ ...p, blocked: [[1, 1]] }, second.revision, f.options);
    const history = path.join(f.options.workspaceRoot, "fixture", "history");
    expect(fs.readFileSync(path.join(history, first.revision + ".json"), "utf8")).toBe(bytes(p));
    expect(fs.readFileSync(path.join(history, second.revision + ".json"), "utf8")).toBe(bytes(secondProject));
    expect(readWorkspace("fixture", f.options)?.revision).toBe(third.revision);
  });
  it("does not overwrite a corrupted history entry", () => {
    const f = fixture(), p = project(), first = saveWorkspace(p, null, f.options);
    const history = path.join(f.options.workspaceRoot, "fixture", "history");
    fs.mkdirSync(history); fs.writeFileSync(path.join(history, first.revision + ".json"), "unexpected");
    expect(() => saveWorkspace({ ...p, ground: [] }, first.revision, f.options)).toThrowError(expect.objectContaining({ status: 409 }));
    expect(fs.readFileSync(f.file, "utf8")).toBe(bytes(p));
    expect(fs.readFileSync(path.join(history, first.revision + ".json"), "utf8")).toBe("unexpected");
  });
  it("rejects malformed drafts before creating any workspace files", () => {
    const f = fixture(), p = project();
    for (const value of [
      null, {}, { ...p, map: undefined }, { ...p, map: "../escape" }, { ...p, version: 1 },
      { ...p, size: [0, 2] }, { ...p, groundOrigin: [null, 0] }, { ...p, groundOrigin: [NaN, 0] },
      { ...p, ground: [[0, 0, 4]] }, { ...p, ground: [[0, "0", 0]] }, { ...p, ground: [[2, 0, 0]] },
      { ...p, blocked: [[0]] }, { ...p, palette: [null] }, { ...p, entities: [null] },
      { ...p, gameSync: undefined }, { ...p, gameSync: { ...p.gameSync, mapName: "other" } },
    ]) expect(() => saveWorkspace(value, null, f.options)).toThrow(WorkspaceError);
    expect(() => saveWorkspace(p, "invalid-revision", f.options)).toThrow(WorkspaceError);
    expect(fs.existsSync(f.options.workspaceRoot)).toBe(false);
  });
  it("refuses a mismatched map saved in another map folder", () => {
    const f = fixture(), p = project(); saveWorkspace(p, null, f.options);
    fs.writeFileSync(f.file, bytes({ ...p, map: "other", gameSync: { ...p.gameSync!, mapName: "other" } }));
    expect(() => readWorkspace("fixture", f.options)).toThrow("작업 폴더와 다릅니다");
  });
  it("keeps draft saving available after the game's source changes", () => {
    const f = fixture(), p = project(), first = saveWorkspace(p, null, f.options);
    const source = path.join(f.options.gameRoot, "map", "fixture.map");
    fs.writeFileSync(source, "concurrent game changes");
    const next = { ...p, ground: [] }, saved = saveWorkspace(next, first.revision, f.options);
    expect(readWorkspace("fixture", f.options)).toEqual(saved);
    expect(fs.readFileSync(source, "utf8")).toBe("concurrent game changes");
  });
  it("rejects game-owned workspace roots and ancestor roots", () => {
    const f = fixture(), p = project();
    for (const workspaceRoot of [f.options.gameRoot, path.join(f.options.gameRoot, "drafts"), f.temp]) {
      expect(() => saveWorkspace(p, null, { ...f.options, workspaceRoot })).toThrow();
    }
    expect(fs.readdirSync(f.options.gameRoot)).toEqual(["map"]);
  });
  it("rejects a workspace-root junction pointing into the game", () => {
    const f = fixture(); junction(f.options.gameRoot, f.options.workspaceRoot);
    expect(() => saveWorkspace(project(), null, f.options)).toThrow();
    expect(() => readWorkspace("fixture", f.options)).toThrow();
    expect(fs.existsSync(path.join(f.options.gameRoot, "fixture"))).toBe(false);
  });
  it("rejects map-folder junctions into the game, an outside folder or another workspace map", () => {
    for (const kind of ["game", "outside", "other-map"]) {
      const f = fixture(); fs.mkdirSync(f.options.workspaceRoot);
      const target = kind === "game" ? f.options.gameRoot : path.join(kind === "outside" ? f.temp : f.options.workspaceRoot, "other");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "sentinel.txt"), "preserved");
      junction(target, path.join(f.options.workspaceRoot, "fixture"));
      expect(() => saveWorkspace(project(), null, f.options)).toThrow();
      expect(() => readWorkspace("fixture", f.options)).toThrow();
      expect(fs.readFileSync(path.join(target, "sentinel.txt"), "utf8")).toBe("preserved");
      expect(fs.existsSync(path.join(target, "project.json"))).toBe(false);
    }
  });
  it("does not place history through an internal junction", () => {
    const f = fixture(), p = project(), first = saveWorkspace(p, null, f.options);
    const target = path.join(f.options.workspaceRoot, "other-history"); fs.mkdirSync(target);
    junction(target, path.join(f.options.workspaceRoot, "fixture", "history"));
    expect(() => saveWorkspace({ ...p, ground: [] }, first.revision, f.options)).toThrow();
    expect(fs.readdirSync(target)).toEqual([]);
    expect(readWorkspace("fixture", f.options)).toEqual(first);
  });
  it("leaves the last draft and history intact if the final rename fails, then permits retry", () => {
    const f = fixture(), p = project(), first = saveWorkspace(p, null, f.options), next = { ...p, ground: [] };
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("simulated rename failure"); });
    expect(() => saveWorkspace(next, first.revision, f.options)).toThrow("simulated rename failure");
    expect(readWorkspace("fixture", f.options)).toEqual(first);
    expect(fs.readdirSync(path.dirname(f.file)).some(n => n.endsWith(".tmp"))).toBe(false);
    expect(saveWorkspace(next, first.revision, f.options).project).toEqual(next);
  });
  it("detects an external draft change during its temporary write", () => {
    const f = fixture(), p = project(), first = saveWorkspace(p, null, f.options);
    const external = bytes({ ...p, blocked: [[1, 1]] }), write = fs.writeFileSync;
    let changed = false;
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      if (!changed && String(file).endsWith(".tmp")) { changed = true; write(f.file, external); }
      return write(file, data, options);
    });
    expect(() => saveWorkspace({ ...p, ground: [] }, first.revision, f.options)).toThrowError(expect.objectContaining({ status: 409 }));
    expect(changed).toBe(true);
    expect(fs.readFileSync(f.file, "utf8")).toBe(external);
    expect(fs.readdirSync(path.dirname(f.file)).some(n => n.endsWith(".tmp"))).toBe(false);
  });
});

describe("native object workspace drafts", () => {
  it("saves and resumes sparse object edits with the original game link and entities intact", () => {
    const f = fixture(), p = project();
    p.entities = [{ id: "authoring-object", kind: "object", gx: 1, gy: 1, scale: 0.173, offset: [0.1, -0.2] }];
    p.gameObjectEdits = {
      version: 1,
      moved: [{ entityId: "native-a", position: [1.28, -0.64] }],
      removed: ["native-b"],
      added: [{ entityId: "editor-copy", prototypeId: "native-a", position: [2.56, -1.28] }],
    };
    const source = path.join(f.options.gameRoot, "map", "fixture.map"), before = fs.readFileSync(source);
    const saved = saveWorkspace(p, null, f.options);
    expect(readWorkspace("fixture", f.options)).toEqual(saved);
    expect(saved.project.gameSync).toEqual(p.gameSync);
    expect(saved.project.entities).toEqual(p.entities);
    expect(saved.project.gameObjectEdits).toEqual(p.gameObjectEdits);
    expect(fs.readFileSync(source).equals(before)).toBe(true);
  });
  it("rejects malformed object overlays before creating a workspace", () => {
    const f = fixture(), p = project();
    for (const gameObjectEdits of [
      { version: 2, moved: [], removed: [], added: [] },
      { version: 1, moved: [{ entityId: "a", position: [Infinity, 0] }], removed: [], added: [] },
      { version: 1, moved: [{ entityId: "a", position: [0, 0] }], removed: ["a"], added: [] },
      { version: 1, moved: [], removed: [], added: [{ entityId: "a", prototypeId: "../bad", position: [0, 0] }] },
    ]) expect(() => saveWorkspace({ ...p, gameObjectEdits }, null, f.options)).toThrow(WorkspaceError);
    expect(fs.existsSync(f.options.workspaceRoot)).toBe(false);
  });
});
