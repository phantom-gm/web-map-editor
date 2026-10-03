import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { inflateRawSync } from "node:zlib";
import { captureEditorSnapshot, useEditorStore } from "../store/editorStore";
import type { GameObjectDescriptor } from "../lib/gameObjects";
import type { PaletteTile } from "../lib/palette";
import type { ProjectFile, ProjectFileInput } from "../lib/projectIO";
import { previewSpriteGeometry, type GamePreviewScene } from "../lib/gamePreview";
import { cellToScreen } from "../lib/grid";
import { cellKey } from "../lib/cell";

type Counts = { groundCells: number; groundEntities: number; bySize: Record<string, number> };
type SyncReport = {
  counts: Counts; preservedEntities: number; groundEditingSupported: boolean; warnings: string[];
  exactMapBytes?: boolean; unchanged?: boolean; sourceFilesUnchanged: boolean;
  datasetsExact?: boolean; gameApplied?: boolean; runtimeVerified?: boolean; changedCells?: number;
  walkEditingSupported?: boolean; walkChangedCells?: number; applyFiles?: string[];
};
type Options = { gameRoot: string; baselineRoot: string; outputRoot: string };
interface Core {
  previewEditedProject(project: ProjectFile, options: Options): GamePreviewScene;
  createSyncProject(options: Options & { mapName: string }): {
    project: ProjectFileInput; report: SyncReport; baselineDir: string;
  };
  exportEditedProject(project: ProjectFile, options: Options): {
    report: SyncReport; mapPath: string; reportPath: string; candidateDir: string;
  };
}
interface NativeMap {
  getTileMapMode(): number;
  listEntities(): { name: string; path: string; id: string }[];
  find(name: string): unknown;
  component(name: string, type: string): Record<string, unknown> | undefined;
}
type NativeBuilder = { read(path: string): NativeMap };
type Asset = { ruid: string; size: number; material: string; variant: string };
type Block = { name: string; gx: number; gy: number; asset: Asset };
const requireCjs = createRequire(import.meta.url);
const core = requireCjs("../../scripts/game-sync/core.cjs") as Core;
const gameRoot = process.env.MSW_GAME_SYNC_TEST_ROOT;
const mapNames = ["ferendel", "velos", "ferenforest", "ferenforest2", "ferenforest3", "ferenforest4", "ferendelmotel", "ferendelshop"];
const specialMaps = ["ironhallmine", "ironhallminedepths", "lumiatemple", "noxtemple"];
// Local real-game reads are explicitly opted in. Missing installations skip in CI/other PCs.
const enabled = !!gameRoot && mapNames.every(name => existsSync(join(gameRoot, "map", name + ".map")));
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const memoryTiles = (p: ProjectFileInput): PaletteTile[] => p.palette.map(t => ({
  name: t.name, ruid: t.ruid, px: t.px, category: t.category, regStatus: t.regStatus,
  hash: t.hash ?? null, img: null, url: "",
}));
const exportStore = () => JSON.parse(JSON.stringify(useEditorStore.getState().exportProject())) as ProjectFile;
const SPRITE = "MOD.Core.SpriteRendererComponent", TRANSFORM = "MOD.Core.TransformComponent";
const materialKey = (asset: Asset) => asset.material === "길경계" ? asset.material + ":" + asset.variant : asset.material;

