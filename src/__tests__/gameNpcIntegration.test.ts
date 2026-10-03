import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { useEditorStore } from "../store/editorStore";
import { readWorkspace, saveWorkspace } from "../server/gameWorkspace";
import type { ProjectFileInput } from "../lib/projectIO";
import type { PaletteTile } from "../lib/palette";
import type { GamePreviewScene } from "../lib/gamePreview";
import { validateComparisonPair, type GameBaselinePreview, type GameComparison } from "../lib/gameComparison";
import { npcEditsKey, type GameNpcDescriptor } from "../lib/gameNpc";

type Paths = { gameRoot: string; baselineRoot: string; outputRoot: string };
type NpcScene = GamePreviewScene & { npcs: GameNpcDescriptor[] };
type Report = { exactMapBytes: boolean; applyFiles: string[]; npcChanges?: Record<string, number>; walkChangedCells: number };
type Candidate = { candidateId: string; candidateDir: string; mapPath: string; report: Report };
type Identity = { mapName: string; baselineId: string; candidateId: string };
type Review = { status: string; summary: Record<string, number>; files: { path: string; candidateSha256: string }[] };
interface Core {
  createSyncProject(input: Paths & { mapName: string }): { project: ProjectFileInput; baselineDir: string };
  previewEditedProject(project: ProjectFileInput, paths: Paths): NpcScene;
  exportEditedProject(project: ProjectFileInput, paths: Paths): Candidate;
  compareEditedProject(project: ProjectFileInput, paths: Paths): { scene: NpcScene; comparison: GameComparison & { npcs: NonNullable<GameComparison["npcs"]> } };
  packageCandidate(identity: Identity, paths: Paths): { filename: string; bytes: Buffer; review: Review };
  previewBaselineProject(identity: { mapName: string; baselineId: string; npcSourceId?: string }, paths: Paths): GameBaselinePreview;
  refreshNpcProject(project: ProjectFileInput, paths: Paths): { project: ProjectFileInput; scene: NpcScene };
  validateStorageRoot(target: string, gameRoot: string): string;
}
const requireCjs = createRequire(import.meta.url);
const core = requireCjs("../../scripts/game-sync/core.cjs") as Core;
function noWrites<T>(operation: () => T): T {
  const nativeFs = requireCjs("node:fs") as typeof import("node:fs");
  const methods = ["writeFileSync", "appendFileSync", "copyFileSync", "mkdirSync", "renameSync", "rmSync", "unlinkSync", "truncateSync"] as const;
  const guards = methods.map(method => vi.spyOn(nativeFs, method).mockImplementation(() => { throw new Error("Package must not write: " + method); }));
  try { const result = operation(); for (const guard of guards) expect(guard).not.toHaveBeenCalled(); return result; }
  finally { for (const guard of guards) guard.mockRestore(); }
}
const gameRoot = process.env.MSW_GAME_SYNC_TEST_ROOT;
const npcPath = "RootDesk/MyDesk/DataSet/npc/DT_NpcSpawn.csv";
const classPath = "RootDesk/MyDesk/DataSet/npc/DT_NpcClass.csv";
const appearancePath = "RootDesk/MyDesk/DataSet/npc/DT_NpcAppearance.csv";
const walkPath = "RootDesk/MyDesk/DataSet/world/DT_Walk.csv";
const enabled = !!gameRoot && existsSync(join(gameRoot, npcPath));
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const hash = (file: string) => sha(readFileSync(file));
const deep = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const exportStore = () => deep(useEditorStore.getState().exportProject());
const tiles = (p: ProjectFileInput): PaletteTile[] => p.palette.map(t => ({ ...t, img: null, url: "", hash: t.hash ?? null }));

