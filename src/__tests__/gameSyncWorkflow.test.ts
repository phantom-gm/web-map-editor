import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { runGameSync, listGameMaps, gameSyncPaths } from "../server/gameSync";
import { getGroupResourceMetadata, fetchSpriteAsset, fetchAnimationPreviewFrame, fetchAnimationFrameAsset } from "../server/mswMcp";
vi.mock("../server/mswMcp", () => ({ withMcpClient: (fn: (client: object) => unknown) => fn({}), getGroupResourceMetadata: vi.fn(), fetchSpriteAsset: vi.fn(), fetchAnimationPreviewFrame: vi.fn(), fetchAnimationFrameAsset: vi.fn() }));
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
  for (const name of ["core.cjs", "load-core.cjs", "object-edits.cjs", "walk-edits.cjs", "zip.cjs", "npcs.cjs", "runtime.cjs", "runtime-dependencies.cjs", "traps.cjs", "actor-depth.cjs"]) {
    const relative = "scripts/game-sync/" + name;
    put(localEditor, relative, fs.readFileSync(path.join(editorRoot, relative)));
  }
  for (const name of ["objectSorting.cjs", "objectVisualOffset.cjs", "objectFlip.cjs"]) {
    put(localEditor, "src/lib/" + name, fs.readFileSync(path.join(editorRoot, "src/lib/" + name)));
  }
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

it.skipIf(!available)("server art registration uses verified metadata and round-trips through API save, reopen and export", async () => {
  const f = fixture(), before = hash(f.mapPath);
  const opened = await request<Opened>({ action: "open", mapName: "fixture" });
  const ruid = "b".repeat(32);
  vi.mocked(getGroupResourceMetadata).mockResolvedValue(new Map([[ruid, { resourceType: "sprite" }]]) as never);
  vi.mocked(fetchSpriteAsset).mockResolvedValue({ imageUrl: "data:image/png;base64,test", metadata: { width: 300, height: 500, pixelsPerUnit: 100, pivot: [0.5, 0] } } as never);
  const result = await request<{ resourceIds: string[] }>({ action: "register-object-resources", ...opened.project.gameSync, resources: [{ ruid, name: "나무", metadata: { width: 1 } }] });
  const p = opened.project;
  p.gameObjectEdits = { version: 1, resources: result.resourceIds, moved: [], removed: [], added: [{ entityId: "11111111-2222-4333-8444-555555555555", prototypeId: "resource_" + result.resourceIds[0], position: [1.28, -0.64], scale: 0.5 }] };
  await request({ action: "save", project: p, expectedRevision: opened.revision });
  const reopened = await request<Opened>({ action: "open", mapName: "fixture" });
  expect(reopened.project.gameObjectEdits).toEqual(p.gameObjectEdits);
  const preview = await request<Preview>({ action: "preview", project: reopened.project });
  expect(preview.scene.sprites).toHaveLength(3);
  const output = await request<Candidate>({ action: "export", project: reopened.project });
  expect(output.report.changedCells).toBe(0); expect(hash(f.mapPath)).toBe(before);
  vi.mocked(getGroupResourceMetadata).mockResolvedValue(new Map([[ruid, { resourceType: "skeleton" }]]) as never);
  await expect(request({ action: "register-object-resources", ...p.gameSync, resources: [{ ruid, name: "애니메이션" }] })).rejects.toThrow("이미지 또는 애니메이션");
});


it.skipIf(!available)("registered ground material stays in the floor palette across save and reopen and paints a real ground cell", async()=>{
  const f=fixture(),before=hash(f.mapPath),opened=await request<Opened>({action:"open",mapName:"fixture"});
  const ruid="e".repeat(32);
  vi.mocked(getGroupResourceMetadata).mockResolvedValue(new Map([[ruid,{resourceType:"sprite"}]]) as never);
  vi.mocked(fetchSpriteAsset).mockResolvedValue({imageUrl:"data:image/png;base64,test",metadata:{width:256,height:128,pixelsPerUnit:100,pivot:[0.5,0.5]}} as never);
  const registered=await request<{resourceIds:string[]}>({action:"register-ground-resources",...opened.project.gameSync,resources:[{ruid,name:"Velos_stone"}]});
  const p=opened.project,index=p.palette.length;
  p.palette.push({name:"Velos_stone",ruid,px:[256,128],category:"foothold",gameResourceId:registered.resourceIds[0]});
  p.ground[0][2]=index;
  await request({action:"save",project:p,expectedRevision:opened.revision});
  const reopened=await request<Opened>({action:"open",mapName:"fixture"});
  expect(reopened.project.palette[index].gameResourceId).toBe(registered.resourceIds[0]);
  const preview=await request<Preview>({action:"preview",project:reopened.project});
  expect(preview.scene.groundBrushRuids).toContain(ruid);
  const output=await request<Candidate>({action:"export",project:reopened.project});
  expect(output.report.changedCells).toBe(1);expect(hash(f.mapPath)).toBe(before);
  vi.mocked(fetchSpriteAsset).mockResolvedValue({imageUrl:"x",metadata:{width:256,height:128,pixelsPerUnit:100,pivot:[0.5,0]}} as never);
  await expect(request({action:"register-ground-resources",...p.gameSync,resources:[{ruid,name:"bad"}]})).rejects.toThrow("중앙 피벗");
});

