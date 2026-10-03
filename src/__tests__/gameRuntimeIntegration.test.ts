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
import { runtimeSourceKey, type GameMonsterDescriptor, type GamePortalDescriptor, type GameSpawnDescriptor, type GameMonsterClass } from "../lib/gameRuntime";


interface NativeDepthMap { getTileMapMode(): number; listEntities(): { path: string }[]; find(path: string): unknown }
interface DepthMirror {
  collectMetas(records: unknown[]): unknown[];
  depthZ(y: number): number;
  solvePlayerZ(metas: unknown[], gx: number, gy: number, z: number, foot: { x: number; y: number }): { z: number };
  portalZ(metas: unknown[], gx: number, gy: number): { z: number };
}

type Paths = { gameRoot: string; baselineRoot: string; outputRoot: string };
type RuntimeScene = GamePreviewScene & { monsters: GameMonsterDescriptor[]; portals: GamePortalDescriptor[]; spawn: GameSpawnDescriptor; monsterCatalog: GameMonsterClass[] };
type Candidate = { candidateId: string; candidateDir: string; mapPath: string; report: { exactMapBytes: boolean; applyFiles: string[] } };
type Identity = { mapName: string; baselineId: string; candidateId: string };
type Review = { status: string; summary: Record<string, number>; files: { path: string; candidateSha256: string }[] };
interface Core {
  createSyncProject(input: Paths & { mapName: string }): { project: ProjectFileInput; baselineDir: string };
  previewEditedProject(project: ProjectFileInput, paths: Paths): RuntimeScene;
  exportEditedProject(project: ProjectFileInput, paths: Paths): Candidate;
  packageCandidate(identity: Identity, paths: Paths): { filename: string; bytes: Buffer; review: Review };
  refreshRuntimeProject(project: ProjectFileInput, paths: Paths): { project: ProjectFileInput; scene: RuntimeScene };
  validateStorageRoot(target: string, gameRoot: string): string;
}
const requireCjs = createRequire(import.meta.url);
const core = requireCjs("../../scripts/game-sync/core.cjs") as Core;
function noWrites<T>(operation: () => T): T {
  const nativeFs = requireCjs("node:fs") as typeof import("node:fs");
  const methods = ["writeFileSync", "appendFileSync", "copyFileSync", "mkdirSync", "renameSync", "rmSync", "unlinkSync", "truncateSync"] as const;
  const guards = methods.map(method => vi.spyOn(nativeFs, method).mockImplementation(() => { throw new Error("Read-only operation attempted " + method); }));
  try { const result = operation(); for (const guard of guards) expect(guard).not.toHaveBeenCalled(); return result; }
  finally { for (const guard of guards) guard.mockRestore(); }
}
const gameRoot = process.env.MSW_GAME_SYNC_TEST_ROOT;
const monsterPath = "RootDesk/MyDesk/DataSet/monster/DT_MonsterSpawn.csv";
const classPath = "RootDesk/MyDesk/DataSet/monster/DT_MonsterClass.csv";
const appearancePath = "RootDesk/MyDesk/DataSet/monster/DT_MonsterAppearance.csv";
const portalPath = "RootDesk/MyDesk/DataSet/world/DT_Portal.csv";
const boundsPath = "RootDesk/MyDesk/DataSet/world/DT_Bounds.csv";
const walkPath = "RootDesk/MyDesk/DataSet/world/DT_Walk.csv";
const enabled = !!gameRoot && existsSync(join(gameRoot, monsterPath));
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