// Independent RFC 4180 reader keeps raw records, including BOM, quotes and terminators.
function records(text: string): { values: string[]; raw: string }[] {
  const out: { values: string[]; raw: string }[] = [];
  let start = 0, value = "", values: string[] = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { values.push(value); value = ""; }
    else if ((c === "\r" || c === "\n") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      values.push(value); out.push({ values, raw: text.slice(start, i + 1) });
      values = []; value = ""; start = i + 1;
    } else value += c;
  }
  if (start < text.length) { values.push(value); out.push({ values, raw: text.slice(start) }); }
  if (out.length) out[0].values[0] = out[0].values[0].replace(/^\uFEFF/, "");
  return out;
}
function table(file: string) {
  const parsed = records(readFileSync(file, "utf8")), header = parsed[0].values;
  return parsed.slice(1).filter(r => r.values.some(Boolean)).map(r => ({ raw: r.raw, data: Object.fromEntries(header.map((h, i) => [h, r.values[i] ?? ""])) }));
}
function directoryHashes(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  function visit(current: string, relative: string) {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const rel = relative + item.name, file = join(current, item.name);
      if (item.isDirectory()) visit(file, rel + "/"); else out[rel] = hash(file);
    }
  }
  visit(dir, ""); return out;
}
function zipEntries(bytes: Buffer): Map<string, Buffer> {
  // Validate the central directory against independent local-header bytes; no extraction to disk.
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThanOrEqual(0);
  const count = bytes.readUInt16LE(end + 10), entries = new Map<string, Buffer>();
  let cursor = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    expect(bytes.readUInt32LE(cursor)).toBe(0x02014b50);
    const length = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
    const name = bytes.subarray(cursor + 46, cursor + 46 + length).toString("utf8");
    const local = bytes.readUInt32LE(cursor + 42), size = bytes.readUInt32LE(cursor + 24);
    expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
    expect(bytes.readUInt16LE(local + 8)).toBe(0); // verified package uses store
    const begin = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    expect(entries.has(name)).toBe(false); expect(name).not.toMatch(/(?:^|\/)\.\.(?:\/|$)|^[/\\]|:/);
    entries.set(name, bytes.subarray(begin, begin + size));
    cursor += 46 + length + extra + comment;
  }
  expect(cursor).toBe(end); return entries;
}