it.skipIf(!available)("animated decoration keeps the clip RUID through register, save, reopen and export", async () => {
  const f = fixture(), before = hash(f.mapPath);
  const opened = await request<Opened>({ action: "open", mapName: "fixture" });
  const clipId = "c".repeat(32), spriteId = "d".repeat(32);
  const clip = { ruid: clipId, resourceType: "animationclip" }, sprite = { ruid: spriteId, resourceType: "sprite" };
  const frame = { spriteRuid: spriteId, offset: [0, 8] as [number, number], frameCount: 12 };
  vi.mocked(getGroupResourceMetadata).mockResolvedValue(new Map([[clipId, clip], [spriteId, sprite]]) as never);
  vi.mocked(fetchAnimationPreviewFrame).mockResolvedValue(frame);
  vi.mocked(fetchAnimationFrameAsset).mockResolvedValue({ imageUrl: "data:image/png;base64,test", metadata: {
    width: 738, height: 544, pixelsPerUnit: 100, pivot: [0.5, 0.34], pivotSource: "animation",
    animationFrame: { ...frame, frameIndex: 0 },
  } } as never);
  const result = await request<{ resourceIds: string[] }>({ action: "register-object-resources", ...opened.project.gameSync,
    resources: [{ ruid: clipId, name: "분수" }] });
  expect(fetchAnimationFrameAsset).toHaveBeenCalledWith(clip, frame, sprite);
  const p = opened.project;
  p.gameObjectEdits = { version: 1, resources: result.resourceIds, moved: [], removed: [], added: [
    { entityId: "11111111-2222-4333-8444-555555555555", prototypeId: "resource_" + result.resourceIds[0], position: [1.28, -0.64], scale: 1 },
  ] };
  await request({ action: "save", project: p, expectedRevision: opened.revision });
  const reopened = await request<Opened>({ action: "open", mapName: "fixture" });
  const preview = await request<Preview>({ action: "preview", project: reopened.project });
  expect(preview.scene.sprites.some(row => row.ruid === clipId)).toBe(true);
  const output = await request<Candidate>({ action: "export", project: reopened.project });
  const { MapBuilder } = nodeRequire(sourceBuilder);
  const exported = MapBuilder.read(output.mapPath);
  const components = exported.listEntities().map((row: { name: string }) => exported.component(row.name, "MOD.Core.SpriteRendererComponent")).filter(Boolean);
  expect(components.filter((row: { SpriteRUID?: string }) => row.SpriteRUID === clipId)).toHaveLength(1);
  expect(components.some((row: { SpriteRUID?: string }) => row.SpriteRUID === spriteId)).toBe(false);
  expect(hash(f.mapPath)).toBe(before);
  await expect(request({ action: "register-ground-resources", ...p.gameSync, resources: [{ ruid: clipId, name: "분수" }] })).rejects.toThrow("정적 이미지");
  vi.mocked(fetchAnimationPreviewFrame).mockRejectedValueOnce(new Error("Multi-layer animation preview is unsupported."));
  await expect(request({ action: "register-object-resources", ...p.gameSync, resources: [{ ruid: clipId, name: "분수" }] })).rejects.toThrow("Multi-layer");
  vi.mocked(getGroupResourceMetadata).mockResolvedValue(new Map([[clipId, clip]]) as never);
  await expect(request({ action: "register-object-resources", ...p.gameSync, resources: [{ ruid: clipId, name: "분수" }] })).rejects.toThrow("첫 프레임");
});
