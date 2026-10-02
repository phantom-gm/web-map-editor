import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { runGameSync, listGameMaps, gameSyncPaths } from "../server/gameSync";
import type { ProjectFile } from "../lib/projectIO";

interface Builder {
  entity(name: string, components: unknown[], options?: object): Builder;
  sprite(name: string, options: object): Builder;
  write(file: string): Builder;
}
interface BuilderModule { MapBuilder: new (name: string) => Builder }
interface Receipt { revision: string; savedAt: string }
interface Opened extends Receipt { action: string; resumed: boolean; project: ProjectFile }
interface Preview { scene: { sprites: Array<Record<string, unknown>>; groundBrushRuids: string[]; report: { changedCells: number; counts: object } } }
interface Candidate { mapPath: string; report: { exactMapBytes: boolean; changedCells: number; counts: object; gameApplied: boolean } }
const nodeRequire = createRequire(import.meta.url);
const editorRoot = process.cwd();
const sourceRoot = process.env.MSW_GAME_SYNC_TEST_ROOT || "C:/Trunk/legend_of_light";
const sourceBuilder = path.join(sourceRoot, ".agents/skills/msw-general/scripts/map/msw_map_builder.cjs");
const available = fs.existsSync(sourceBuilder);
const tempParent = fs.realpathSync(os.tmpdir());
let temporary: string | undefined;
const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (!temporary) return;
  if (path.dirname(temporary) !== tempParent || !path.basename(temporary).startsWith("web-map-api-workflow-")) throw new Error("Unsafe cleanup");
  fs.rmSync(temporary, { recursive: true, force: true }); temporary = undefined;
});
function fixture() {
  temporary = fs.mkdtempSync(path.join(tempParent, "web-map-api-workflow-"));
  const gameRoot = path.join(temporary, "game"), localEditor = path.join(temporary, "editor");
  function put(root: string, relative: string, data: string | Buffer) {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file;
  }
  put(localEditor, "scripts/game-sync/core.cjs", fs.readFileSync(path.join(editorRoot, "scripts/game-sync/core.cjs")));
  const builder = put(gameRoot, ".agents/skills/msw-general/scripts/map/msw_map_builder.cjs", fs.readFileSync(sourceBuilder));
  put(gameRoot, "scripts/build_map.cjs", "module.exports={TILE_W:2.56,TILE_H:1.28,ORIGIN_X:0,ORIGIN_Y:0,DEPTH_SCALE:0.21875,GROUND_ORDER:-1000,PPU:100};");
  const resources = [
    { name: "페른델_1x1_잔디_01", ruid: "grass-one" }, { name: "페른델_2x2_잔디_01", ruid: "grass-two" },
    { name: "페른델_4x4_잔디_01", ruid: "grass-four" }, { name: "페른델_1x1_물_01", ruid: "water-one" },
    { name: "페른델_2x2_물_01", ruid: "water-two" }, { name: "페른델_4x4_물_01", ruid: "water-four" },
  ];
  put(gameRoot, "scripts/storage-inventory.lock.json", JSON.stringify({ resources }));
  const { MapBuilder } = nodeRequire(builder) as BuilderModule;
  const map = new MapBuilder("fixture");
  map.entity("/maps/fixture", [{ "@type": "MOD.Core.MapComponent", TileMapMode: 1 }]);
  map.sprite("Tile_0_0", { ruid: "grass-four", pos: [0, -1.92, -0.42], order: -1000 });
  map.sprite("Obj_keep", { ruid: "object", pos: [1, 2, 3], order: 0 });
  const mapPath = put(gameRoot, "map/fixture.map", "");
  map.write(mapPath);
  put(gameRoot, "map/fixture.json", JSON.stringify({
    type: "web-map-editor-project", version: 2, map: "fixture", size: [4, 4], groundOrigin: [0, 0],
    ground: [[0, 0, 0]], palette: [{ name: resources[0].name, ruid: resources[0].ruid, px: [256, 128] }],
    entities: [], blocked: [],
  }));
  const csvPath = put(gameRoot, "RootDesk/MyDesk/DataSet/world/DT_Portal.csv", "\uFEFFId,Map\r\np1,fixture\r\n");
  vi.stubEnv("MSW_GAME_ROOT", gameRoot);
  vi.spyOn(process, "cwd").mockReturnValue(localEditor);
  return { gameRoot, localEditor, mapPath, csvPath };
}
async function request<T>(body: object): Promise<T> { return await runGameSync(body) as T; }