describe.skipIf(!enabled)("actual game NPC CSV → editor → reviewed candidate (opt in)", () => {
  let runRoot: string, tempParent: string, before: Record<string, string>, scriptsBefore: Record<string, string>;
  const evidence: Record<string, unknown>[] = [];
  const sourceNames = () => execFileSync("git", ["-c", "safe.directory=" + gameRoot!, "-C", gameRoot!, "ls-files", "-z", "--",
    "map", "RootDesk/MyDesk/DataSet", "scripts/storage-inventory.lock.json", "scripts/build_map.cjs"], { encoding: "utf8" })
    .split("\0").filter(p => /\.(map|json|csv|cjs)$/.test(p) && existsSync(join(gameRoot!, p))).sort();
  const scriptNames = () => execFileSync("git", ["-c", "safe.directory=" + gameRoot!, "-C", gameRoot!, "ls-files", "-z", "--", "RootDesk/MyDesk/src", "RootDesk/MyDesk/Models"], { encoding: "utf8" })
    .split("\0").filter(p => /(?:IsoProjectLogic|IsoPlayerDepthLogic|GroundShadowLogic|ActorVisualLogic|SpriteBoundsCatalogLogic|MonsterAppearanceCatalogLogic|MonsterSpawnCatalogLogic|NpcCatalogLogic|DataSetRepoLogic|NpcMapMarkerServiceLogic|NpcComponent|MonsterSpawnerLogic|HpBarLogic|HpBarStyleLogic|LocaleLogic|OccupancyGridStoreLogic|MapBoundsLogic)\.(?:mlua|codeblock)$|\/Npc\.model$/.test(p)).sort();
  const sourceHashes = (files: string[]) => Object.fromEntries(files.map(p => [p, hash(join(gameRoot!, p))]));
  const paths = (): Paths => ({ gameRoot: gameRoot!, baselineRoot: join(runRoot, "baselines"), outputRoot: join(runRoot, "candidates") });
  beforeAll(() => {
    tempParent = realpathSync(tmpdir()); runRoot = mkdtempSync(join(tempParent, "web-map-editor-npc-sync-"));
    before = sourceHashes(sourceNames()); scriptsBefore = sourceHashes(scriptNames());
  });
  afterAll(() => {
    if (!runRoot) return;
    const after = sourceHashes(sourceNames()), scriptsAfter = sourceHashes(scriptNames());
    const changedSources = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]);
    const changedScripts = [...new Set([...Object.keys(scriptsBefore), ...Object.keys(scriptsAfter)])].filter(p => scriptsBefore[p] !== scriptsAfter[p]);
    writeFileSync(runRoot + ".evidence.json", JSON.stringify({ gameRoot, runRoot, sourceFilesChecked: Object.keys(before).length,
      scriptFilesChecked: Object.keys(scriptsBefore).length, changedSources, changedScripts,
      sourceHashesBefore: before, sourceHashesAfter: after, scriptHashesBefore: scriptsBefore, scriptHashesAfter: scriptsAfter, cases: evidence }, null, 2));
    console.log("[npc-sync-evidence]", runRoot + ".evidence.json");
    if (dirname(runRoot) !== tempParent || !basename(runRoot).startsWith("web-map-editor-npc-sync-")) throw new Error("Unsafe cleanup path");
    if (process.env.MSW_GAME_SYNC_KEEP_OUTPUT !== "1") rmSync(runRoot, { recursive: true, force: true });
    expect(changedSources).toEqual([]); expect(changedScripts).toEqual([]);
  });

  it("every actual map displays its enabled CSV NPCs at runtime cells with original map bytes", () => {
    const spawn = table(join(gameRoot!, npcPath)), classes = table(join(gameRoot!, classPath)), appearance = table(join(gameRoot!, appearancePath));
    expect(spawn).toHaveLength(13); expect(spawn.filter(r => r.data.MapName === "ferendel")).toHaveLength(9);
    const maps = sourceNames().filter(p => /^map\/[^/]+\.map$/.test(p)).map(p => basename(p, ".map"));
    const counts: Record<string, number> = {};
    for (const mapName of maps) {
      const synced = core.createSyncProject({ ...paths(), mapName });
      const baselineBefore = directoryHashes(synced.baselineDir);
      const scene = core.previewEditedProject(synced.project, paths());
      const expected = spawn.filter(r => r.data.MapName === mapName && r.data.Enabled.toLowerCase() === "true");
      expect(scene.npcs, mapName).toHaveLength(expected.length);
      for (const row of expected) {
        const npc = scene.npcs.find(n => n.entityId === row.data.NpcSpawnID)!;
        const type = classes.find(r => r.data.NpcClassID === row.data.NpcClassID)!.data;
        const visual = appearance.find(r => r.data.NpcAppearanceID === type.NpcAppearanceID && r.data.Action === "Idle" && r.data.BaseDir === "SE")!.data;
        expect(npc).toMatchObject({ spawnId: row.data.NpcSpawnID, npcClassId: Number(row.data.NpcClassID),
          cell: [Number(row.data.CellX), Number(row.data.CellY)], bodyScale: Number(type.BodyScale), ruid: visual.Ruid,
          flipX: row.data.FlipX.toLowerCase() === "true", dialogId: row.data.DialogID });
        const x = (Number(row.data.CellX) - Number(row.data.CellY)) * 1.28;
        const y = -(Number(row.data.CellX) + Number(row.data.CellY) - 30) * 0.64;
        expect(npc.position[0]).toBeCloseTo(x, 8); expect(npc.position[1]).toBeCloseTo(y, 8); expect(npc.position[2]).toBeCloseTo(y * 0.21875, 8);
        const sprite = scene.sprites.find(s => s.npcEntityId === npc.entityId)!;
        expect(sprite, npc.entityId).toBeDefined(); expect(sprite.ruid).toBe(visual.Ruid);
        expect(sprite.orderInLayer).toBe(0); expect(Math.abs(sprite.scale[0])).toBe(Number(type.BodyScale));
        expect(sprite.scale[1]).toBe(Number(type.BodyScale));
        expect((sprite.scale[0] < 0) !== sprite.flipX).toBe(npc.flipX);
      }
      const candidate = core.exportEditedProject(synced.project, paths());
      expect(candidate.report.exactMapBytes).toBe(true);
      expect(hash(candidate.mapPath)).toBe(hash(join(gameRoot!, "map", mapName + ".map")));
      expect(candidate.report.applyFiles).not.toContain(npcPath);
      expect(hash(join(candidate.candidateDir, "reference", npcPath))).toBe(hash(join(gameRoot!, npcPath)));
      expect(directoryHashes(synced.baselineDir)).toEqual(baselineBefore);
      counts[mapName] = scene.npcs.length;
    }
    evidence.push({ kind: "all-map-npcs", counts, total: Object.values(counts).reduce((a, b) => a + b, 0), exactMapBytes: true, baselineUnchanged: true });
  }, 120_000);

  for (const mapName of ["ferendel", "ferendelmotel"]) it(mapName + ": move/flip/dialog/add/delete preserves source rows and existing draft through save/reopen/undo/ZIP", () => {
    const synced = core.createSyncProject({ ...paths(), mapName });
    useEditorStore.getState().newProject(); useEditorStore.getState().loadProject(synced.project, tiles(synced.project));
    const original = exportStore(), baselineBefore = directoryHashes(synced.baselineDir);
    const beforeScene = core.previewEditedProject(original, paths()), npc = beforeScene.npcs[0];
    const occupied = new Set(beforeScene.npcs.map(n => n.cell.join(",")));
    const safe = original.blocked.filter(cell => !occupied.has(cell.join(",")) && cell.every((n, i) => n >= 0 && n < original.size[i]));
    // Blocked tiles intentionally remain valid NPC cells (bartender / altar runtime rule).
    expect(safe.length).toBeGreaterThan(2);
    const dialogId = "review_test";
    expect(useEditorStore.getState().updateGameNpc(npc.entityId, { cell: safe[0], flipX: !npc.flipX, dialogId }, beforeScene)).toBe(true);
    let scene = core.previewEditedProject(exportStore(), paths());
    const added = useEditorStore.getState().addGameNpc(101, safe[1], scene);
    expect(added).toMatch(/^[a-f0-9-]{36}$/i);
    scene = core.previewEditedProject(exportStore(), paths());
    const deleted = mapName === "ferendel" ? beforeScene.npcs[1].entityId : added!;
    expect(useEditorStore.getState().removeGameNpc(deleted, scene)).toBe(true);
    const edited = exportStore();
    expect(edited.entities).toEqual(original.entities); expect(edited.blocked).toEqual(original.blocked);
    expect(edited.ground).toEqual(original.ground); expect(edited.gameObjectEdits).toEqual(original.gameObjectEdits);
    const comparison = core.compareEditedProject(edited, paths());
    const originalPreview = noWrites(() => core.previewBaselineProject({ mapName, baselineId: edited.gameSync!.baselineId }, paths()));
    expect(validateComparisonPair(originalPreview, comparison.scene, comparison.comparison)).toBe(true);
    const candidate = core.exportEditedProject(edited, paths());
    expect(candidate.report.exactMapBytes).toBe(true); expect(hash(candidate.mapPath)).toBe(hash(join(gameRoot!, "map", mapName + ".map")));
    expect(candidate.report.applyFiles).toEqual(["map/" + mapName + ".map", npcPath]);
    const output = table(join(candidate.candidateDir, npcPath)), source = table(join(gameRoot!, npcPath));
    const changedRow = output.find(r => r.data.NpcSpawnID === npc.spawnId)!.data;
    expect(changedRow).toMatchObject({ CellX: String(safe[0][0]), CellY: String(safe[0][1]), DialogID: dialogId,
      FlipX: npc.flipX ? "False" : "True", Scale: source.find(r => r.data.NpcSpawnID === npc.spawnId)!.data.Scale });
    for (const row of source.filter(r => r.data.NpcSpawnID !== npc.spawnId && r.data.NpcSpawnID !== deleted)) {
      expect(output.find(r => r.data.NpcSpawnID === row.data.NpcSpawnID)?.raw, row.data.NpcSpawnID).toBe(row.raw);
    }
    expect(records(readFileSync(join(candidate.candidateDir, npcPath), "utf8"))[0].raw).toBe(records(readFileSync(join(gameRoot!, npcPath), "utf8"))[0].raw);
    if (mapName === "ferendel") {
      expect(output.some(r => r.data.NpcSpawnID === deleted)).toBe(false);
      expect(output.find(r => r.data.NpcSpawnID === mapName + "_Editor_" + added)?.data).toMatchObject({ NpcClassID: "101", CellX: String(safe[1][0]), CellY: String(safe[1][1]) });
      expect(comparison.comparison.npcs.removed).toHaveLength(1); expect(comparison.comparison.npcs.added).toHaveLength(1);
    } else {
      expect(output).toHaveLength(source.length); expect(comparison.comparison.npcs.added).toHaveLength(0);
    }
    expect(comparison.comparison.npcs.moved).toHaveLength(1);
    expect(candidate.report.npcChanges).toEqual({ moved: 1, updated: 1, added: mapName === "ferendel" ? 1 : 0, removed: mapName === "ferendel" ? 1 : 0 });
    const workspaceOptions = { gameRoot: gameRoot!, workspaceRoot: join(runRoot, "workspaces", mapName), validateStorageRoot: core.validateStorageRoot };
    const receipt = saveWorkspace(edited, null, workspaceOptions);
    const reopened = readWorkspace(mapName, workspaceOptions)!;
    expect(reopened.revision).toBe(receipt.revision); expect(reopened.project).toEqual(edited);
    // Keep store undo history until after exact serialization is proven.
    for (let i = 0; i < 3; i++) useEditorStore.getState().undo();
    expect(exportStore()).toEqual(original);
    expect(core.compareEditedProject(exportStore(), paths()).comparison.npcs).toMatchObject({ moved: [], added: [], removed: [], updated: [] });
    const undone = core.exportEditedProject(exportStore(), paths());
    expect(undone.report.applyFiles).not.toContain(npcPath); expect(hash(undone.mapPath)).toBe(hash(candidate.mapPath));
    useEditorStore.getState().loadProject(reopened.project, tiles(reopened.project));
    expect(exportStore()).toEqual(edited); expect(core.previewEditedProject(exportStore(), paths()).npcs).toEqual(comparison.scene.npcs);
    const readonlyBefore = { baseline: directoryHashes(synced.baselineDir), candidate: directoryHashes(candidate.candidateDir) };
    const pack = noWrites(() => core.packageCandidate({ candidateId: candidate.candidateId, mapName, baselineId: edited.gameSync!.baselineId }, paths()));
    expect(pack.review.status).toBe("ready");
    expect(pack.review.summary).toMatchObject({ npcsMoved: 1, npcsUpdated: 1, npcsAdded: mapName === "ferendel" ? 1 : 0, npcsRemoved: mapName === "ferendel" ? 1 : 0 });
    const entries = zipEntries(pack.bytes);
    expect([...entries.keys()]).toEqual([...candidate.report.applyFiles, "REVIEW.txt"]);
    for (const file of pack.review.files) expect(sha(entries.get(file.path)!)).toBe(file.candidateSha256);
    expect(entries.has(walkPath)).toBe(false); expect([...entries.keys()].some(p => /reference|project\.json|baseline/.test(p))).toBe(false);
    expect(directoryHashes(synced.baselineDir)).toEqual(readonlyBefore.baseline);
    expect(directoryHashes(candidate.candidateDir)).toEqual(readonlyBefore.candidate);
    expect(directoryHashes(synced.baselineDir)).toEqual(baselineBefore);
    evidence.push({ kind: "npc-edit-roundtrip", mapName, initialNpcs: beforeScene.npcs.length, candidateNpcs: comparison.scene.npcs.length,
      changedNpc: npc.entityId, blockedTarget: safe[0], changes: candidate.report.npcChanges, zipFiles: [...entries.keys()], originalMapExact: true,
      untouchedCsvRowsPreserved: true, baselineUnchanged: true, saveReopenExact: true, undoExact: true, gameApplied: false, runtimeVerified: false });
  }, 90_000);

  it("NPC source refresh preserves existing object/walk/legacy draft edits and supports undo/save/reopen", () => {
    const synced = core.createSyncProject({ ...paths(), mapName: "ferendelmotel" });
    const background = deep(synced.project), baselineBefore = directoryHashes(synced.baselineDir);
    const originalScene = core.previewEditedProject(background, paths());
    const object = originalScene.objects!.find(item => item.canDelete)!;
    expect(object).toBeDefined();
    background.gameObjectEdits = { version: 1, moved: [], removed: [object.entityId], added: [] };
    expect(background.blocked.length).toBeGreaterThan(0); background.blocked = background.blocked.slice(1);
    const backgroundCandidate = core.exportEditedProject(background, paths());
    expect(backgroundCandidate.report.applyFiles).toContain(walkPath);
    useEditorStore.getState().loadProject(background, tiles(background));
    const backgroundScene = core.previewEditedProject(exportStore(), paths());
    expect(useEditorStore.getState().updateGameNpc(backgroundScene.npcs[0].entityId, { dialogId: "pending_dialog" }, backgroundScene)).toBe(true);
    const edited = exportStore(), refreshed = core.refreshNpcProject(edited, paths());
    expect(refreshed.project.gameNpcSync?.sourceId).toMatch(/^[a-f0-9-]{36}$/i);
    const nonNpc = (project: ProjectFileInput) => {
      const copy = deep(project); delete copy.gameNpcSync; delete copy.gameNpcEdits; return copy;
    };
    expect(nonNpc(refreshed.project)).toEqual(nonNpc(edited));
    const expectedKey = JSON.stringify([edited.gameNpcSync ?? null, npcEditsKey(edited.gameNpcEdits)]);
    expect(useEditorStore.getState().replaceGameNpcSource(refreshed.project.gameNpcSync!, edited.gameSync!.baselineId, expectedKey)).toBe(true);
    const replaced = exportStore(); expect(replaced).toEqual(refreshed.project);
    useEditorStore.getState().undo(); expect(exportStore()).toEqual(edited);
    useEditorStore.getState().redo(); expect(exportStore()).toEqual(replaced);
    const workspaceOptions = { gameRoot: gameRoot!, workspaceRoot: join(runRoot, "refresh-workspace"), validateStorageRoot: core.validateStorageRoot };
    saveWorkspace(replaced, null, workspaceOptions);
    const reopened = readWorkspace(replaced.map, workspaceOptions)!;
    useEditorStore.getState().loadProject(reopened.project, tiles(reopened.project)); expect(exportStore()).toEqual(replaced);
    const refreshedComparison = core.compareEditedProject(exportStore(), paths());
    const refreshedOriginal = noWrites(() => core.previewBaselineProject({ mapName: replaced.map, baselineId: replaced.gameSync!.baselineId, npcSourceId: replaced.gameNpcSync!.sourceId }, paths()));
    expect(validateComparisonPair(refreshedOriginal, refreshedComparison.scene, refreshedComparison.comparison)).toBe(true);
    const output = core.exportEditedProject(exportStore(), paths());
    expect(hash(output.mapPath)).toBe(hash(backgroundCandidate.mapPath));
    expect(hash(join(output.candidateDir, walkPath))).toBe(hash(join(backgroundCandidate.candidateDir, walkPath)));
    expect(output.report.applyFiles).not.toContain(npcPath);
    expect(core.previewEditedProject(exportStore(), paths()).npcs).toEqual(originalScene.npcs);
    expect(directoryHashes(synced.baselineDir)).toEqual(baselineBefore);
    evidence.push({ kind: "npc-refresh-existing-draft", mapName: replaced.map, nativeObjectOverlayPreserved: true, blockedOverlayPreserved: true,
      legacyEntitiesPreserved: true, npcSourceId: replaced.gameNpcSync!.sourceId, undoRedoExact: true, saveReopenExact: true, baselineUnchanged: true });
  }, 90_000);

  it("concurrent other-map NPC rows merge while current-map/class/appearance drift rejects using a temporary game copy", () => {
    const copiedGame = join(runRoot, "game-copy");
    const builderRelative = [".agents", ".claude", ".codex"].map(p => p + "/skills/msw-general/scripts/map/msw_map_builder.cjs").find(p => existsSync(join(gameRoot!, p)))!;
    const files = [...new Set([...sourceNames(), ...scriptNames(), builderRelative, "scripts/skill-paths.cjs"])];
    for (const relative of files) {
      const to = join(copiedGame, relative); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(gameRoot!, relative), to);
    }
    const copyPaths = { gameRoot: copiedGame, baselineRoot: join(runRoot, "copy-baselines"), outputRoot: join(runRoot, "copy-candidates") };
    const synced = core.createSyncProject({ ...copyPaths, mapName: "ferendel" }), project = deep(synced.project);
    const baselineBefore = directoryHashes(synced.baselineDir);
    const npc = core.previewEditedProject(project, copyPaths).npcs[0];
    project.gameNpcEdits = { version: 1, updated: [{ entityId: npc.entityId, dialogId: "review-test" }], added: [], removed: [] };
    const spawnFile = join(copiedGame, npcPath), originalSpawn = readFileSync(spawnFile, "utf8");
    const other = table(spawnFile).find(r => r.data.MapName === "ferendelmotel")!;
    const modifiedOther = other.raw.replace(",10100", ",10101");
    expect(modifiedOther).not.toBe(other.raw); writeFileSync(spawnFile, originalSpawn.replace(other.raw, modifiedOther));
    const candidate = core.exportEditedProject(project, copyPaths);
    expect(table(join(candidate.candidateDir, npcPath)).find(r => r.data.NpcSpawnID === other.data.NpcSpawnID)?.raw).toBe(modifiedOther);
    const current = table(spawnFile).find(r => r.data.NpcSpawnID === npc.entityId)!;
    writeFileSync(spawnFile, readFileSync(spawnFile, "utf8").replace(current.raw, current.raw.replace(",True,1,", ",True,1.125,")));
    expect(() => core.exportEditedProject(project, copyPaths)).toThrow();
    writeFileSync(spawnFile, originalSpawn);
    for (const relative of [classPath, appearancePath]) {
      const file = join(copiedGame, relative), bytes = readFileSync(file);
      writeFileSync(file, Buffer.concat([bytes, Buffer.from("\n")]));
      expect(() => core.exportEditedProject(project, copyPaths), relative).toThrow();
      writeFileSync(file, bytes);
    }
    expect(directoryHashes(synced.baselineDir)).toEqual(baselineBefore);
    evidence.push({ kind: "npc-concurrency-copy-only", otherMapRowMerged: true, targetMapDriftRejected: true, classDriftRejected: true, appearanceDriftRejected: true, baselineUnchanged: true });
  }, 90_000);
});