describe.skipIf(!enabled)("actual game → editor store → candidate (opt in: MSW_GAME_SYNC_TEST_ROOT)", () => {
  let runRoot: string, tempParent: string, builder: NativeBuilder;
  let assets: Map<string, Asset>;
  let resourceNames: Map<string, string>;
  let beforeSources: Record<string, string>;
  const evidence: Record<string, unknown>[] = [];
  const options = (): Options => ({
    gameRoot: gameRoot!, baselineRoot: join(runRoot, "baselines"), outputRoot: join(runRoot, "candidates"),
  });
  const sourceFiles = () => execFileSync("git", [
    "-c", "safe.directory=" + gameRoot!, "-C", gameRoot!, "ls-files", "-z", "--",
    "map", "RootDesk/MyDesk/DataSet", "scripts/storage-inventory.lock.json", "scripts/build_map.cjs",
  ], { encoding: "utf8" }).split("\0").filter(file => /\.(map|json|csv|cjs)$/.test(file) && existsSync(join(gameRoot!, file))).sort();
  const sourceHashes = () => Object.fromEntries(sourceFiles().map(file => [file, hash(join(gameRoot!, file))]));

  beforeAll(() => {
    tempParent = realpathSync(tmpdir());
    runRoot = mkdtempSync(join(tempParent, "web-map-editor-store-sync-"));
    const builderPath = [".agents", ".claude", ".codex"].map(dir =>
      join(gameRoot!, dir, "skills/msw-general/scripts/map/msw_map_builder.cjs")).find(existsSync);
    expect(builderPath).toBeDefined();
    builder = (requireCjs(builderPath!) as { MapBuilder: NativeBuilder }).MapBuilder;
    const lock = JSON.parse(readFileSync(join(gameRoot!, "scripts/storage-inventory.lock.json"), "utf8")) as {
      resources: { name: string; ruid: string }[];
    };
    assets = new Map();
    resourceNames = new Map(lock.resources.map(resource => [resource.ruid, resource.name]));
    for (const resource of lock.resources) {
      const match = /^페른델_(1|2|4)x\1_(.+)_(\d+)$/.exec(resource.name);
      if (match) assets.set(resource.ruid, { ruid: resource.ruid, size: Number(match[1]), material: match[2], variant: match[3] });
    }
    beforeSources = sourceHashes();
  });
  afterAll(() => {
    if (!runRoot) return;
    // Refuse a recursive cleanup unless the resolved target is our own OS temp child.
    if (dirname(runRoot) !== tempParent || !basename(runRoot).startsWith("web-map-editor-store-sync-")) {
      throw new Error("Unsafe test cleanup path");
    }
    const afterSources = sourceHashes();
    const changedSources = [...new Set([...Object.keys(beforeSources), ...Object.keys(afterSources)])]
      .filter(file => beforeSources[file] !== afterSources[file]);
    const evidencePath = runRoot + ".evidence.json";
    writeFileSync(evidencePath, JSON.stringify({
      gameRoot, runRoot, sourceFilesChecked: Object.keys(beforeSources).length,
      changedSources, sourceHashesBefore: beforeSources, sourceHashesAfter: afterSources, maps: evidence,
    }, null, 2));
    console.log("[store-sync-evidence]", evidencePath);
    // KEEP_OUTPUT is diagnostic only; every output is still outside the game and managed workspaces.
    if (process.env.MSW_GAME_SYNC_KEEP_OUTPUT !== "1") rmSync(runRoot, { recursive: true, force: true });
    expect(changedSources, "the test must never change original game inputs").toEqual([]);
  });

  function blocks(map: NativeMap): Block[] {
    return map.listEntities().filter(entity => entity.name.startsWith("Tile_")).map(entity => {
      const coordinate = /^Tile_(\d+)_(\d+)$/.exec(entity.name);
      const ruid = map.component(entity.path, SPRITE)?.SpriteRUID;
      expect(coordinate, entity.path).not.toBeNull();
      expect(typeof ruid, entity.path).toBe("string");
      const asset = assets.get(String(ruid));
      expect(asset, entity.path).toBeDefined();
      return { name: entity.name, gx: Number(coordinate![1]), gy: Number(coordinate![2]), asset: asset! };
    });
  }
  function assertCoverage(map: NativeMap, project: ProjectFile) {
    const actual = new Map<string, string>();
    for (const block of blocks(map)) {
      for (let dy = 0; dy < block.asset.size; dy++) for (let dx = 0; dx < block.asset.size; dx++) {
        const key = [block.gx + dx, block.gy + dy].join(",");
        expect(actual.has(key), "overlapping exported ground cell " + key).toBe(false);
        actual.set(key, materialKey(block.asset));
      }
    }
    const expected = new Map(project.ground.map(([x, y, index]) => {
      const asset = assets.get(project.palette[index].ruid!);
      expect(asset, "registered editable ground material").toBeDefined();
      return [[x, y].join(","), materialKey(asset!)] as const;
    }));
    expect(actual).toEqual(expected); // Independently expanded native rectangles vs editor cells.
  }
  function assertPreviewFile(scene: GamePreviewScene, map: NativeMap) {
    expect(scene.report?.unsupportedSpriteCount).toBe(0);
    for (const sprite of scene.sprites) {
      // Preview and export build separately; new entity UUIDs can differ, native render values cannot.
      const renderer = map.component(sprite.path, SPRITE);
      const transform = map.component(sprite.path, TRANSFORM);
      expect(renderer, sprite.path).toBeDefined();
      expect(transform, sprite.path).toBeDefined();
      expect(renderer!.SpriteRUID).toBe(sprite.ruid);
      expect(transform!.Position).toMatchObject({ x: sprite.position[0], y: sprite.position[1], z: sprite.position[2] });
      expect(transform!.Scale).toMatchObject({ x: sprite.scale[0], y: sprite.scale[1] });
      expect(transform!.QuaternionRotation).toMatchObject({
        x: sprite.quaternion[0], y: sprite.quaternion[1], z: sprite.quaternion[2], w: sprite.quaternion[3],
      });
      expect(renderer!.OrderInLayer ?? 0).toBe(sprite.orderInLayer);
      expect(renderer!.FlipX === true).toBe(sprite.flipX);
      expect(renderer!.FlipY === true).toBe(sprite.flipY);
      expect(renderer!.SortingLayer ?? null).toBe(sprite.sortingLayer);
    }
    expect(scene.sprites.filter(sprite => sprite.kind === "ground")).toHaveLength(blocks(map).length);
  }
  function assertSourceManifest(baselineDir: string) {
    const manifest = JSON.parse(readFileSync(join(baselineDir, "manifest.json"), "utf8")) as {
      sourceFiles: { relative: string; exists: boolean; sha256: string | null }[];
    };
    for (const file of manifest.sourceFiles) {
      const absolute = join(gameRoot!, file.relative);
      expect(existsSync(absolute), file.relative).toBe(file.exists);
      if (file.exists) expect(hash(absolute), file.relative).toBe(file.sha256);
    }
    return manifest.sourceFiles.length;
  }

  for (const mapName of mapNames) {
    it(mapName + ": no-op exact → edit preview/export agreement → undo exact, preserving all other entities", () => {
      const sourceMap = join(gameRoot!, "map", mapName + ".map");
      const beforeMap = hash(sourceMap);
      const original = builder.read(sourceMap);
      expect(original.getTileMapMode()).toBe(1);
      const originalBlocks = blocks(original);
      const synced = core.createSyncProject({ ...options(), mapName });
      expect(synced.report.groundEditingSupported).toBe(true);
      const incoming = memoryTiles(synced.project);
      useEditorStore.getState().newProject();
      const first = incoming[0];
      // A private library and old same-name metadata must never replace actual game palette entries.
      useEditorStore.setState({ palette: [
        { name: "personal-library", ruid: "private-unused", px: [64, 32], img: null, url: "", category: "foothold" },
        ...(first ? [{ ...first, ruid: "stale-ruid", px: [8192, 4096] as [number, number] }] : []),
      ] });
      useEditorStore.getState().loadProject(synced.project, incoming);
      const exported = exportStore();
      expect(exported.gameSync).toEqual(synced.project.gameSync);
      expect(exported.entities).toEqual(synced.project.entities);
      expect(exported.ground).toEqual(synced.project.ground);
      expect(exported.palette.slice(0, incoming.length).map(t => t.ruid)).toEqual(synced.project.palette.map(t => t.ruid));
      expect(exported.palette.slice(incoming.length).map(t => t.ruid)).toContain("private-unused");

      const scene = core.previewEditedProject(exported, options());
      expect(scene.baselineId).toBe(exported.gameSync?.baselineId);
      expect(scene.constants.TILE_W).toBe(2.56);
      for (const sprite of scene.sprites.filter(sprite => sprite.kind === "ground" && sprite.ground)) {
        const block = sprite.ground!;
        const cam = { x: 13, y: 29, zoom: 1.5 };
        const geometry = previewSpriteGeometry(sprite, {
          width: block.size * 256, height: block.size * 128, pivot: [0.5, 0.5], pixelsPerUnit: 100,
        }, scene, cam);
        const expected = cellToScreen(block.gx + (block.size - 1) / 2, block.gy + (block.size - 1) / 2, cam);
        expect(geometry.anchor[0]).toBeCloseTo(expected[0], 7);
        expect(geometry.anchor[1]).toBeCloseTo(expected[1], 7);
        expect(geometry.bounds[2] - geometry.bounds[0]).toBeCloseTo(block.size * 64 * cam.zoom, 7);
      }
      const noOp = core.exportEditedProject(exported, options());
      expect(noOp.report).toMatchObject({
        unchanged: true, exactMapBytes: true, counts: synced.report.counts,
        sourceFilesUnchanged: true, datasetsExact: true, gameApplied: false, runtimeVerified: false,
      });
      expect(hash(noOp.mapPath)).toBe(beforeMap);
      assertCoverage(original, exported);
      assertPreviewFile(scene, builder.read(noOp.mapPath));
      useEditorStore.getState().loadProject(exported, memoryTiles(exported));
      expect(exportStore()).toEqual(exported);

      // Paint inside a largest existing rectangle, forcing a real 4x4/2x2 split when one exists.
      const target = [...originalBlocks].sort((a, b) => b.asset.size - a.asset.size)[0];
      const gx = target.gx + (target.asset.size > 1 ? 1 : 0), gy = target.gy + (target.asset.size > 1 ? 1 : 0);
      const newIndex = exported.palette.findIndex(tile => {
        const asset = assets.get(tile.ruid ?? "");
        return asset?.size === 1 && asset.material !== target.asset.material && asset.material !== "길경계";
      });
      expect(newIndex).toBeGreaterThanOrEqual(0);
      const store = useEditorStore.getState();
      const beforeStroke = { ground: new Map(store.ground), blocked: new Set(store.blocked), entities: store.entities };
      store.setActiveIdx(newIndex);
      store.applyTool(gx, gy);
      store.commitStroke(beforeStroke);
      expect(useEditorStore.getState().dirty).toBe(true);
      const edited = exportStore();
      const differences = edited.ground.filter(([x, y, index]) => {
        const previous = beforeStroke.ground.get([x, y].join(","));
        return previous === undefined || exported.palette[previous].ruid !== edited.palette[index].ruid;
      });
      expect(differences).toEqual([[gx, gy, newIndex]]);
      const editedScene = core.previewEditedProject(edited, options());
      const editedCandidate = core.exportEditedProject(edited, options());
      const nativeEdited = builder.read(editedCandidate.mapPath);
      expect(editedCandidate.report).toMatchObject({ unchanged: false, exactMapBytes: false, changedCells: 1 });
      expect(hash(editedCandidate.mapPath)).not.toBe(beforeMap);
      expect(editedScene.report?.counts).toEqual(editedCandidate.report.counts);
      assertCoverage(nativeEdited, edited);
      assertPreviewFile(editedScene, nativeEdited);
      // Full entity records, including UUIDs, scripts, RUID and Transform, survive outside the touched block.
      const preserved = original.listEntities().filter(entity => entity.name !== target.name);
      for (const entity of preserved) expect(nativeEdited.find(entity.path), entity.path).toEqual(original.find(entity.path));
      expect(nativeEdited.listEntities().filter(entity => !entity.name.startsWith("Tile_")).length)
        .toBe(original.listEntities().filter(entity => !entity.name.startsWith("Tile_")).length);

      useEditorStore.getState().undo();
      const undone = exportStore();
      expect(undone).toEqual(exported);
      const undoScene = core.previewEditedProject(undone, options());
      const undoCandidate = core.exportEditedProject(undone, options());
      expect(undoScene.sprites).toEqual(scene.sprites);
      expect(undoCandidate.report).toMatchObject({ unchanged: true, exactMapBytes: true, counts: synced.report.counts });
      expect(hash(undoCandidate.mapPath)).toBe(beforeMap);
      const sourceFilesChecked = assertSourceManifest(synced.baselineDir);
      expect(hash(sourceMap)).toBe(beforeMap);
      const row = {
        mapName, tileMapMode: 1, before: noOp.report.counts, edited: editedCandidate.report.counts,
        undo: undoCandidate.report.counts, edit: { gx, gy, originalBlockSize: target.asset.size, toRuid: edited.palette[newIndex].ruid },
        protectedEntityRecords: preserved.length, sourceFilesChecked, sourceMapSha256: beforeMap,
        noOpExact: true, undoExact: true, previewExportMatch: true,
        noOpMap: noOp.mapPath, editedMap: editedCandidate.mapPath, undoMap: undoCandidate.mapPath,
      };
      evidence.push(row);
      console.log("[store-sync-roundtrip]", JSON.stringify(row));

      useEditorStore.setState({ entities: [
        ...useEditorStore.getState().entities,
        { id: "unsupported-extra", kind: "object", gx: 0, gy: 0, ruid: "test", name: "unsupported" },
      ] });
      expect(() => core.exportEditedProject(exportStore(), options())).toThrow("보호된 원본 항목");
    }, 60_000);
  }

  for (const mapName of specialMaps) {
    it.skipIf(!existsSync(join(gameRoot ?? "", "map", mapName + ".map")))(mapName + ": support scope is explicit; untouched output stays exact", () => {
      const sourceMap = join(gameRoot!, "map", mapName + ".map");
      const original = builder.read(sourceMap);
      expect(original.getTileMapMode()).toBe(1);
      const synced = core.createSyncProject({ ...options(), mapName });
      expect(typeof synced.report.groundEditingSupported).toBe("boolean");
      expect(synced.report.warnings.length).toBeGreaterThan(0);
      const project = synced.project as ProjectFile;
      const scene = core.previewEditedProject(project, options());
      const candidate = core.exportEditedProject(project, options());
      expect(candidate.report.exactMapBytes).toBe(true);
      expect(hash(candidate.mapPath)).toBe(hash(sourceMap));
      const output = builder.read(candidate.mapPath);
      for (const entity of original.listEntities()) expect(output.find(entity.path)).toEqual(original.find(entity.path));
      if (!synced.report.groundEditingSupported) {
        const edited = JSON.parse(JSON.stringify(project)) as ProjectFile;
        if (edited.ground.length) edited.ground.pop();
        else {
          const leaf = [...assets.values()].find(asset => asset.size === 1)!;
          edited.palette.push({ name: "unsupported-edit-probe", ruid: leaf.ruid, px: [256, 128] });
          edited.ground.push([0, 0, edited.palette.length - 1]);
        }
        expect(() => core.previewEditedProject(edited, options())).toThrow("바닥 편집은 지원하지 않습니다");
        expect(() => core.exportEditedProject(edited, options())).toThrow("바닥 편집은 지원하지 않습니다");
      }
      const mineFloorObjects = original.listEntities().filter(entity =>
        /광산바닥/.test(resourceNames.get(String(original.component(entity.path, SPRITE)?.SpriteRUID)) ?? ""));
      const row = {
        mapName, groundEditingSupported: synced.report.groundEditingSupported, reasons: synced.report.warnings,
        editableCellScope: synced.report.groundEditingSupported ? project.ground.map(([x, y]) => [x, y]) : [],
        protectedMineFloorObjects: mineFloorObjects.map(entity => entity.name),
        counts: synced.report.counts, visibleSprites: scene.sprites.length,
        unsupportedSpriteCount: scene.report?.unsupportedSpriteCount, warnings: scene.warnings,
        preservedEntityRecords: original.listEntities().length, noOpExact: true,
        noOpMap: candidate.mapPath, sourceFilesChecked: assertSourceManifest(synced.baselineDir),
      };
      evidence.push(row);
      console.log("[store-sync-special-map]", JSON.stringify(row));
    }, 60_000);
  }
  type ObjectScene = GamePreviewScene & { objects: GameObjectDescriptor[]; objectPrototypes: GameObjectDescriptor[] };
  type NativeRecord = { id: string; path: string; jsonString: { name: string; path: string; "@components": Record<string, unknown>[] } };
  const depthType = "script.IsoDepthMetaComponent";
  const cloneValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  function componentsWithoutMove(map: NativeMap, name: string) {
    const entity = map.find(name) as NativeRecord;
    const result = cloneValue(entity.jsonString["@components"]);
    for (const component of result) {
      if (component["@type"] === TRANSFORM) delete component.Position;
      if (component["@type"] === depthType) {
        delete component.GX; delete component.GY; delete component.StaticZ;
      }
    }
    return result;
  }
  function assertObjectTranslation(
    original: NativeMap, output: NativeMap, from: string, to: string, dx: number, dy: number, scene: GamePreviewScene,
  ) {
    const before = original.component(from, TRANSFORM)!;
    const after = output.component(to, TRANSFORM)!;
    const oldPosition = before.Position as { x: number; y: number; z: number };
    const newPosition = after.Position as { x: number; y: number; z: number };
    expect(newPosition.x).toBeCloseTo(oldPosition.x + dx, 9);
    expect(newPosition.y).toBeCloseTo(oldPosition.y + dy, 9);
    expect(newPosition.z).toBeCloseTo(oldPosition.z + dy * scene.constants.DEPTH_SCALE, 9);
    expect(componentsWithoutMove(output, to)).toEqual(componentsWithoutMove(original, from));
    const oldDepth = original.component(from, depthType), newDepth = output.component(to, depthType);
    if (oldDepth) {
      expect(newDepth).toBeDefined();
      expect(newDepth!.GX).toBe(Number(oldDepth.GX) + Math.round(dx / scene.constants.TILE_W - dy / scene.constants.TILE_H));
      expect(newDepth!.GY).toBe(Number(oldDepth.GY) + Math.round(-dx / scene.constants.TILE_W - dy / scene.constants.TILE_H));
      expect(newDepth!.StaticZ).toBeCloseTo(newPosition.z, 9);
    } else expect(newDepth).toBe(oldDepth);
  }
  const csvLines = (file: string) => readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);

  for (const mapName of ["ferendel", "ferenforest", "ferendelmotel", "ironhallmine", "lumiatemple"]) {
    it(mapName + ": move/clone/delete + explicit blocked edits export together, then undo restores native map and walk data", () => {
      const synced = core.createSyncProject({ ...options(), mapName });
      const sourceMap = join(gameRoot!, "map", mapName + ".map");
      const beforeMap = hash(sourceMap);
      const original = builder.read(sourceMap);
      expect(original.getTileMapMode()).toBe(1);
      useEditorStore.getState().newProject();
      useEditorStore.setState({ palette: [] });
      useEditorStore.getState().loadProject(synced.project, memoryTiles(synced.project));
      const baseline = exportStore();
      const baselineScene = core.previewEditedProject(baseline, options()) as ObjectScene;
      expect(baselineScene.objects.length).toBeGreaterThan(1);
      const originals = original.listEntities().filter(entity => entity.name.startsWith("Obj_"));
      const editable = originals.filter(entity => {
        const source = baseline.entities.find(item => entity.name === "Obj_" + item.id.slice(0, 8));
        const roomForBothMoves = !!source && (source.gx + 1 < baseline.size[0] || source.gx > 0) && source.gy + 1 < baseline.size[1];
        return roomForBothMoves && baselineScene.objects.some(object =>
          object.entityId === entity.id && object.canMove && object.canDuplicate && object.canDelete);
      });
      const wantsFloor = mapName === "ironhallmine" || mapName === "lumiatemple";
      const mover = wantsFloor
        ? editable.find(entity => /바닥/.test(resourceNames.get(String(original.component(entity.path, SPRITE)?.SpriteRUID)) ?? ""))
        : editable.find(entity => {
          const transform = original.component(entity.path, TRANSFORM);
          return original.component(entity.path, depthType) &&
            Math.abs(Number((transform?.QuaternionRotation as { z?: number })?.z ?? 0)) > 0;
        }) ?? editable.find(entity => !!original.component(entity.path, depthType));
      expect(mover, mapName + " representative native object").toBeDefined();
      const removed = editable.find(entity => entity.id !== mover!.id)!;
      const transform = original.component(mover!.path, TRANSFORM)!;
      const position = transform.Position as { x: number; y: number; z: number };
      // One GX step (inward at the map edge), and a separate +GY clone step.
      const source = baseline.entities.find(item => mover!.name === "Obj_" + item.id.slice(0, 8))!;
      const direction = source.gx + 1 < baseline.size[0] ? 1 : -1;
      const dx = direction * baselineScene.constants.TILE_W / 2, dy = -direction * baselineScene.constants.TILE_H / 2;
      const cloneDx = -baselineScene.constants.TILE_W / 2, cloneDy = -baselineScene.constants.TILE_H / 2;
      useEditorStore.getState().moveGameObjectTo(mover!.id, [position.x + dx, position.y + dy]);
      const cloneId = useEditorStore.getState().addGameObject(mover!.id, [position.x + cloneDx, position.y + cloneDy]);
      expect(cloneId).not.toBeNull();
      useEditorStore.getState().removeGameObject(removed.id);
      // Collision cells are authored explicitly, with no guessed ownership or automatic object migration.
      const blockedBefore = captureEditorSnapshot(useEditorStore.getState());
      const removeCell = baseline.blocked[0];
      expect(removeCell).toBeDefined();
      const occupied = new Set(baseline.blocked.map(cell => cell.join(",")));
      let addCell: [number, number] | undefined;
      for (let y = 0; y < baseline.size[1] && !addCell; y++) for (let x = 0; x < baseline.size[0]; x++) {
        if (!occupied.has([x, y].join(","))) { addCell = [x, y]; break; }
      }
      expect(addCell).toBeDefined();
      useEditorStore.getState().setBlockedAt(removeCell[0], removeCell[1], false);
      useEditorStore.getState().setBlockedAt(addCell![0], addCell![1], true);
      useEditorStore.getState().commitStroke(blockedBefore);
      const edited = exportStore();
      expect(edited.entities).toEqual(baseline.entities);
      expect(edited.ground).toEqual(baseline.ground);
      expect(edited.gameObjectEdits).toMatchObject({
        moved: [{ entityId: mover!.id, position: [position.x + dx, position.y + dy] }],
        removed: [removed.id],
        added: [{ entityId: cloneId, prototypeId: mover!.id, position: [position.x + cloneDx, position.y + cloneDy] }],
      });
      const preview = core.previewEditedProject(cloneValue(edited), options()) as ObjectScene;
      const candidate = core.exportEditedProject(cloneValue(edited), options());
      const output = builder.read(candidate.mapPath);
      const cloneName = "Obj_Editor_" + cloneId;
      const cloneEntity = output.listEntities().find(entity => entity.name === cloneName)!;
      expect(cloneEntity).toBeDefined();
      expect(output.listEntities()).toHaveLength(original.listEntities().length);
      expect(cloneEntity.id).not.toBe(mover!.id);
      expect(output.listEntities().filter(entity => entity.id === cloneEntity.id)).toHaveLength(1);
      expect(output.listEntities().find(entity => entity.id === mover!.id)?.path).toBe(mover!.path);
      expect(output.listEntities().some(entity => entity.id === removed.id)).toBe(false);
      assertObjectTranslation(original, output, mover!.path, mover!.path, dx, dy, baselineScene);
      assertObjectTranslation(original, output, mover!.path, cloneEntity.path, cloneDx, cloneDy, baselineScene);
      const movedRecord = cloneValue(output.find(mover!.path) as NativeRecord);
      const originalRecord = original.find(mover!.path) as NativeRecord;
      // Components are checked above; all outer/native identity and metadata must remain untouched.
      movedRecord.jsonString["@components"] = cloneValue(originalRecord.jsonString["@components"]);
      expect(movedRecord).toEqual(originalRecord);
      const unchanged = original.listEntities().filter(entity => entity.id !== mover!.id && entity.id !== removed.id);
      for (const entity of unchanged) expect(output.find(entity.path), entity.path).toEqual(original.find(entity.path));
      expect(preview.objects.find(object => object.entityId === cloneId)?.prototypeId).toBe(mover!.id);
      expect(preview.objects.some(object => object.entityId === removed.id)).toBe(false);
      assertPreviewFile(preview, output);
      expect(candidate.report.exactMapBytes).toBe(false);
      expect(candidate.report.walkEditingSupported).toBe(true);
      expect(candidate.report.walkChangedCells).toBe(2);

      const walkRelative = candidate.report.applyFiles?.find(file => file.endsWith("/DT_Walk.csv"));
      expect(walkRelative, "changed collision cells must be an applicable candidate, not just a reference copy").toBeDefined();
      const sourceWalk = join(gameRoot!, walkRelative!);
      const candidateWalk = join(candidate.candidateDir, walkRelative!);
      const sourceRows = csvLines(sourceWalk), candidateRows = csvLines(candidateWalk);
      const belongs = (line: string) => line.split(",")[0] === baseline.map;
      expect(candidateRows.filter(line => !belongs(line))).toEqual(sourceRows.filter(line => !belongs(line)));
      expect(new Set(candidateRows.filter(belongs).map(line => line.split(",").slice(1).map(Number).join(","))))
        .toEqual(new Set(edited.blocked.map(cell => cell.join(","))));
      expect(candidateRows.filter(belongs)).toHaveLength(edited.blocked.length);
      expect(hash(join(candidate.candidateDir, "reference", walkRelative!))).toBe(hash(sourceWalk));

      for (let step = 0; step < 4; step++) useEditorStore.getState().undo();
      const undone = exportStore();
      expect(undone).toEqual(baseline);
      const undoScene = core.previewEditedProject(undone, options());
      const undoCandidate = core.exportEditedProject(undone, options());
      expect(undoScene.sprites).toEqual(baselineScene.sprites);
      expect(undoCandidate.report.exactMapBytes).toBe(true);
      expect(hash(undoCandidate.mapPath)).toBe(beforeMap);
      expect(undoCandidate.report.applyFiles).not.toContain(walkRelative);
      expect(hash(join(undoCandidate.candidateDir, "reference", walkRelative!))).toBe(hash(sourceWalk));
      const sourceFilesChecked = assertSourceManifest(synced.baselineDir);
      const row = {
        scenario: "object-and-walk", mapName, moved: mover!.name, deleted: removed.name, cloned: cloneName,
        asset: resourceNames.get(String(original.component(mover!.path, SPRITE)?.SpriteRUID)),
        hasDepthMeta: !!original.component(mover!.path, depthType),
        cloneNativeId: cloneEntity.id, preservedEntityRecords: unchanged.length,
        walkRemoved: removeCell, walkAdded: addCell, walkChangedCells: candidate.report.walkChangedCells,
        candidateMap: candidate.mapPath, candidateWalk, undoMap: undoCandidate.mapPath,
        previewExportMatch: true, undoExact: true, sourceFilesChecked,
      };
      evidence.push(row);
      console.log("[object-walk-roundtrip]", JSON.stringify(row));
    }, 60_000);
  }

  for (const mapName of ["ferendelmotel", "ironhallmine", "lumiatemple"]) {
    it(mapName + ": atomic groups move/copy/delete explicit collision cells, survive save/reload, and undo together", () => {
      const synced = core.createSyncProject({ ...options(), mapName });
      useEditorStore.getState().loadProject(synced.project, memoryTiles(synced.project));
      const baseline = exportStore();
      const baselineScene = core.previewEditedProject(baseline, options()) as ObjectScene;
      const originalPath = join(gameRoot!, "map", mapName + ".map");
      const original = builder.read(originalPath), originalHash = hash(originalPath);
      expect(original.getTileMapMode()).toBe(1);
      const selectedObjects = baselineScene.objects.filter(object =>
        object.canMove && object.canDuplicate && object.canDelete &&
        (mapName === "ferendelmotel" ? /탁자/.test(object.name) : /바닥/.test(object.name))).slice(0, 2);
      expect(selectedObjects).toHaveLength(2);
      const ids = selectedObjects.map(object => object.entityId);
      const nativeObjects = ids.map(id => original.listEntities().find(entity => entity.id === id)!);
      expect(nativeObjects.every(Boolean)).toBe(true);
      const baselineBlocked = new Set(baseline.blocked.map(([x, y]) => cellKey(x, y)));
      // Select two existing cells with genuinely empty left neighbours; no collision ownership is inferred.
      const cells = baseline.blocked.filter(([x, y]) => x > 0 && !baselineBlocked.has(cellKey(x - 1, y))).slice(0, 2);
      expect(cells).toHaveLength(2);
      const keys = cells.map(([x, y]) => cellKey(x, y));
      const targetKeys = cells.map(([x, y]) => cellKey(x - 1, y));
      const delta: [number, number] = [-1, 0];
      const dx = -baselineScene.constants.TILE_W / 2, dy = baselineScene.constants.TILE_H / 2;
      const select = (selectedCells = keys) => {
        useEditorStore.getState().selectGameObjects(ids);
        useEditorStore.getState().selectBlockedCells(selectedCells);
        expect(useEditorStore.getState().selectedGameObjectIds).toEqual(ids);
        expect(useEditorStore.getState().selectedBlockedCells).toEqual(selectedCells);
      };
      const assertRejected = (scene: ObjectScene, offset: [number, number], reason: string) => {
        const before = exportStore(), state = useEditorStore.getState();
        const counters = [state.undoStack.length, state.gameObjectsVer, state.blockedVer, state.dirty];
        expect(state.transformGameSelection("move", scene, offset)).toBe(false);
        expect(exportStore()).toEqual(before);
        const after = useEditorStore.getState();
        expect([after.undoStack.length, after.gameObjectsVer, after.blockedVer, after.dirty]).toEqual(counters);
        expect(after.gameSelectionError).toContain(reason);
      };
      select();
      assertRejected(baselineScene, [-baseline.size[0], 0], "경계");
      const overlap = baseline.blocked.find(([x, y]) => x > 0 && baselineBlocked.has(cellKey(x - 1, y)))!;
      expect(overlap).toBeDefined();
      select([cellKey(...overlap)]);
      assertRejected(baselineScene, delta, "겹칩니다");
      select();
      const protectedScene = cloneValue(baselineScene);
      for (const collection of [protectedScene.objects, protectedScene.objectPrototypes]) {
        const protectedObject = collection.find(object => object.entityId === ids[1])!;
        protectedObject.canMove = false;
        protectedObject.reason = "통합 검증용 보호 대상";
      }
      assertRejected(protectedScene, delta, "보호 대상");

      for (const operation of ["move", "duplicate", "delete"] as const) {
        useEditorStore.getState().loadProject(baseline, memoryTiles(baseline));
        select();
        expect(useEditorStore.getState().undoStack).toHaveLength(0);
        expect(useEditorStore.getState().transformGameSelection(operation, baselineScene, delta)).toBe(true);
        expect(useEditorStore.getState().undoStack).toHaveLength(1);
        expect(useEditorStore.getState().gameSelectionError).toBeNull();
        const edited = exportStore();
        expect(edited.entities).toEqual(baseline.entities);
        expect(edited.ground).toEqual(baseline.ground);
        const expectedBlocked = new Set(baselineBlocked);
        if (operation !== "duplicate") for (const key of keys) expectedBlocked.delete(key);
        if (operation !== "delete") for (const key of targetKeys) expectedBlocked.add(key);
        expect(new Set(edited.blocked.map(([x, y]) => cellKey(x, y)))).toEqual(expectedBlocked);
        for (const key of baselineBlocked) if (!keys.includes(key)) {
          expect(expectedBlocked.has(key), "unselected collision cell " + key).toBe(true);
        }
        const overlay = edited.gameObjectEdits!;
        expect(overlay.moved).toHaveLength(operation === "move" ? 2 : 0);
        expect(overlay.added).toHaveLength(operation === "duplicate" ? 2 : 0);
        expect(overlay.removed).toHaveLength(operation === "delete" ? 2 : 0);
        if (operation === "move") assertRejected(baselineScene, delta, "미리보기");
        const preview = core.previewEditedProject(edited, options()) as ObjectScene;
        const candidate = core.exportEditedProject(edited, options());
        const output = builder.read(candidate.mapPath);
        assertPreviewFile(preview, output);
        expect(output.listEntities()).toHaveLength(original.listEntities().length + (operation === "duplicate" ? 2 : operation === "delete" ? -2 : 0));
        for (const entity of nativeObjects) {
          if (operation === "move") {
            expect(output.listEntities().find(item => item.path === entity.path)?.id).toBe(entity.id);
            assertObjectTranslation(original, output, entity.path, entity.path, dx, dy, baselineScene);
            const movedRecord = cloneValue(output.find(entity.path) as NativeRecord);
            const beforeRecord = original.find(entity.path) as NativeRecord;
            movedRecord.jsonString["@components"] = cloneValue(beforeRecord.jsonString["@components"]);
            expect(movedRecord).toEqual(beforeRecord);
          } else if (operation === "delete") expect(output.find(entity.path)).toBeNull();
          else {
            expect(output.find(entity.path)).toEqual(original.find(entity.path));
            const added = overlay.added.find(item => item.prototypeId === entity.id)!;
            const copy = output.listEntities().find(item => item.name === "Obj_Editor_" + added.entityId)!;
            expect(copy).toBeDefined();
            expect(original.listEntities().some(item => item.id === copy.id)).toBe(false);
            assertObjectTranslation(original, output, entity.path, copy.path, dx, dy, baselineScene);
          }
        }
        const untouched = original.listEntities().filter(entity => operation === "duplicate" || !ids.includes(entity.id));
        for (const entity of untouched) expect(output.find(entity.path), entity.path).toEqual(original.find(entity.path));
        const walkRelative = (candidate.report.applyFiles ?? []).find(file => file.endsWith("/DT_Walk.csv"))!;
        expect(walkRelative).toBeDefined();
        const sourceWalk = join(gameRoot!, walkRelative), candidateWalk = join(candidate.candidateDir, walkRelative);
        const sourceRows = csvLines(sourceWalk), candidateRows = csvLines(candidateWalk);
        const belongs = (line: string) => line.split(",")[0] === baseline.map;
        expect(candidateRows.filter(line => !belongs(line))).toEqual(sourceRows.filter(line => !belongs(line)));
        expect(new Set(candidateRows.filter(belongs).map(line => line.split(",").slice(1).join(",")))).toEqual(expectedBlocked);
        expect(candidateRows.filter(belongs)).toHaveLength(expectedBlocked.size);
        expect(candidate.report.walkChangedCells).toBe(operation === "move" ? 4 : 2);
        expect(hash(join(candidate.candidateDir, "reference", walkRelative))).toBe(hash(sourceWalk));

        const savedPath = join(runRoot, mapName + "-group-" + operation + ".json");
        writeFileSync(savedPath, JSON.stringify(edited));
        useEditorStore.getState().undo(); // One history entry must restore objects AND explicit collision cells.
        expect(exportStore()).toEqual(baseline);
        const undone = core.exportEditedProject(exportStore(), options());
        expect(hash(undone.mapPath)).toBe(originalHash);
        expect(undone.report.exactMapBytes).toBe(true);
        expect(undone.report.applyFiles).not.toContain(walkRelative);
        expect(hash(join(undone.candidateDir, "reference", walkRelative))).toBe(hash(sourceWalk));

        const reopened = JSON.parse(readFileSync(savedPath, "utf8")) as ProjectFileInput;
        useEditorStore.getState().loadProject(reopened, memoryTiles(reopened));
        expect(exportStore()).toEqual(edited);
        expect(useEditorStore.getState().selectedGameObjectIds).toEqual([]);
        expect(useEditorStore.getState().selectedBlockedCells).toEqual([]);
        expect(useEditorStore.getState().undoStack).toHaveLength(0);
        const reloadScene = core.previewEditedProject(exportStore(), options()) as ObjectScene;
        const reloadCandidate = core.exportEditedProject(exportStore(), options());
        assertPreviewFile(reloadScene, builder.read(reloadCandidate.mapPath));
        const rendered = (scene: ObjectScene) => scene.sprites.map(sprite => Object.fromEntries(Object.entries(sprite).filter(([key]) => key !== "id")));
        expect(rendered(reloadScene)).toEqual(rendered(preview));
        expect(hash(join(reloadCandidate.candidateDir, walkRelative))).toBe(hash(candidateWalk));
        const row = {
          scenario: "atomic-group-and-walk", mapName, operation, selectedObjects: nativeObjects.map(entity => entity.name),
          selectedCells: cells, targetCells: operation === "delete" ? [] : cells.map(([x, y]) => [x - 1, y]),
          preservedEntityRecords: untouched.length, walkChangedCells: candidate.report.walkChangedCells,
          candidateMap: candidate.mapPath, candidateWalk, undoMap: undone.mapPath, savedProject: savedPath,
          reloadedMap: reloadCandidate.mapPath, previewExportMatch: true, oneUndoExact: true, saveReloadExact: true,
          sourceFilesChecked: assertSourceManifest(synced.baselineDir),
        };
        evidence.push(row);
        console.log("[atomic-group-roundtrip]", JSON.stringify(row));
      }
    }, 90_000);
  }

  type CompareBlock = { name: string; gx: number; gy: number; size: number; ruid: string };
  type Comparison = {
    version: 1; baselineId: string; mapName: string;
    ground: {
      changedCells: { gx: number; gy: number; beforeRuid: string | null; afterRuid: string | null }[];
      repackedCells: [number, number][]; affectedBeforeBlocks: CompareBlock[]; replacementBlocks: CompareBlock[];
    };
    objects: {
      moved: { entityId: string; from: [number, number, number]; to: [number, number, number] }[];
      added: { entityId: string; prototypeId: string; position: [number, number, number] }[];
      removed: { entityId: string; position: [number, number, number] }[];
    };
    blocked: { added: [number, number][]; removed: [number, number][] };
  };
  type OriginalPreview = {
    version: 1; baselineId: string; mapName: string; size: [number, number]; groundOrigin: [number, number];
    scene: ObjectScene; ground: [number, number, string][]; blocked: [number, number][];
  };
  const comparisonCore = core as Core & {
    previewBaselineProject(input: { mapName: string; baselineId: string }, options: Options): OriginalPreview;
    compareEditedProject(project: ProjectFile, options: Options): { scene: ObjectScene; comparison: Comparison };
  };
  function directoryHashes(root: string): Record<string, string> {
    const entries: [string, string][] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) visit(file);
        else entries.push([file, hash(file)]);
      }
    };
    visit(root);
    return Object.fromEntries(entries);
  }
  const differenceLengths = (comparison: Comparison) => [
    comparison.ground.changedCells.length, comparison.ground.repackedCells.length,
    comparison.ground.affectedBeforeBlocks.length, comparison.ground.replacementBlocks.length,
    comparison.objects.moved.length, comparison.objects.added.length, comparison.objects.removed.length,
    comparison.blocked.added.length, comparison.blocked.removed.length,
  ];
  for (const mapName of ["ferendelmotel", "ferendel", "ironhallmine"]) {
    it(mapName + ": original/diff previews stay read-only and agree with mixed edited native output and undo", () => {
      const synced = core.createSyncProject({ ...options(), mapName });
      useEditorStore.getState().loadProject(synced.project, memoryTiles(synced.project));
      const baseline = exportStore();
      const link = { mapName, baselineId: baseline.gameSync!.baselineId };
      // If a preview accidentally exports, it would have to create this unused destination.
      const readOnlyOptions = { ...options(), outputRoot: join(runRoot, mapName + "-preview-must-not-write") };
      const snapshotHashes = directoryHashes(synced.baselineDir);
      const assertReadOnly = () => {
        expect(existsSync(readOnlyOptions.outputRoot)).toBe(false);
        expect(directoryHashes(synced.baselineDir)).toEqual(snapshotHashes);
      };
      const original = builder.read(join(gameRoot!, "map", mapName + ".map"));
      expect(original.getTileMapMode()).toBe(1);
      const originalPreview = comparisonCore.previewBaselineProject(link, readOnlyOptions);
      expect(originalPreview).toMatchObject({ version: 1, ...link, size: baseline.size, groundOrigin: baseline.groundOrigin });
      assertPreviewFile(originalPreview.scene, original);
      expect(new Map(originalPreview.ground.map(([x, y, ruid]) => [cellKey(x, y), ruid])))
        .toEqual(new Map(baseline.ground.map(([x, y, index]) => [cellKey(x, y), baseline.palette[index].ruid])));
      expect(new Set(originalPreview.blocked.map(([x, y]) => cellKey(x, y))))
        .toEqual(new Set(baseline.blocked.map(([x, y]) => cellKey(x, y))));
      const noOp = comparisonCore.compareEditedProject(baseline, readOnlyOptions);
      expect(noOp.comparison).toMatchObject({ version: 1, ...link });
      expect(differenceLengths(noOp.comparison)).toEqual(Array(9).fill(0));
      expect(noOp.scene.sprites).toEqual(originalPreview.scene.sprites);
      assertReadOnly();

      const editable = originalPreview.scene.objects.filter(object => object.canMove && object.canDuplicate && object.canDelete &&
        (mapName !== "ironhallmine" || /바닥/.test(object.name)));
      const mover = editable[0], removed = editable[1];
      expect(mover).toBeDefined(); expect(removed).toBeDefined();
      const dx = originalPreview.scene.constants.TILE_W / 2, dy = -originalPreview.scene.constants.TILE_H / 2;
      useEditorStore.getState().moveGameObjectTo(mover.entityId, [mover.position[0] + dx, mover.position[1] + dy]);
      const copyId = useEditorStore.getState().addGameObject(mover.entityId, [mover.position[0] - dx, mover.position[1] + dy]);
      expect(copyId).not.toBeNull();
      useEditorStore.getState().removeGameObject(removed.entityId);
      const beforeBlocked = captureEditorSnapshot(useEditorStore.getState());
      const removedCell = baseline.blocked[0];
      const occupied = new Set(baseline.blocked.map(([x, y]) => cellKey(x, y)));
      let addedCell: [number, number] | undefined;
      for (let y = 0; y < baseline.size[1] && !addedCell; y++) for (let x = 0; x < baseline.size[0]; x++) {
        if (!occupied.has(cellKey(x, y))) { addedCell = [x, y]; break; }
      }
      expect(addedCell).toBeDefined();
      useEditorStore.getState().setBlockedAt(...removedCell, false);
      useEditorStore.getState().setBlockedAt(...addedCell!, true);
      useEditorStore.getState().commitStroke(beforeBlocked);

      const beforeGroundBlocks = mapName === "ironhallmine" ? [] : blocks(original);
      const changedBlock = beforeGroundBlocks.find(block => block.asset.size === 4);
      let painted: { gx: number; gy: number; beforeRuid: string; afterRuid: string } | undefined;
      if (mapName !== "ironhallmine") {
        expect(changedBlock, "representative map must exercise a real 4x4 split").toBeDefined();
        const target = changedBlock!;
        const gx = target.gx + 1, gy = target.gy + 1;
        const index = baseline.palette.findIndex(tile => {
          const asset = assets.get(tile.ruid ?? "");
          return asset?.size === 1 && asset.material !== target.asset.material && asset.material !== "길경계";
        });
        expect(index).toBeGreaterThanOrEqual(0);
        const before = captureEditorSnapshot(useEditorStore.getState());
        useEditorStore.getState().setActiveIdx(index);
        useEditorStore.getState().setTool("brush");
        useEditorStore.getState().applyTool(gx, gy);
        useEditorStore.getState().commitStroke(before);
        painted = { gx, gy, beforeRuid: originalPreview.ground.find(([x, y]) => x === gx && y === gy)![2], afterRuid: baseline.palette[index].ruid! };
      }
      const edited = exportStore();
      const result = comparisonCore.compareEditedProject(edited, readOnlyOptions);
      const comparison = result.comparison;
      expect(comparison.objects.moved).toHaveLength(1);
      expect(comparison.objects.added).toHaveLength(1);
      expect(comparison.objects.removed).toEqual([{ entityId: removed.entityId, position: removed.position }]);
      expect(comparison.blocked).toEqual({ added: [addedCell], removed: [removedCell] });
      expect(comparison.objects.moved[0]).toMatchObject({ entityId: mover.entityId, from: mover.sourcePosition });
      expect(comparison.objects.added[0]).toMatchObject({ entityId: copyId, prototypeId: mover.entityId });
      expect(comparison.objects.moved[0].to).toEqual(result.scene.objects.find(object => object.entityId === mover.entityId)!.position);
      expect(comparison.objects.added[0].position).toEqual(result.scene.objects.find(object => object.entityId === copyId)!.position);
      expect(result.scene.objects.some(object => object.entityId === removed.entityId)).toBe(false);
      if (painted) {
        expect(comparison.ground.changedCells).toEqual([painted]);
        const target = changedBlock!;
        const affectedCells = Array.from({ length: 16 }, (_, index) => [target.gx + index % 4, target.gy + Math.floor(index / 4)] as [number, number]);
        const repacked = affectedCells.filter(([x, y]) => x !== painted!.gx || y !== painted!.gy);
        expect(new Set(comparison.ground.repackedCells.map(([x, y]) => cellKey(x, y))))
          .toEqual(new Set(repacked.map(([x, y]) => cellKey(x, y))));
        expect(comparison.ground.repackedCells).toHaveLength(15);
        expect(comparison.ground.affectedBeforeBlocks).toEqual([{ name: target.name, gx: target.gx, gy: target.gy, size: 4, ruid: target.asset.ruid }]);
      } else {
        expect(comparison.ground).toEqual({ changedCells: [], repackedCells: [], affectedBeforeBlocks: [], replacementBlocks: [] });
      }

      // Editing and removal never mutate the original DTO, including the deleted sprite's RUID.
      const originalAgain = comparisonCore.previewBaselineProject(link, readOnlyOptions);
      expect(originalAgain).toEqual(originalPreview);
      const removedOriginalSprite = originalAgain.scene.sprites.find(sprite => sprite.objectEntityId === removed.entityId)!;
      const removedNative = original.listEntities().find(entity => entity.id === removed.entityId)!;
      expect(removedOriginalSprite.ruid).toBe(original.component(removedNative.path, SPRITE)!.SpriteRUID);
      expect(result.scene.sprites.some(sprite => sprite.objectEntityId === removed.entityId)).toBe(false);
      assertReadOnly();

      const candidate = core.exportEditedProject(edited, options());
      const output = builder.read(candidate.mapPath);
      assertPreviewFile(result.scene, output);
      if (painted) {
        assertCoverage(output, edited);
        const target = changedBlock!;
        const replacements = blocks(output).filter(block =>
          block.gx >= target.gx && block.gx < target.gx + 4 && block.gy >= target.gy && block.gy < target.gy + 4)
          .map(block => ({ name: block.name, gx: block.gx, gy: block.gy, size: block.asset.size, ruid: block.asset.ruid }));
        expect([...comparison.ground.replacementBlocks].sort((a, b) => a.name.localeCompare(b.name)))
          .toEqual(replacements.sort((a, b) => a.name.localeCompare(b.name)));
        expect(candidate.report.counts.groundEntities).toBe(beforeGroundBlocks.length - 1 + replacements.length);
      }
      const undoSteps = useEditorStore.getState().undoStack.length;
      expect(undoSteps).toBe(painted ? 5 : 4);
      for (let step = 0; step < undoSteps; step++) useEditorStore.getState().undo();
      expect(exportStore()).toEqual(baseline);
      const undoComparison = comparisonCore.compareEditedProject(exportStore(), readOnlyOptions);
      expect(differenceLengths(undoComparison.comparison)).toEqual(Array(9).fill(0));
      expect(undoComparison.scene.sprites).toEqual(originalPreview.scene.sprites);
      const undoCandidate = core.exportEditedProject(exportStore(), options());
      expect(hash(undoCandidate.mapPath)).toBe(hash(join(gameRoot!, "map", mapName + ".map")));
      assertReadOnly();
      const row = {
        scenario: "original-and-comparison", mapName, baselineId: link.baselineId,
        changedGroundCells: comparison.ground.changedCells.length, repackedCells: comparison.ground.repackedCells.length,
        affectedBeforeBlocks: comparison.ground.affectedBeforeBlocks.length, replacementBlocks: comparison.ground.replacementBlocks.length,
        objectChanges: { moved: comparison.objects.moved.length, added: comparison.objects.added.length, removed: comparison.objects.removed.length },
        blockedChanges: comparison.blocked, candidateMap: candidate.mapPath, undoMap: undoCandidate.mapPath,
        originalPreviewUnchanged: true, deletedSpriteRuidPreserved: true, previewCreatedNoCandidates: true,
        baselineSnapshotHashesUnchanged: Object.keys(snapshotHashes).length, previewExportMatch: true, undoDiffZero: true,
        sourceFilesChecked: assertSourceManifest(synced.baselineDir),
      };
      evidence.push(row);
      console.log("[comparison-roundtrip]", JSON.stringify(row));
    }, 90_000);
  }

  type CandidateSummary = {
    groundChangedCells: number; groundRepackedCells: number;
    objectsMoved: number; objectsAdded: number; objectsRemoved: number;
    blockedAdded: number; blockedRemoved: number; walkChangedCells: number;
  };
  type CandidateReview = {
    candidateId: string; mapName: string; baselineId: string; createdAt: string; checkedAt: string;
    status: "ready" | "blocked"; candidateDir: string; gameApplied: false; runtimeVerified: false;
    files: { path: string; bytes: number; sourceSha256: string; candidateSha256: string;
      currentSourceSha256: string | null; currentCandidateSha256: string | null;
      sourceMatches: boolean; candidateMatches: boolean }[];
    referenceFiles: number; checks: { label: string; passed: boolean; detail?: string }[];
    issues: string[]; summary: CandidateSummary;
  };
  const reviewCore = core as Omit<Core, "exportEditedProject"> & {
    exportEditedProject(project: ProjectFile, options: Options): ReturnType<Core["exportEditedProject"]> & { candidateId: string };
    reviewCandidate(input: { candidateId: string; mapName: string; baselineId: string }, options: Options): CandidateReview;
  };
  type MutableCandidateMap = NativeMap & {
    patchComponent(name: string, type: string, fields: Record<string, unknown>): MutableCandidateMap;
    write(path: string): MutableCandidateMap;
  };
  for (const mapName of ["ferendelmotel", "ferendel"]) {
    it(mapName + ": candidate review matches actual mixed output, is read-only, and blocks tampered candidate files", () => {
      const synced = core.createSyncProject({ ...options(), mapName });
      useEditorStore.getState().loadProject(synced.project, memoryTiles(synced.project));
      const baseline = exportStore();
      const scene = core.previewEditedProject(baseline, options()) as ObjectScene;
      const editable = scene.objects.filter(object => object.canMove && object.canDuplicate && object.canDelete);
      const mover = editable[0], removed = editable[1];
      expect(mover).toBeDefined(); expect(removed).toBeDefined();
      const dx = scene.constants.TILE_W / 2, dy = -scene.constants.TILE_H / 2;
      useEditorStore.getState().moveGameObjectTo(mover.entityId, [mover.position[0] + dx, mover.position[1] + dy]);
      useEditorStore.getState().addGameObject(mover.entityId, [mover.position[0] - dx, mover.position[1] + dy]);
      useEditorStore.getState().removeGameObject(removed.entityId);
      const beforeBlocked = captureEditorSnapshot(useEditorStore.getState());
      const removedCell = baseline.blocked[0];
      const occupied = new Set(baseline.blocked.map(([x, y]) => cellKey(x, y)));
      let addedCell: [number, number] | undefined;
      for (let y = 0; y < baseline.size[1] && !addedCell; y++) for (let x = 0; x < baseline.size[0]; x++) {
        if (!occupied.has(cellKey(x, y))) { addedCell = [x, y]; break; }
      }
      expect(addedCell).toBeDefined();
      useEditorStore.getState().setBlockedAt(...removedCell, false);
      useEditorStore.getState().setBlockedAt(...addedCell!, true);
      useEditorStore.getState().commitStroke(beforeBlocked);
      const original = builder.read(join(gameRoot!, "map", mapName + ".map"));
      expect(original.getTileMapMode()).toBe(1);
      const target = blocks(original).find(block => block.asset.size === 4)!;
      expect(target).toBeDefined();
      const index = baseline.palette.findIndex(tile => {
        const asset = assets.get(tile.ruid ?? "");
        return asset?.size === 1 && asset.material !== target.asset.material && asset.material !== "길경계";
      });
      expect(index).toBeGreaterThanOrEqual(0);
      const beforeGround = captureEditorSnapshot(useEditorStore.getState());
      useEditorStore.getState().setActiveIdx(index);
      useEditorStore.getState().setTool("brush");
      useEditorStore.getState().applyTool(target.gx + 1, target.gy + 1);
      useEditorStore.getState().commitStroke(beforeGround);
      const edited = exportStore();
      const comparison = comparisonCore.compareEditedProject(edited, options());
      const candidate = reviewCore.exportEditedProject(edited, options());
      expect(candidate.candidateId).toMatch(/^[a-f0-9-]{36}$/);
      expect(existsSync(join(candidate.candidateDir, "review-manifest.json"))).toBe(true);
      assertPreviewFile(comparison.scene, builder.read(candidate.mapPath));
      assertCoverage(builder.read(candidate.mapPath), edited);
      const input = { candidateId: candidate.candidateId, mapName, baselineId: baseline.gameSync!.baselineId };
      const baselineFiles = directoryHashes(synced.baselineDir);
      const reviewWithoutWrites = () => {
        const candidateFiles = directoryHashes(candidate.candidateDir);
        const nativeFs = requireCjs("node:fs") as typeof import("node:fs");
        const writeMethods = ["writeFileSync", "appendFileSync", "copyFileSync", "mkdirSync", "renameSync", "rmSync", "unlinkSync", "truncateSync"] as const;
        const guards = writeMethods.map(method => vi.spyOn(nativeFs, method).mockImplementation(() => {
          throw new Error("Candidate review must not write files: " + method);
        }));
        try {
          const result = reviewCore.reviewCandidate(input, options());
          for (const guard of guards) expect(guard).not.toHaveBeenCalled();
          expect(directoryHashes(candidate.candidateDir)).toEqual(candidateFiles);
          expect(directoryHashes(synced.baselineDir)).toEqual(baselineFiles);
          return result;
        } finally {
          for (const guard of guards) guard.mockRestore();
        }
      };
      const ready = reviewWithoutWrites();
      expect(ready).toMatchObject({ ...input, status: "ready", candidateDir: candidate.candidateDir, gameApplied: false, runtimeVerified: false });
      expect(Number.isFinite(Date.parse(ready.createdAt))).toBe(true);
      expect(Number.isFinite(Date.parse(ready.checkedAt))).toBe(true);
      expect(ready.issues).toEqual([]);
      expect(ready.checks.length).toBeGreaterThan(0);
      expect(ready.checks.every(check => check.passed)).toBe(true);
      expect(ready.summary).toEqual({
        groundChangedCells: 1, groundRepackedCells: 15, objectsMoved: 1, objectsAdded: 1, objectsRemoved: 1,
        blockedAdded: 1, blockedRemoved: 1, walkChangedCells: 2,
      });
      expect(ready.summary.groundChangedCells).toBe(comparison.comparison.ground.changedCells.length);
      expect(ready.summary.groundRepackedCells).toBe(comparison.comparison.ground.repackedCells.length);
      expect(ready.summary.walkChangedCells).toBe(candidate.report.walkChangedCells);
      expect(new Set(ready.files.map(file => file.path))).toEqual(new Set(candidate.report.applyFiles));
      expect(ready.files).toHaveLength(2);
      expect(ready.referenceFiles).toBe(Object.keys(directoryHashes(join(candidate.candidateDir, "reference"))).length);
      for (const file of ready.files) {
        const nativeSource = join(gameRoot!, file.path), candidateFile = join(candidate.candidateDir, file.path);
        expect(file).toMatchObject({
          bytes: statSync(candidateFile).size, sourceSha256: hash(nativeSource), candidateSha256: hash(candidateFile),
          currentSourceSha256: hash(nativeSource), currentCandidateSha256: hash(candidateFile),
          sourceMatches: true, candidateMatches: true,
        });
      }
      expect(reviewWithoutWrites().files).toEqual(ready.files);

      // Tamper only an isolated candidate: the map via MapBuilder, or its applicable CSV sidecar.
      let changedPath: string;
      if (mapName === "ferendelmotel") {
        changedPath = "map/" + mapName + ".map";
        const output = builder.read(candidate.mapPath) as MutableCandidateMap;
        const entity = output.listEntities().find(item => item.id === mover.entityId)!;
        const sprite = output.component(entity.path, SPRITE)!;
        output.patchComponent(entity.path, SPRITE, { OrderInLayer: Number(sprite.OrderInLayer) + 1 }).write(candidate.mapPath);
      } else {
        changedPath = ready.files.find(file => file.path.endsWith("/DT_Walk.csv"))!.path;
        const csvPath = join(candidate.candidateDir, changedPath);
        writeFileSync(csvPath, Buffer.concat([readFileSync(csvPath), Buffer.from("\r\nreview-tampered,0,0\r\n")]));
      }
      const blocked = reviewWithoutWrites();
      expect(blocked.status).toBe("blocked");
      expect(blocked.gameApplied).toBe(false);
      expect(blocked.runtimeVerified).toBe(false);
      expect(blocked.issues.length).toBeGreaterThan(0);
      expect(blocked.checks.some(check => !check.passed)).toBe(true);
      expect(blocked.files.filter(file => !file.candidateMatches).map(file => file.path)).toEqual([changedPath]);
      expect(blocked.files.every(file => file.sourceMatches)).toBe(true);
      expect(blocked.files.find(file => file.path === changedPath)!.currentCandidateSha256).not.toBe(ready.files.find(file => file.path === changedPath)!.candidateSha256);
      const row = {
        scenario: "candidate-review", mapName, candidateId: candidate.candidateId, candidateDir: candidate.candidateDir,
        readySummary: ready.summary, applicableFiles: ready.files.map(file => ({ path: file.path, bytes: file.bytes, sourceSha256: file.sourceSha256, candidateSha256: file.candidateSha256 })),
        referenceFiles: ready.referenceFiles, tamperedPath: changedPath, tamperedStatus: blocked.status,
        reviewWrites: 0, baselineSnapshotHashesUnchanged: Object.keys(baselineFiles).length,
        sourceFilesChecked: assertSourceManifest(synced.baselineDir),
      };
      evidence.push(row);
      console.log("[candidate-review-roundtrip]", JSON.stringify(row));
    }, 90_000);
  }


  // Decode the public ZIP format independently of the production packer.
  function readZipEntries(bytes: Buffer): Map<string, Buffer> {
    let end = bytes.length - 22;
    while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
    expect(end).toBeGreaterThanOrEqual(0);
    expect(end + 22 + bytes.readUInt16LE(end + 20)).toBe(bytes.length);
    expect(bytes.readUInt16LE(end + 4)).toBe(0);
    expect(bytes.readUInt16LE(end + 6)).toBe(0);
    const count = bytes.readUInt16LE(end + 10);
    expect(bytes.readUInt16LE(end + 8)).toBe(count);
    const centralSize = bytes.readUInt32LE(end + 12);
    const centralOffset = bytes.readUInt32LE(end + 16);
    expect(centralOffset + centralSize).toBe(end);
    let offset = centralOffset;
    const entries = new Map<string, Buffer>();
    for (let index = 0; index < count; index++) {
      expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
      const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
      expect(flags & 1, "ZIP must not encrypt apply files").toBe(0);
      expect([0, 8]).toContain(method);
      const compressed = bytes.readUInt32LE(offset + 20), uncompressed = bytes.readUInt32LE(offset + 24);
      const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32);
      const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
      expect(name).not.toMatch(/(^\/|\\|:|(^|\/)\.\.(\/|$))/);
      expect(entries.has(name), "duplicate ZIP member").toBe(false);
      const local = bytes.readUInt32LE(offset + 42);
      expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
      expect(bytes.readUInt16LE(local + 8)).toBe(method);
      const localNameLength = bytes.readUInt16LE(local + 26), localExtraLength = bytes.readUInt16LE(local + 28);
      expect(bytes.toString("utf8", local + 30, local + 30 + localNameLength)).toBe(name);
      const bodyStart = local + 30 + localNameLength + localExtraLength;
      expect(bodyStart + compressed).toBeLessThanOrEqual(centralOffset);
      const compressedBytes = bytes.subarray(bodyStart, bodyStart + compressed);
      const body = method === 8 ? inflateRawSync(compressedBytes) : compressedBytes;
      expect(body.length).toBe(uncompressed);
      let checksum = 0xffffffff;
      for (const byte of body) {
        checksum ^= byte;
        for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
      }
      expect(bytes.readUInt32LE(offset + 16)).toBe((checksum ^ 0xffffffff) >>> 0);
      entries.set(name, Buffer.from(body));
      offset += 46 + nameLength + extraLength + commentLength;
    }
    expect(offset).toBe(centralOffset + centralSize);
    return entries;
  }
  function assertNoSyncWrites<T>(read: () => T): T {
    const nativeFs = requireCjs("node:fs") as typeof import("node:fs");
    const methods = ["writeFileSync", "appendFileSync", "copyFileSync", "mkdirSync", "renameSync", "rmSync", "unlinkSync", "truncateSync"] as const;
    const guards = methods.map(method => vi.spyOn(nativeFs, method).mockImplementation(() => {
      throw new Error("History/package reads must not write files: " + method);
    }));
    try {
      const value = read();
      for (const guard of guards) expect(guard).not.toHaveBeenCalled();
      return value;
    } finally {
      for (const guard of guards) guard.mockRestore();
    }
  }

  type CandidateHistory = {
    mapName: string; baselineId: string; skipped: number;
    candidates: {
      candidateId: string; mapName: string; baselineId: string; createdAt: string;
      summary: CandidateSummary; applyFileCount: number; referenceFiles: number;
      sameBaseline: boolean; reviewAvailable: boolean;
    }[];
  };
  type PackageCore = typeof reviewCore & {
    listCandidates(input: { mapName: string; baselineId: string }, options: Options): CandidateHistory;
    packageCandidate(input: { candidateId: string; mapName: string; baselineId: string }, options: Options): {
      filename: string; bytes: Buffer; review: CandidateReview;
    };
  };
  for (const mapName of ["ferendelmotel", "ferendel"]) {
    it(mapName + ": candidate history survives reopening and verified ZIP contains only exact apply files", () => {
      const synced = core.createSyncProject({ ...options(), mapName });
      useEditorStore.getState().loadProject(synced.project, memoryTiles(synced.project));
      const baseline = exportStore();
      const link = { mapName, baselineId: baseline.gameSync!.baselineId };
      const noOp = reviewCore.exportEditedProject(baseline, options());
      expect(noOp.report.exactMapBytes).toBe(true);
      const original = builder.read(join(gameRoot!, "map", mapName + ".map"));
      expect(original.getTileMapMode()).toBe(1);
      const target = blocks(original).find(block => block.asset.size === 4)!;
      expect(target).toBeDefined();
      const index = baseline.palette.findIndex(tile => {
        const asset = assets.get(tile.ruid ?? "");
        return asset?.size === 1 && asset.material !== target.asset.material && asset.material !== "길경계";
      });
      expect(index).toBeGreaterThanOrEqual(0);
      const before = captureEditorSnapshot(useEditorStore.getState());
      useEditorStore.getState().setTool("brush");
      useEditorStore.getState().setActiveIdx(index);
      useEditorStore.getState().applyTool(target.gx + 1, target.gy + 1);
      useEditorStore.getState().setBlockedAt(...baseline.blocked[0], false);
      useEditorStore.getState().commitStroke(before);
      const edited = exportStore();
      const candidate = reviewCore.exportEditedProject(edited, options());
      expect(candidate.report.walkChangedCells).toBe(1);
      expect(hash(candidate.mapPath)).not.toBe(hash(noOp.mapPath));
      assertCoverage(builder.read(candidate.mapPath), edited);

      // A second immutable import is visible in history, but must not be identified as this baseline.
      const other = core.createSyncProject({ ...options(), mapName });
      useEditorStore.getState().loadProject(other.project, memoryTiles(other.project));
      const otherCandidate = reviewCore.exportEditedProject(exportStore(), options());
      const packageCore = core as PackageCore;
      const savedDirectories = [synced.baselineDir, other.baselineDir, noOp.candidateDir, candidate.candidateDir, otherCandidate.candidateDir];
      const savedHashes = () => Object.assign({}, ...savedDirectories.map(directoryHashes)) as Record<string, string>;
      const snapshots = savedHashes();
      const readOnly = <T,>(read: () => T) => {
        const result = assertNoSyncWrites(read);
        expect(savedHashes()).toEqual(snapshots);
        return result;
      };
      const history = readOnly(() => packageCore.listCandidates(link, options()));
      expect(history).toMatchObject(link);
      expect(history.candidates.every(item => item.mapName === mapName)).toBe(true);
      expect(history.candidates.filter(item => item.sameBaseline).map(item => item.candidateId).sort())
        .toEqual([noOp.candidateId, candidate.candidateId].sort());
      expect(history.candidates.find(item => item.candidateId === otherCandidate.candidateId))
        .toMatchObject({ sameBaseline: false, baselineId: other.project.gameSync!.baselineId, reviewAvailable: true });
      expect(history.candidates.find(item => item.candidateId === candidate.candidateId)).toMatchObject({
        sameBaseline: true, reviewAvailable: true, applyFileCount: 2,
        summary: { groundChangedCells: 1, groundRepackedCells: 15, walkChangedCells: 1, blockedRemoved: 1 },
      });
      const dates = history.candidates.map(item => Date.parse(item.createdAt));
      expect(dates.every(Number.isFinite)).toBe(true);
      expect(dates).toEqual([...dates].sort((a, b) => b - a));

      // A new module instance has no access to the first module's in-memory candidate state.
      const modulePath = requireCjs.resolve("../../scripts/game-sync/core.cjs");
      const cached = requireCjs.cache[modulePath];
      delete requireCjs.cache[modulePath];
      let reopened: PackageCore;
      try { reopened = requireCjs(modulePath) as PackageCore; }
      finally { if (cached) requireCjs.cache[modulePath] = cached; }
      expect(readOnly(() => reopened.listCandidates(link, options()))).toEqual(history);
      const packages: { filename: string; bytes: Buffer; review: CandidateReview; entries: Map<string, Buffer> }[] = [];
      for (const output of [noOp, candidate]) {
        const identity = { ...link, candidateId: output.candidateId };
        const archive = readOnly(() => reopened.packageCandidate(identity, options()));
        expect(archive.filename).toMatch(/\.zip$/);
        expect(archive.filename).toContain(mapName);
        expect(Buffer.isBuffer(archive.bytes)).toBe(true);
        expect(archive.review).toMatchObject({ ...identity, status: "ready", gameApplied: false, runtimeVerified: false });
        expect(archive.review.issues).toEqual([]);
        const entries = readZipEntries(archive.bytes);
        expect(new Set(entries.keys())).toEqual(new Set([...output.report.applyFiles!, "REVIEW.txt"]));
        expect(entries.size).toBe(output === noOp ? 2 : 3);
        expect([...entries.keys()].some(name => name.startsWith("reference/") || /project|baseline|manifest|report\.json/.test(name))).toBe(false);
        expect(archive.review.files).toHaveLength(output === noOp ? 1 : 2);
        for (const file of archive.review.files) {
          const bytes = entries.get(file.path)!;
          expect(bytes).toEqual(readFileSync(join(output.candidateDir, file.path)));
          expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.candidateSha256);
          expect(bytes.length).toBe(file.bytes);
          expect(file.sourceMatches && file.candidateMatches).toBe(true);
        }
        const instructions = entries.get("REVIEW.txt")!.toString("utf8");
        expect(instructions).toContain(identity.candidateId);
        expect(instructions).toContain(identity.baselineId);
        expect(instructions).toContain(mapName);
        expect(instructions).toMatch(/gameApplied\s*[:=]\s*false/i);
        expect(instructions).toMatch(/runtimeVerified\s*[:=]\s*false/i);
        for (const file of archive.review.files) {
          expect(instructions).toContain(file.path);
          expect(instructions).toContain(file.candidateSha256);
        }
        packages.push({ ...archive, entries });
      }

      // Stale candidate content may remain in history, but cannot become a downloadable verified ZIP.
      const tampered = builder.read(candidate.mapPath) as MutableCandidateMap;
      const entity = tampered.listEntities().find(item => item.name.startsWith("Tile_"))!;
      const sprite = tampered.component(entity.path, SPRITE)!;
      tampered.patchComponent(entity.path, SPRITE, { OrderInLayer: Number(sprite.OrderInLayer) + 1 }).write(candidate.mapPath);
      const beforeRejected = savedHashes();
      let rejection: unknown;
      assertNoSyncWrites(() => {
        try { reopened.packageCandidate({ ...link, candidateId: candidate.candidateId }, options()); }
        catch (error) { rejection = error; }
      });
      expect(rejection).toMatchObject({ code: "CANDIDATE_BLOCKED", status: 409, review: { status: "blocked", gameApplied: false, runtimeVerified: false } });
      expect(savedHashes()).toEqual(beforeRejected);
      expect(directoryHashes(synced.baselineDir)).toEqual(Object.fromEntries(Object.entries(snapshots).filter(([path]) => path.startsWith(synced.baselineDir))));
      expect(assertNoSyncWrites(() => reopened.listCandidates(link, options())).candidates.some(item => item.candidateId === candidate.candidateId)).toBe(true);
      const archiveEvidence = packages.map((archive, index) => {
        // Caller-side diagnostic output; the history/package APIs themselves never write an archive.
        const zipPath = join(runRoot, mapName + (index === 0 ? "-unchanged.zip" : "-edited.zip"));
        writeFileSync(zipPath, archive.bytes);
        return {
          zipPath, zipBytes: archive.bytes.length, zipSha256: hash(zipPath),
          entries: [...archive.entries].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") })),
          candidateId: archive.review.candidateId, ready: archive.review.status,
        };
      });
      const row = {
        scenario: "candidate-history-and-package", mapName, baselineId: link.baselineId,
        historySurvivedReopen: true, sameBaselineCandidates: 2, otherBaselineMarked: true,
        packages: archiveEvidence, candidateTamperingBlocked: true, historyPackageWrites: 0,
        baselineSnapshotHashesUnchanged: Object.keys(directoryHashes(synced.baselineDir)).length,
        sourceFilesChecked: assertSourceManifest(synced.baselineDir),
      };
      evidence.push(row);
      console.log("[candidate-history-package]", JSON.stringify(row));
    }, 90_000);
  }

});