describe.skipIf(!available)("direct API workflow in isolated editor/game fixtures", () => {
  it("open → resume → preview → edit → save → resume → export → undo produces the original map again", async () => {
    const f = fixture(), beforeMap = hash(f.mapPath), beforeCsv = hash(f.csvPath);
    expect(gameSyncPaths().workspaceRoot).toBe(path.join(f.localEditor, ".game-sync/workspaces"));
    expect(listGameMaps()).toEqual(["fixture"]);
    const opened = await request<Opened>({ action: "open", mapName: "fixture" });
    expect(opened.resumed).toBe(false);
    expect(opened.project.gameSync?.baselineId).toBeTruthy();
    expect(opened.project.ground.length).toBe(16);
    const resumed = await request<Opened>({ action: "open", mapName: "fixture" });
    expect(resumed.resumed).toBe(true);
    expect(resumed.project).toEqual(opened.project); expect(resumed.revision).toBe(opened.revision);
    const originalPreview = await request<Preview>({ action: "preview", project: resumed.project });
    expect(originalPreview.scene.sprites.length).toBe(2);
    expect(originalPreview.scene.groundBrushRuids).toEqual(expect.arrayContaining(["grass-one", "water-one"]));
    const edited: ProjectFile = JSON.parse(JSON.stringify(resumed.project));
    edited.ground.find(c => c[0] === 1 && c[1] === 1)![2] = edited.palette.findIndex(t => t.ruid === "water-one");
    const saved = await request<Receipt>({ action: "save", project: edited, expectedRevision: resumed.revision });
    const retry = await request<Receipt>({ action: "save", project: edited, expectedRevision: resumed.revision });
    expect(retry.revision).toBe(saved.revision);
    const reopened = await request<Opened>({ action: "open", mapName: "fixture" });
    expect(reopened.project).toEqual(edited); expect(reopened.revision).toBe(saved.revision);
    const editedPreview = await request<Preview>({ action: "preview", project: reopened.project });
    const candidate = await request<Candidate>({ action: "export", project: reopened.project });
    expect(candidate.report.changedCells).toBe(1); expect(candidate.report.counts).toEqual(editedPreview.scene.report.counts);
    expect(candidate.report.gameApplied).toBe(false); expect(candidate.report.exactMapBytes).toBe(false);
    const restored = await request<Receipt>({ action: "save", project: opened.project, expectedRevision: reopened.revision });
    const undoReopened = await request<Opened>({ action: "open", mapName: "fixture" });
    expect(undoReopened.revision).toBe(restored.revision); expect(undoReopened.project).toEqual(opened.project);
    const undoPreview = await request<Preview>({ action: "preview", project: undoReopened.project });
    expect(undoPreview.scene.sprites).toEqual(originalPreview.scene.sprites);
    const noop = await request<Candidate>({ action: "export", project: undoReopened.project });
    expect(noop.report.exactMapBytes).toBe(true); expect(noop.report.changedCells).toBe(0);
    expect(hash(noop.mapPath)).toBe(beforeMap);
    expect(hash(f.mapPath)).toBe(beforeMap); expect(hash(f.csvPath)).toBe(beforeCsv);
    expect(fs.readdirSync(path.join(f.localEditor, ".game-sync/workspaces/fixture/history")).length).toBe(2);
  }, 30_000);
  it("fresh import requires the current revision and preserves the replaced draft in history", async () => {
    const f = fixture(), opened = await request<Opened>({ action: "open", mapName: "fixture" });
    await expect(request({ action: "import", mapName: "fixture" })).rejects.toMatchObject({ status: 409 });
    const changed = { ...opened.project, ground: [] };
    const saved = await request<Receipt>({ action: "save", project: changed, expectedRevision: opened.revision });
    await expect(request({ action: "import", mapName: "fixture", expectedRevision: opened.revision })).rejects.toMatchObject({ status: 409 });
    const fresh = await request<Opened>({ action: "import", mapName: "fixture", expectedRevision: saved.revision });
    expect(fresh.resumed).toBe(false); expect(fresh.project.ground.length).toBe(16);
    expect(fresh.project.gameSync?.baselineId).not.toBe(opened.project.gameSync?.baselineId);
    const history = path.join(f.localEditor, ".game-sync/workspaces/fixture/history", saved.revision + ".json");
    expect(JSON.parse(fs.readFileSync(history, "utf8"))).toEqual(changed);
  }, 30_000);
  it("source freshness blocks preview/export while save/open still preserve the user's draft", async () => {
    const f = fixture(), opened = await request<Opened>({ action: "open", mapName: "fixture" });
    fs.appendFileSync(f.mapPath, " ");
    const edited = { ...opened.project, ground: [] };
    const saved = await request<Receipt>({ action: "save", project: edited, expectedRevision: opened.revision });
    const reopened = await request<Opened>({ action: "open", mapName: "fixture" });
    expect(reopened.revision).toBe(saved.revision); expect(reopened.project).toEqual(edited);
    await expect(request({ action: "preview", project: reopened.project })).rejects.toMatchObject({ code: "STALE_SOURCE" });
    await expect(request({ action: "export", project: reopened.project })).rejects.toMatchObject({ code: "STALE_SOURCE" });
    expect(fs.existsSync(path.join(f.localEditor, ".game-sync/candidates"))).toBe(false);
  }, 30_000);
});