function csvReplace(raw: string, header: string[], field: string, value: string): string {
  const row = records(raw)[0].values;
  expect(header).toContain(field); row[header.indexOf(field)] = value;
  const ending = raw.endsWith("\r\n") ? "\r\n" : raw.endsWith("\n") ? "\n" : "";
  return row.map(v => /[",\r\n]/.test(v) ? '"' + v.replaceAll('"', '""') + '"' : v).join(",") + ending;
}
function clearCells(project: ProjectFileInput, scene: RuntimeScene): [number, number][] {
  const used = new Set([...project.blocked, ...scene.portals.map(p => p.cell), ...scene.monsters.map(m => m.cell),
    ...(scene.npcs ?? []).map(n => n.cell), scene.spawn.cell].map(c => c.join(",")));
  const { minX, maxX, minY, maxY } = scene.spawn.bounds, cells: [number, number][] = [];
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) if (!used.has(x + "," + y)) cells.push([x, y]);
  expect(cells.length).toBeGreaterThan(5); return cells;
}

describe.skipIf(!enabled)("actual game runtime CSV → editor → reviewed candidate (opt in)", () => {
  let runRoot: string, tempParent: string, before: Record<string, string>, scriptsBefore: Record<string, string>;
  const evidence: Record<string, unknown>[] = [];
  let mapBuilder: { read(path: string): NativeDepthMap }, depthMirror: DepthMirror;

  function expectActorDepth(scene: GamePreviewScene, mapPath: string) {
    const native = mapBuilder.read(mapPath); expect(native.getTileMapMode()).toBe(1);
    const metas = depthMirror.collectMetas(native.listEntities().map(e => native.find(e.path)));
    const actors = [
      ...(scene.npcs ?? []).map(row => ({ row, kind: "npc" })),
      ...(scene.monsters ?? []).map(row => ({ row, kind: "monster" })),
      ...(scene.portals ?? []).map(row => ({ row, kind: "portal" })),
    ];
    for (const { row, kind } of actors.filter(a => a.row.enabled)) {
      const sprite = scene.sprites.find(s => (kind === "npc" ? s.npcEntityId : kind === "monster" ? s.monsterEntityId : s.portalEntityId) === row.entityId);
      expect(sprite, row.entityId + " rendered sprite").toBeDefined();
      const [x, y] = row.position, [gx, gy] = row.cell;
      const expected = kind === "portal" ? depthMirror.portalZ(metas, gx, gy).z : depthMirror.solvePlayerZ(metas, gx, gy, depthMirror.depthZ(y), {x,y}).z;
      expect(sprite!.position.slice(0, 2)).toEqual(row.position.slice(0, 2));
      expect(sprite!.position[2], row.entityId + " runtime depth").toBeCloseTo(expected, 9);
      expect(row.position[2], row.entityId + " logical edit depth").toBeCloseTo(depthMirror.depthZ(y), 9);
    }
  }

  const tracked = (...scope: string[]) => execFileSync("git", ["-c", "safe.directory=" + gameRoot!, "-C", gameRoot!, "ls-files", "-z", "--", ...scope], { encoding: "utf8" }).split("\0").filter(Boolean);
  const sourceNames = () => tracked("map", "RootDesk/MyDesk/DataSet", "scripts/storage-inventory.lock.json", "scripts/build_map.cjs")
    .filter(p => /\.(map|json|csv|cjs)$/.test(p) && existsSync(join(gameRoot!, p))).sort();
  const scriptNames = () => tracked("RootDesk/MyDesk/src", "RootDesk/MyDesk/Models", "scripts")
    .filter(p => /(?:IsoProjectLogic|IsoPlayerDepthLogic|OccluderCoverLogic|GroundShadowLogic|ActorVisualLogic|SpriteBoundsCatalogLogic|MonsterAppearanceCatalogLogic|MonsterSpawnCatalogLogic|NpcCatalogLogic|DataSetRepoLogic|NpcMapMarkerServiceLogic|NpcComponent|MonsterSpawnerLogic|HpBarLogic|HpBarStyleLogic|LocaleLogic|OccupancyGridStoreLogic|MapBoundsLogic|PortalSpawnerLogic|PortalRegistryLogic|PortalRpcLogic|EnterPortalUseCaseLogic|PortalDepthComponent|WorldBootstrapLogic|ResolveResumePlacementUseCaseLogic|MapMetaCatalogLogic|QuestSequenceCatalogLogic|OpenShopUseCaseLogic)\.(?:mlua|codeblock)$|\/(?:Npc|Portal)\.model$|scripts\/(?:depth_check|cover_mask_gen|message-table-checks|dataset-path)\.cjs$/.test(p)).sort();
  const sourceHashes = (files: string[]) => Object.fromEntries(files.map(p => [p, hash(join(gameRoot!, p))]));
  const paths = (): Paths => ({ gameRoot: gameRoot!, baselineRoot: join(runRoot, "baselines"), outputRoot: join(runRoot, "candidates") });
  beforeAll(() => {
    tempParent = realpathSync(tmpdir()); runRoot = mkdtempSync(join(tempParent, "web-map-editor-runtime-sync-"));
    before = sourceHashes(sourceNames()); scriptsBefore = sourceHashes(scriptNames());
    const builderPath = [".agents", ".claude", ".codex"].map(p => join(gameRoot!, p, "skills/msw-general/scripts/map/msw_map_builder.cjs")).find(existsSync)!;
    mapBuilder = (requireCjs(builderPath) as { MapBuilder: { read(path: string): NativeDepthMap } }).MapBuilder;
    depthMirror = requireCjs(join(gameRoot!, "scripts/depth_check.cjs")) as DepthMirror;
  });
  afterAll(() => {
    if (!runRoot) return;
    const after = sourceHashes(sourceNames()), scriptsAfter = sourceHashes(scriptNames());
    const changedSources = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]);
    const changedScripts = [...new Set([...Object.keys(scriptsBefore), ...Object.keys(scriptsAfter)])].filter(p => scriptsBefore[p] !== scriptsAfter[p]);
    writeFileSync(runRoot + ".evidence.json", JSON.stringify({ gameRoot, runRoot, sourceFilesChecked: Object.keys(before).length,
      scriptFilesChecked: Object.keys(scriptsBefore).length, changedSources, changedScripts,
      sourceHashesBefore: before, sourceHashesAfter: after, scriptHashesBefore: scriptsBefore, scriptHashesAfter: scriptsAfter, cases: evidence }, null, 2));
    console.log("[runtime-sync-evidence]", runRoot + ".evidence.json");
    if (dirname(runRoot) !== tempParent || !basename(runRoot).startsWith("web-map-editor-runtime-sync-")) throw new Error("Unsafe cleanup path");
    if (process.env.MSW_GAME_SYNC_KEEP_OUTPUT !== "1") rmSync(runRoot, { recursive: true, force: true });
    expect(changedSources).toEqual([]); expect(changedScripts).toEqual([]);
  });

  it("all 13 actual maps display authoritative monster groups, portals and start cells with exact no-op output", () => {
    const monsters = table(join(gameRoot!, monsterPath)), portals = table(join(gameRoot!, portalPath)), bounds = table(join(gameRoot!, boundsPath));
    const classes = table(join(gameRoot!, classPath)), appearances = table(join(gameRoot!, appearancePath));
    expect(monsters).toHaveLength(15); expect(monsters.reduce((n, r) => n + Number(r.data.Count), 0)).toBe(250);
    expect(portals).toHaveLength(50); expect(bounds).toHaveLength(13);
    const counts: Record<string, unknown> = {};
    for (const row of bounds) {
      const mapName = row.data.MapName, synced = core.createSyncProject({ ...paths(), mapName });
      const baselineBefore = directoryHashes(synced.baselineDir);
      const scene = noWrites(() => core.previewEditedProject(synced.project, paths()));
      expectActorDepth(scene, join(gameRoot!, "map", mapName + ".map"));
      const expectedMonsters = monsters.filter(r => r.data.MapName === mapName), expectedPortals = portals.filter(r => r.data.SrcMap === mapName);
      expect(scene.monsters, mapName).toHaveLength(expectedMonsters.length); expect(scene.portals, mapName).toHaveLength(expectedPortals.length);
      for (const { data: m } of expectedMonsters) {
        const actual = scene.monsters.find(item => item.spawnId === m.MonsterSpawnID)!;
        expect(actual).toMatchObject({ entityId: m.MonsterSpawnID, monsterClassId: Number(m.MonsterClassID), cell: [Number(m.CellX), Number(m.CellY)],
          count: Number(m.Count), spread: Number(m.Spread), enabled: m.Enabled.toLowerCase() === "true", respawnMinSec: Number(m.RespawnMinSec), respawnMaxSec: Number(m.RespawnMaxSec), firstSpawnSec: Number(m.FirstSpawnSec) });
        expect(actual.position[0]).toBeCloseTo((Number(m.CellX) - Number(m.CellY)) * 1.28, 8);
        expect(actual.position[1]).toBeCloseTo(-(Number(m.CellX) + Number(m.CellY) - 30) * 0.64, 8);
        const type = classes.find(r => r.data.MonsterClassID === m.MonsterClassID)!.data;
        const idle = appearances.find(r => r.data.MonsterAppearanceID === type.MonsterAppearanceID && r.data.Action === "Idle" && r.data.BaseDir === "SE")!.data;
        expect(actual.ruid).toBe(idle.Ruid); expect(actual.bodyScale).toBe(Number(type.BodyScale));
      }
      for (const { data: p } of expectedPortals) expect(scene.portals.find(item => item.portalId === p.PortalID)).toMatchObject({
        entityId: p.PortalID, cell: [Number(p.SrcX), Number(p.SrcY)], destMap: p.DestMap,
        destCell: [Number(p.DestX), Number(p.DestY)], destFacing: p.DestFacing || "SE", enabled: p.Enabled.toLowerCase() === "true" });
      expect(scene.spawn.cell).toEqual([Number(row.data.SpawnX), Number(row.data.SpawnY)]);
      const candidate = core.exportEditedProject(synced.project, paths());
      expect(candidate.report.exactMapBytes).toBe(true); expect(hash(candidate.mapPath)).toBe(hash(join(gameRoot!, "map", mapName + ".map")));
      for (const relative of [monsterPath, portalPath, boundsPath]) {
        expect(candidate.report.applyFiles).not.toContain(relative);
        expect(hash(join(candidate.candidateDir, "reference", relative))).toBe(hash(join(gameRoot!, relative)));
      }
      expect(directoryHashes(synced.baselineDir)).toEqual(baselineBefore);
      counts[mapName] = { monsterGroups: scene.monsters.length, requestedMonsters: scene.monsters.reduce((n, m) => n + m.count, 0), portals: scene.portals.length, spawn: scene.spawn.cell };
    }
    evidence.push({ kind: "all-map-runtime", counts, exactMapBytes: true, baselineUnchanged: true, gameApplied: false, runtimeVerified: false });
  }, 180_000);

  for (const mapName of ["ferendel", "ferenforest"]) it(mapName + ": runtime edits save/reopen/undo and ZIP only changed CSVs while all other rows stay exact", () => {
    const synced = core.createSyncProject({ ...paths(), mapName });
    useEditorStore.getState().newProject(); useEditorStore.getState().loadProject(synced.project, tiles(synced.project));
    const original = exportStore(), beforeScene = core.previewEditedProject(original, paths()), baselineBefore = directoryHashes(synced.baselineDir);
    const cells = clearCells(original, beforeScene), monster = beforeScene.monsters[0], portal = beforeScene.portals[0];
    let scene = beforeScene;
    expect(useEditorStore.getState().updateGameMonster(monster.entityId, { cell: cells[0], count: monster.count + 1, spread: 1,
      respawnMinSec: 41, respawnMaxSec: 53, firstSpawnSec: 7 }, scene)).toBe(true);
    scene = core.previewEditedProject(exportStore(), paths());
    const monsterType = scene.monsterCatalog.find(m => m.canAdd)!;
    const addedMonster = useEditorStore.getState().addGameMonster(monsterType.monsterClassId, cells[1], scene);
    expect(addedMonster).toMatch(/^[a-f0-9-]{36}$/i); scene = core.previewEditedProject(exportStore(), paths());
    const removedMonster = beforeScene.monsters[1]?.entityId ?? addedMonster!;
    expect(useEditorStore.getState().removeGameMonster(removedMonster, scene)).toBe(true); scene = core.previewEditedProject(exportStore(), paths());
    expect(useEditorStore.getState().updateGamePortal(portal.entityId, { cell: cells[2], destMap: mapName, destCell: cells[3], destFacing: "NW" }, scene)).toBe(true);
    scene = core.previewEditedProject(exportStore(), paths());
    const addedPortal = useEditorStore.getState().addGamePortal({ cell: cells[4], destMap: mapName, destCell: cells[3], destFacing: "SE", enabled: true }, scene);
    expect(addedPortal).toMatch(/^[a-f0-9-]{36}$/i); scene = core.previewEditedProject(exportStore(), paths());
    const removedPortal = beforeScene.portals[1].entityId;
    expect(useEditorStore.getState().removeGamePortal(removedPortal, scene)).toBe(true); scene = core.previewEditedProject(exportStore(), paths());
    expect(useEditorStore.getState().setGameSpawn(cells[5], scene)).toBe(true);
    const edited = exportStore(), finalScene = core.previewEditedProject(edited, paths());
    for (const field of ["entities", "ground", "blocked", "gameObjectEdits", "gameNpcEdits", "gameNpcSync"] as const) expect(edited[field]).toEqual(original[field]);
    expect(finalScene.monsters.find(m => m.entityId === monster.entityId)).toMatchObject({ cell: cells[0], count: monster.count + 1, spread: 1, respawnMinSec: 41, respawnMaxSec: 53, firstSpawnSec: 7 });
    expect(finalScene.monsters.some(m => m.entityId === removedMonster)).toBe(false);
    expect(finalScene.portals.some(p => p.entityId === removedPortal)).toBe(false); expect(finalScene.spawn.cell).toEqual(cells[5]);
    const candidate = core.exportEditedProject(edited, paths());
    expectActorDepth(finalScene, candidate.mapPath);
    expect(candidate.report.exactMapBytes).toBe(true); expect(hash(candidate.mapPath)).toBe(hash(join(gameRoot!, "map", mapName + ".map")));
    expect(new Set(candidate.report.applyFiles)).toEqual(new Set(["map/" + mapName + ".map", monsterPath, portalPath, boundsPath]));
    const cases = [
      { relative: monsterPath, key: "MonsterSpawnID", touched: [monster.spawnId, removedMonster] },
      { relative: portalPath, key: "PortalID", touched: [portal.portalId, removedPortal] },
      { relative: boundsPath, key: "MapName", touched: [mapName] },
    ];
    for (const { relative, key, touched } of cases) {
      const source = table(join(gameRoot!, relative)), output = table(join(candidate.candidateDir, relative));
      for (const row of source.filter(r => !touched.includes(r.data[key]))) expect(output.find(r => r.data[key] === row.data[key])?.raw, row.data[key]).toBe(row.raw);
      expect(records(readFileSync(join(candidate.candidateDir, relative), "utf8"))[0].raw).toBe(records(readFileSync(join(gameRoot!, relative), "utf8"))[0].raw);
    }
    const monsterOut = table(join(candidate.candidateDir, monsterPath)), portalOut = table(join(candidate.candidateDir, portalPath));
    const sourceMonster = table(join(gameRoot!, monsterPath)).find(r => r.data.MonsterSpawnID === monster.spawnId)!;
    expect(monsterOut.find(r => r.data.MonsterSpawnID === monster.spawnId)?.data).toMatchObject({ CellX: String(cells[0][0]), CellY: String(cells[0][1]),
      Count: String(monster.count + 1), Spread: "1", RespawnMinSec: "41", RespawnMaxSec: "53", FirstSpawnSec: "7", Scale: sourceMonster.data.Scale, FlipX: sourceMonster.data.FlipX });
    expect(portalOut.find(r => r.data.PortalID === portal.portalId)?.data).toMatchObject({ SrcX: String(cells[2][0]), SrcY: String(cells[2][1]), DestMap: mapName, DestX: String(cells[3][0]), DestY: String(cells[3][1]), DestFacing: "NW" });
    expect(table(join(candidate.candidateDir, boundsPath)).find(r => r.data.MapName === mapName)?.data).toMatchObject({ SpawnX: String(cells[5][0]), SpawnY: String(cells[5][1]) });
    expect(monsterOut.some(r => r.data.MonsterSpawnID === removedMonster)).toBe(false); expect(portalOut.some(r => r.data.PortalID === removedPortal)).toBe(false);
    expect(portalOut.some(r => r.data.PortalID.includes(addedPortal!))).toBe(true);
    if (beforeScene.monsters.length > 1) expect(monsterOut.some(r => r.data.MonsterSpawnID.includes(addedMonster!))).toBe(true);
    const workspaceOptions = { gameRoot: gameRoot!, workspaceRoot: join(runRoot, "workspaces", mapName), validateStorageRoot: core.validateStorageRoot };
    const receipt = saveWorkspace(edited, null, workspaceOptions), reopened = readWorkspace(mapName, workspaceOptions)!;
    expect(reopened.revision).toBe(receipt.revision); expect(reopened.project).toEqual(edited);
    for (let i = 0; i < 7; i++) useEditorStore.getState().undo();
    expect(exportStore()).toEqual(original);
    const undone = core.exportEditedProject(exportStore(), paths());
    expect(undone.report.applyFiles).toEqual(["map/" + mapName + ".map"]); expect(hash(undone.mapPath)).toBe(hash(candidate.mapPath));
    useEditorStore.getState().loadProject(reopened.project, tiles(reopened.project)); expect(exportStore()).toEqual(edited);
    const loadedScene = core.previewEditedProject(exportStore(), paths());
    expect(loadedScene.monsters).toEqual(finalScene.monsters); expect(loadedScene.portals).toEqual(finalScene.portals); expect(loadedScene.spawn).toEqual(finalScene.spawn);
    const candidateBefore = directoryHashes(candidate.candidateDir);
    const pack = noWrites(() => core.packageCandidate({ candidateId: candidate.candidateId, mapName, baselineId: edited.gameSync!.baselineId }, paths()));
    expect(pack.review.status).toBe("ready");
    expect(pack.review.summary).toMatchObject({ monstersMoved: 1, monstersUpdated: 1,
      monstersAdded: beforeScene.monsters.length > 1 ? 1 : 0, monstersRemoved: beforeScene.monsters.length > 1 ? 1 : 0,
      portalsMoved: 1, portalsAdded: 1, portalsRemoved: 1, portalsUpdated: 1, spawnChanged: 1 });
    const entries = zipEntries(pack.bytes);
    expect([...entries.keys()]).toEqual([...candidate.report.applyFiles, "REVIEW.txt"]);
    for (const file of pack.review.files) expect(sha(entries.get(file.path)!)).toBe(file.candidateSha256);
    expect(entries.has(walkPath)).toBe(false); expect([...entries.keys()].some(p => /reference|project\.json|baseline/.test(p))).toBe(false);
    expect(directoryHashes(candidate.candidateDir)).toEqual(candidateBefore); expect(directoryHashes(synced.baselineDir)).toEqual(baselineBefore);
    evidence.push({ kind: "runtime-edit-roundtrip", mapName, mapExact: true, untouchedRowsExact: true, saveReopenExact: true, undoExact: true,
      zipFiles: [...entries.keys()], reviewSummary: pack.review.summary, baselineUnchanged: true, packageWrites: 0, gameApplied: false, runtimeVerified: false });
  }, 120_000);

  it("runtime refresh preserves object, walk and NPC edits through undo/save/reopen", () => {
    const synced = core.createSyncProject({ ...paths(), mapName: "ferendel" }), background = deep(synced.project);
    const baselineBefore = directoryHashes(synced.baselineDir), initial = core.previewEditedProject(background, paths());
    const object = initial.objects!.find(o => o.canDelete)!;
    background.gameObjectEdits = { version: 1, moved: [], removed: [object.entityId], added: [] };
    background.blocked = background.blocked.slice(1);
    background.gameNpcEdits = { version: 1, updated: [{ entityId: initial.npcs![0].entityId, flipX: !initial.npcs![0].flipX }], added: [], removed: [] };
    useEditorStore.getState().loadProject(background, tiles(background));
    const beforeScene = core.previewEditedProject(exportStore(), paths());
    expect(useEditorStore.getState().updateGameMonster(beforeScene.monsters[0].entityId, { count: beforeScene.monsters[0].count + 1 }, beforeScene)).toBe(true);
    const edited = exportStore(), refreshed = core.refreshRuntimeProject(edited, paths());
    const nonRuntime = (project: ProjectFileInput) => { const copy = deep(project); delete copy.gameMonsterEdits; delete copy.gamePortalEdits; delete copy.gameSpawnEdits; delete copy.gameRuntimeSync; return copy; };
    expect(nonRuntime(refreshed.project)).toEqual(nonRuntime(edited)); expect(refreshed.project.gameRuntimeSync?.sourceId).toMatch(/^[a-f0-9-]{36}$/i);
    expect(useEditorStore.getState().replaceGameRuntimeSource(refreshed.project.gameRuntimeSync!, edited.gameSync!.baselineId, runtimeSourceKey(edited))).toBe(true);
    const replaced = exportStore(); expect(replaced).toEqual(refreshed.project);
    useEditorStore.getState().undo(); expect(exportStore()).toEqual(edited); useEditorStore.getState().redo(); expect(exportStore()).toEqual(replaced);
    const workspaceOptions = { gameRoot: gameRoot!, workspaceRoot: join(runRoot, "refresh-workspace"), validateStorageRoot: core.validateStorageRoot };
    saveWorkspace(replaced, null, workspaceOptions); const reopened = readWorkspace(replaced.map, workspaceOptions)!;
    useEditorStore.getState().loadProject(reopened.project, tiles(reopened.project)); expect(exportStore()).toEqual(replaced);
    const finalScene = core.previewEditedProject(exportStore(), paths());
    expect(finalScene.monsters).toEqual(initial.monsters); expect(finalScene.portals).toEqual(initial.portals); expect(finalScene.spawn).toEqual(initial.spawn);
    expect(directoryHashes(synced.baselineDir)).toEqual(baselineBefore);
    evidence.push({ kind: "runtime-refresh-existing-draft", objectWalkNpcPreserved: true, undoRedoExact: true, saveReopenExact: true, baselineUnchanged: true });
  }, 90_000);

  it("other-map CSV changes merge but current-map and monster definition drift reject using only a temporary game copy", () => {
    const copiedGame = join(runRoot, "game-copy");
    const builderRelative = [".agents", ".claude", ".codex"].map(p => p + "/skills/msw-general/scripts/map/msw_map_builder.cjs").find(p => existsSync(join(gameRoot!, p)))!;
    const files = [...new Set([...sourceNames(), ...scriptNames(), builderRelative, "scripts/skill-paths.cjs"])];
    for (const relative of files) { const to = join(copiedGame, relative); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(gameRoot!, relative), to); }
    const copyPaths = { gameRoot: copiedGame, baselineRoot: join(runRoot, "copy-baselines"), outputRoot: join(runRoot, "copy-candidates") };
    const synced = core.createSyncProject({ ...copyPaths, mapName: "ferenforest" }), project = deep(synced.project);
    const baselineBefore = directoryHashes(synced.baselineDir), scene = core.previewEditedProject(project, copyPaths), cells = clearCells(project, scene);
    project.gameMonsterEdits = { version: 1, updated: [{ entityId: scene.monsters[0].entityId, count: scene.monsters[0].count + 1 }], added: [], removed: [] };
    project.gamePortalEdits = { version: 1, updated: [{ entityId: scene.portals[0].entityId, destFacing: scene.portals[0].destFacing === "NW" ? "SE" : "NW" }], added: [], removed: [] };
    project.gameSpawnEdits = { version: 1, cell: cells[0] };
    const mutations = [
      { relative: monsterPath, mapKey: "MapName", key: "MonsterSpawnID", field: "Count" },
      { relative: portalPath, mapKey: "SrcMap", key: "PortalID", field: "DestX" },
      { relative: boundsPath, mapKey: "MapName", key: "MapName", field: "SpawnX" },
    ];
    for (const { relative, mapKey, key, field } of mutations) {
      const file = join(copiedGame, relative), bytes = readFileSync(file), text = bytes.toString("utf8"), rows = table(file), header = records(text)[0].values;
      const other = rows.find(r => r.data[mapKey] === "ferendel")!, current = rows.find(r => r.data[mapKey] === "ferenforest")!;
      const newOther = csvReplace(other.raw, header, field, String(Number(other.data[field]) + 1));
      writeFileSync(file, text.replace(other.raw, newOther));
      const candidate = core.exportEditedProject(project, copyPaths);
      expect(table(join(candidate.candidateDir, relative)).find(r => r.data[key] === other.data[key])?.raw).toBe(newOther);
      const newCurrent = csvReplace(current.raw, header, field, String(Number(current.data[field]) + 1));
      writeFileSync(file, text.replace(current.raw, newCurrent));
      expect(() => core.exportEditedProject(project, copyPaths), relative).toThrow(); writeFileSync(file, bytes);
    }
    for (const relative of [classPath, appearancePath]) {
      const file = join(copiedGame, relative), bytes = readFileSync(file); writeFileSync(file, Buffer.concat([bytes, Buffer.from("\n")]));
      expect(() => core.exportEditedProject(project, copyPaths), relative).toThrow(); writeFileSync(file, bytes);
    }
    expect(directoryHashes(synced.baselineDir)).toEqual(baselineBefore);
    evidence.push({ kind: "runtime-concurrency-copy-only", mergedOtherMapCsvs: mutations.map(m => m.relative), targetMapDriftRejected: true,
      classAppearanceDriftRejected: true, baselineUnchanged: true });
  }, 120_000);
});
