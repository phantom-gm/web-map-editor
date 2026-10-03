import { describe, expect, it } from "vitest";
import {
  drawGameComparison, getComparisonCounts, validateComparisonPair, GAME_COMPARISON_COLORS,
  type GameBaselinePreview, type GameComparison, type GameComparisonFilters,
} from "../lib/gameComparison";
import {
  previewSpriteGeometry, previewWorldToScreen,
  type GamePreviewAsset, type GamePreviewImages, type GamePreviewScene, type GamePreviewSprite,
} from "../lib/gamePreview";

const constants = { TILE_W: 2.56, TILE_H: 1.28, ORIGIN_X: 15, ORIGIN_Y: 15, PPU: 100, DEPTH_SCALE: 0.21875, GROUND_ORDER: -1000 };
const camera = { x: 500, y: 500, zoom: 0.8 };
const asset: GamePreviewAsset = { width: 120, height: 240, pivot: [0.3, 0.12], pixelsPerUnit: 100 };
const all: GameComparisonFilters = { ground: true, objects: true, blocked: true, npcs: true };
const onlyObjects: GameComparisonFilters = { ground: false, objects: true, blocked: false, npcs: false };
function sprite(id: string, extra: Partial<GamePreviewSprite> = {}): GamePreviewSprite {
  return {
    id: "native-" + id, objectEntityId: id, path: "/maps/compare/" + id, name: id, ruid: "ruid-" + id,
    kind: "object", position: [0.13742153, -9.38127164, 2.75], scale: [1, 1],
    quaternion: [0, 0, 0, 1], rotationDeg: 0, flipX: false, flipY: false,
    sortingLayer: null, orderInLayer: 0, sourceOrder: 0, ...extra,
  };
}
function emptyComparison(): GameComparison {
  return {
    version: 1, baselineId: "compare-baseline", mapName: "compare",
    ground: { changedCells: [], repackedCells: [], affectedBeforeBlocks: [], replacementBlocks: [] },
    objects: { moved: [], added: [], removed: [] }, blocked: { added: [], removed: [] },
  };
}
function fixture() {
  const moved = sprite("moved", { rotationDeg: 37, scale: [-2, 0.6], flipX: true, flipY: true, color: [1, 1, 1, 0.4] });
  const removed = sprite("removed", { position: [-2.31571983, 3.81313742, -0.23], sourceOrder: 1 });
  const untouched = sprite("untouched", { sourceOrder: 2 });
  const movedCurrent = { ...moved, position: [moved.position[0] + 1.28, moved.position[1] - 0.64, moved.position[2] - 0.14] as [number, number, number] };
  const added = sprite("editor-copy-id", { id: "random-native-copy-id", ruid: moved.ruid, position: [-5.14, -7.25, 0.3], sourceOrder: 3 });
  const original: GamePreviewScene = {
    version: 1, baselineId: "compare-baseline", mapName: "compare", constants: { ...constants },
    groundOrigin: [2, -3], defaultSortingLayer: "Default", sprites: [moved, removed, untouched], warnings: [],
  };
  const current: GamePreviewScene = { ...original, sprites: [movedCurrent, untouched, added] };
  const baseline: GameBaselinePreview = {
    version: 1, baselineId: original.baselineId, mapName: original.mapName, size: [12, 12],
    groundOrigin: [2, -3], scene: original, ground: [[3, 4, "grass"]], blocked: [[2, 2]],
  };
  const comparison = emptyComparison();
  comparison.objects = {
    moved: [{ entityId: moved.objectEntityId!, from: [...moved.position], to: [...movedCurrent.position] }],
    removed: [{ entityId: removed.objectEntityId!, position: [...removed.position] }],
    added: [{ entityId: added.objectEntityId!, prototypeId: moved.objectEntityId!, position: [...added.position] }],
  };
  const images: GamePreviewImages = new Map([moved, removed, untouched].map(item => [item.ruid, {
    asset: { ...asset }, image: { id: item.ruid, naturalWidth: asset.width, naturalHeight: asset.height } as unknown as HTMLImageElement,
  }]));
  return { baseline, current, comparison, images, moved, removed, movedCurrent, added };
}

type PathCommand = { operation: string; values: number[] };
interface RecordedPath { path: PathCommand[]; color: string | CanvasGradient | CanvasPattern; dash: number[]; alpha: number }
function recordingContext() {
  const strokes: RecordedPath[] = [], fills: RecordedPath[] = [], clips: PathCommand[][] = [];
  const transforms: number[][] = [], images: { image: CanvasImageSource; alpha: number }[] = [];
  let path: PathCommand[] = [], dash: number[] = [];
  type ContextState = { alpha: number; stroke: string | CanvasGradient | CanvasPattern; fill: string | CanvasGradient | CanvasPattern; dash: number[]; lineWidth: number };
  const stack: ContextState[] = [];
  const record = (color: string | CanvasGradient | CanvasPattern): RecordedPath =>
    ({ path: structuredClone(path), color, dash: [...dash], alpha: ctx.globalAlpha });
  const ctx = {
    canvas: { width: 2000, height: 2000 }, globalAlpha: 0.75, lineWidth: 1,
    strokeStyle: "initial-stroke" as string | CanvasGradient | CanvasPattern,
    fillStyle: "initial-fill" as string | CanvasGradient | CanvasPattern,
    save() { stack.push({ alpha: this.globalAlpha, stroke: this.strokeStyle, fill: this.fillStyle, dash: [...dash], lineWidth: this.lineWidth }); },
    restore() {
      const saved = stack.pop()!;
      this.globalAlpha = saved.alpha; this.strokeStyle = saved.stroke; this.fillStyle = saved.fill;
      this.lineWidth = saved.lineWidth; dash = saved.dash;
    },
    setLineDash(next: number[]) { dash = [...next]; },
    beginPath() { path = []; },
    moveTo(...values: number[]) { path.push({ operation: "move", values }); },
    lineTo(...values: number[]) { path.push({ operation: "line", values }); },
    closePath() { path.push({ operation: "close", values: [] }); },
    arc(...values: number[]) { path.push({ operation: "arc", values }); },
    transform(...values: number[]) { transforms.push(values); },
    drawImage(image: CanvasImageSource) { images.push({ image, alpha: this.globalAlpha }); },
    stroke() { strokes.push(record(this.strokeStyle)); },
    fill() { fills.push(record(this.fillStyle)); },
    clip() { clips.push(structuredClone(path)); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes, fills, clips, transforms, images, stack };
}
function near(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 8));
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}

describe("comparison response contract", () => {
  it("accepts an immutable baseline/current pair with the same world-to-grid origin", () => {
    const { baseline, current, comparison } = fixture();
    expect(validateComparisonPair(freezeDeep(baseline), freezeDeep(current), freezeDeep(comparison))).toBe(true);
  });
  it.each(["baselineId", "mapName", "groundOrigin", "constants", "sortingLayer"] as const)("rejects a mismatched %s before drawing any overlay", field => {
    const f = fixture(), recorder = recordingContext();
    if (field === "baselineId") f.current.baselineId = "another-baseline";
    if (field === "mapName") f.comparison.mapName = "another-map";
    if (field === "groundOrigin") f.current.groundOrigin = [0, 0];
    if (field === "constants") f.current.constants = { ...constants, TILE_W: 0.56 };
    if (field === "sortingLayer") f.current.defaultSortingLayer = "unexpected";
    expect(() => drawGameComparison(recorder.ctx, f.baseline, f.current, f.comparison, f.images, camera, all)).toThrow("비교");
    expect(recorder.images).toEqual([]); expect(recorder.strokes).toEqual([]); expect(recorder.fills).toEqual([]);
  });
  it.each(["direct-repacked overlap", "blocked overlap", "duplicate object", "outside cell", "invalid position", "duplicate cell", "unchanged material"] as const)("rejects invalid %s diagnostics", kind => {
    const f = fixture();
    if (kind === "direct-repacked overlap") {
      f.comparison.ground.changedCells = [{ gx: 3, gy: 4, beforeRuid: "grass", afterRuid: "road" }];
      f.comparison.ground.repackedCells = [[3, 4]];
    }
    if (kind === "blocked overlap") f.comparison.blocked = { added: [[2, 2]], removed: [[2, 2]] };
    if (kind === "duplicate object") f.comparison.objects.added[0].entityId = "moved";
    if (kind === "outside cell") f.comparison.blocked.added = [[12, 0]];
    if (kind === "invalid position") f.comparison.objects.moved[0].to[0] = NaN;
    if (kind === "duplicate cell") f.comparison.ground.repackedCells = [[1, 1], [1, 1]];
    if (kind === "unchanged material") f.comparison.ground.changedCells = [{ gx: 3, gy: 4, beforeRuid: "grass", afterRuid: "grass" }];
    expect(() => validateComparisonPair(f.baseline, f.current, f.comparison)).toThrow("비교 데이터");
  });
  it("counts direct ground edits separately from collateral repacking and each object/blocked operation", () => {
    const f = fixture();
    f.comparison.ground.changedCells = [{ gx: 3, gy: 4, beforeRuid: "grass", afterRuid: "road" }];
    f.comparison.ground.repackedCells = [[2, 4], [4, 4], [3, 3]];
    f.comparison.blocked = { added: [[5, 6], [6, 6]], removed: [[2, 2]] };
    const before = structuredClone(f.comparison);
    expect(getComparisonCounts(f.comparison)).toEqual({
      groundChangedCells: 1, groundRepackedCells: 3, objectsMoved: 1, objectsAdded: 1,
      objectsRemoved: 1, blockedAdded: 2, blockedRemoved: 1,
      npcsMoved: 0, npcsAdded: 0, npcsRemoved: 0, npcsUpdated: 0,
    });
    expect(f.comparison).toEqual(before);
    expect(Object.values(getComparisonCounts(emptyComparison()))).toEqual(Array(11).fill(0));
  });
});

describe("native object comparison overlays", () => {
  it("draws only moved/deleted original sprites as ghosts using native pivot/rotation/flips/scale and original alpha", () => {
    const f = fixture(), r = recordingContext();
    drawGameComparison(r.ctx, f.baseline, f.current, f.comparison, f.images, camera, onlyObjects);
    expect(r.images.map(item => item.image)).toEqual([f.images.get(f.moved.ruid)!.image, f.images.get(f.removed.ruid)!.image]);
    near(r.transforms[0], previewSpriteGeometry(f.moved, asset, f.baseline.scene, camera).matrix);
    near(r.transforms[1], previewSpriteGeometry(f.removed, asset, f.baseline.scene, camera).matrix);
    expect(r.images[0].alpha).toBeCloseTo(0.75 * 0.24 * 0.4);
    expect(r.images[1].alpha).toBeCloseTo(0.75 * 0.24);
    expect(r.ctx.globalAlpha).toBe(0.75);
    expect(r.ctx.strokeStyle).toBe("initial-stroke"); expect(r.stack).toEqual([]);
  });
  it("outlines copies by stable editor ID even though the native sprite ID changes on every preview", () => {
    const f = fixture(), r = recordingContext();
    drawGameComparison(r.ctx, f.baseline, f.current, f.comparison, f.images, camera, onlyObjects);
    const addedOutline = r.strokes.find(stroke => stroke.color === GAME_COMPARISON_COLORS.added)!;
    const [a, b, c, d, tx, ty] = previewSpriteGeometry(f.added, asset, f.current, camera).matrix;
    near(addedOutline.path[0].values, [tx, ty]);
    near(addedOutline.path[2].values, [a * asset.width + c * asset.height + tx, b * asset.width + d * asset.height + ty]);
    expect(addedOutline.dash).toEqual([5, 3]);
    f.added.id = "a-new-native-GUID"; const after = recordingContext();
    drawGameComparison(after.ctx, f.baseline, f.current, f.comparison, f.images, camera, onlyObjects);
    expect(after.strokes.find(stroke => stroke.color === GAME_COMPARISON_COLORS.added)).toEqual(addedOutline);
  });
  it("connects native old and new anchors with the same camera and draws separate old/current outlines", () => {
    const f = fixture(), r = recordingContext();
    drawGameComparison(r.ctx, f.baseline, f.current, f.comparison, f.images, camera, onlyObjects);
    const movedStrokes = r.strokes.filter(stroke => stroke.color === GAME_COMPARISON_COLORS.objectMoved);
    const connector = movedStrokes.find(stroke => stroke.dash.join(",") === "4,3")!;
    near(connector.path[0].values, previewWorldToScreen(f.moved.position, f.baseline.scene, camera));
    near(connector.path[1].values, previewWorldToScreen(f.movedCurrent.position, f.current, camera));
    expect(movedStrokes.filter(stroke => stroke.dash.join(",") === "5,3")).toHaveLength(2);
    expect(r.strokes.filter(stroke => stroke.color === GAME_COMPARISON_COLORS.removed)).toHaveLength(1);
  });
  it("keeps scenes immutable and never injects old ghosts into the selectable current sprites", () => {
    const f = fixture(), r = recordingContext(), currentSprites = f.current.sprites;
    const before = JSON.stringify({ baseline: f.baseline, current: f.current, comparison: f.comparison, camera });
    freezeDeep(f.baseline); freezeDeep(f.current); freezeDeep(f.comparison);
    drawGameComparison(r.ctx, f.baseline, f.current, f.comparison, f.images, camera, all);
    expect(f.current.sprites).toBe(currentSprites);
    expect(f.current.sprites.map(item => item.objectEntityId)).toEqual(["moved", "untouched", "editor-copy-id"]);
    expect(JSON.stringify({ baseline: f.baseline, current: f.current, comparison: f.comparison, camera })).toBe(before);
  });
  it("keeps counts and movement connectors when original images are unresolved, without guessed ghost geometry", () => {
    const f = fixture(), r = recordingContext();
    f.images.clear();
    drawGameComparison(r.ctx, f.baseline, f.current, f.comparison, f.images, camera, onlyObjects);
    expect(r.images).toEqual([]); expect(r.transforms).toEqual([]);
    expect(r.strokes).toHaveLength(2); // Only the movement line and arrowhead.
    expect(r.strokes[0].dash).toEqual([4, 3]);
    expect(getComparisonCounts(f.comparison).objectsRemoved).toBe(1);
  });
});

describe("logical ground and blocked comparison overlays", () => {
  it("places direct cell diamonds at editor cell centers without applying the native ground origin twice", () => {
    const f = fixture(), r = recordingContext();
    f.comparison.ground.changedCells = [{ gx: 3, gy: 4, beforeRuid: "grass", afterRuid: null }];
    drawGameComparison(r.ctx, f.baseline, f.current, f.comparison, f.images, camera, { ground: true, objects: false, blocked: false, npcs: false });
    const outline = r.strokes.find(stroke => stroke.color === GAME_COMPARISON_COLORS.groundChanged)!;
    // TW=64, TH=32: center=(500 - 32*.8, 500 + 7*16*.8), half-height=16*.8.
    near(outline.path[0].values, [474.4, 576.8]);
    near(outline.path[1].values, [500, 589.6]);
    near(outline.path[2].values, [474.4, 602.4]);
    near(outline.path[3].values, [448.8, 589.6]);
    expect(r.images).toEqual([]);
  });
  it("distinguishes unchanged material cells affected by a 4x4 repack from direct changes and outlines the full old block", () => {
    const f = fixture(), r = recordingContext();
    f.comparison.ground = {
      changedCells: [{ gx: 3, gy: 4, beforeRuid: "grass", afterRuid: "road" }],
      repackedCells: [[2, 3], [2, 4], [3, 3]],
      affectedBeforeBlocks: [{ name: "Tile_2_3", gx: 2, gy: 3, size: 4, ruid: "grass-4x4" }],
      replacementBlocks: [{ name: "Tile_2_3", gx: 2, gy: 3, size: 1, ruid: "grass-1x1" }],
    };
    drawGameComparison(r.ctx, f.baseline, f.current, f.comparison, f.images, camera, { ground: true, objects: false, blocked: false, npcs: false });
    expect(r.fills.filter(fill => fill.color === GAME_COMPARISON_COLORS.groundRepacked + "12")).toHaveLength(3);
    expect(r.fills.filter(fill => fill.color === GAME_COMPARISON_COLORS.groundChanged + "32")).toHaveLength(1);
    const block = r.strokes.find(stroke => stroke.dash.join(",") === "6,4")!;
    near(block.path[0].values, [474.4, 551.2]);
    near(block.path[1].values, [576.8, 602.4]);
    near(block.path[2].values, [474.4, 653.6]);
    near(block.path[3].values, [372, 602.4]);
  });
  it("hatches only added/removed blocked cells in separate colors and clips every hatch to its diamond", () => {
    const f = fixture(), r = recordingContext();
    f.comparison.blocked = { added: [[4, 5]], removed: [[2, 2]] };
    drawGameComparison(r.ctx, f.baseline, f.current, f.comparison, f.images, camera, { ground: false, objects: false, blocked: true, npcs: false });
    expect(r.clips).toHaveLength(2);
    expect(r.strokes.map(stroke => stroke.color)).toEqual([
      GAME_COMPARISON_COLORS.removed, GAME_COMPARISON_COLORS.removed,
      GAME_COMPARISON_COLORS.added, GAME_COMPARISON_COLORS.added,
    ]);
    expect(r.fills.map(fill => fill.color)).toEqual([GAME_COMPARISON_COLORS.removed + "32", GAME_COMPARISON_COLORS.added + "32"]);
    expect(r.strokes[1].path.length).toBeGreaterThan(2); expect(r.strokes[3].path.length).toBeGreaterThan(2);
    expect(r.images).toEqual([]); expect(r.stack).toEqual([]);
  });
  it("filters overlays independently and draws nothing for an unchanged comparison", () => {
    const f = fixture(), r = recordingContext();
    drawGameComparison(r.ctx, f.baseline, f.current, f.comparison, f.images, camera, { ground: false, objects: false, blocked: false, npcs: false });
    expect(r.images).toEqual([]); expect(r.strokes).toEqual([]); expect(r.fills).toEqual([]);
    drawGameComparison(r.ctx, f.baseline, f.baseline.scene, emptyComparison(), f.images, camera, all);
    expect(r.images).toEqual([]); expect(r.strokes).toEqual([]); expect(r.fills).toEqual([]);
  });
});

function npcFixture() {
  const f = fixture();
  const npcSprite = (id: string, index: number) => sprite(id, { objectEntityId: undefined, npcEntityId: id, kind: "other", sourceOrder: index,
    scale: [-1.2, 1.2], flipX: false, position: [index * 0.5, -9, -9 * 0.21875] });
  const moved = npcSprite("npc-moved", 0), removed = npcSprite("npc-removed", 1), updated = npcSprite("npc-updated", 2), untouched = npcSprite("npc-untouched", 3);
  const movedCurrent = { ...moved, position: [moved.position[0] + 1.28, moved.position[1] - 0.64, moved.position[2] - 0.14] as [number, number, number], scale: [1.2, 1.2] as [number, number] };
  const updatedCurrent = { ...updated, scale: [1.2, 1.2] as [number, number] };
  const added = npcSprite("npc-added", 4);
  const descriptor = (item: GamePreviewSprite, previous?: GamePreviewSprite) => ({
    entityId: item.npcEntityId!, spawnId: item.npcEntityId!, npcClassId: 101, name: "NPC " + item.npcEntityId,
    cell: [1, 1] as [number, number], sourceCell: previous ? [1, 1] as [number, number] : null,
    position: item.position, ruid: item.ruid, bodyScale: 1.2, flipX: item.scale[0] < 0, dialogId: "10100", enabled: true,
    sourceFlipX: previous ? previous.scale[0] < 0 : null, sourceDialogId: previous ? "10100" : null, canEdit: true,
  });
  const sourceId = "52e1af49-baae-433e-b886-aad8421bcf82";
  f.baseline.npcSourceId = sourceId;
  f.baseline.scene = { ...f.baseline.scene, sprites: [moved, removed, updated, untouched],
    npcs: [moved, removed, updated, untouched].map(item => descriptor(item, item)),
    npcSource: { sourceId, stale: false, changedFiles: [], refreshAvailable: true } };
  f.current = { ...f.current, sprites: [movedCurrent, updatedCurrent, untouched, added],
    npcs: [descriptor(movedCurrent, moved), descriptor(updatedCurrent, updated), descriptor(untouched, untouched), descriptor(added)],
    npcSource: { sourceId, stale: false, changedFiles: [], refreshAvailable: true } };
  f.comparison.objects = { moved: [], added: [], removed: [] };
  f.comparison.npcs = {
    moved: [{ entityId: moved.npcEntityId!, from: moved.position, to: movedCurrent.position }],
    added: [{ entityId: added.npcEntityId!, position: added.position }],
    removed: [{ entityId: removed.npcEntityId!, position: removed.position }],
    updated: [{ entityId: moved.npcEntityId!, position: movedCurrent.position }, { entityId: updated.npcEntityId!, position: updatedCurrent.position }],
  };
  f.images = new Map([moved, removed, updated, untouched, added].map(item => [item.ruid, {
    asset: { ...asset }, image: { id: item.ruid, naturalWidth: asset.width, naturalHeight: asset.height } as unknown as HTMLImageElement,
  }]));
  return { ...f, npcMoved: moved, npcMovedCurrent: movedCurrent, npcRemoved: removed, npcUpdated: updated, npcAdded: added };
}
const onlyNpcs: GameComparisonFilters = { ground: false, objects: false, blocked: false, npcs: true };

describe("NPC comparison source and overlays", () => {
  it("counts move plus settings on the same NPC and accepts legacy responses without NPC diagnostics", () => {
    const f = npcFixture();
    expect(validateComparisonPair(f.baseline, f.current, f.comparison)).toBe(true);
    expect(getComparisonCounts(f.comparison)).toMatchObject({ npcsMoved: 1, npcsAdded: 1, npcsRemoved: 1, npcsUpdated: 2 });
    const legacy = fixture();
    expect(validateComparisonPair(legacy.baseline, legacy.current, legacy.comparison)).toBe(true);
    expect(getComparisonCounts(legacy.comparison)).toMatchObject({ npcsMoved: 0, npcsAdded: 0, npcsRemoved: 0, npcsUpdated: 0 });
  });
  it.each(["wrapper", "original", "current", "missing"])("rejects a different %s NPC source before drawing", kind => {
    const f = npcFixture(), r = recordingContext();
    if (kind === "wrapper") f.baseline.npcSourceId = "another-source";
    if (kind === "original") f.baseline.scene.npcSource!.sourceId = "another-source";
    if (kind === "current") f.current.npcSource!.sourceId = "another-source";
    if (kind === "missing") delete f.current.npcSource;
    expect(() => drawGameComparison(r.ctx, f.baseline, f.current, f.comparison, f.images, camera, onlyNpcs)).toThrow("비교 데이터");
    expect(r.images).toEqual([]); expect(r.strokes).toEqual([]); expect(r.fills).toEqual([]);
  });
  it.each(["duplicate", "wrong position", "unknown ID", "added already existed", "removed still exists", "unchanged settings"])("rejects invalid NPC %s diagnostics", kind => {
    const f = npcFixture(), diff = f.comparison.npcs!;
    if (kind === "duplicate") diff.moved.push(diff.moved[0]);
    if (kind === "wrong position") diff.moved[0] = { ...diff.moved[0], to: [0, 0, 0] };
    if (kind === "unknown ID") diff.updated[0].entityId = "missing";
    if (kind === "added already existed") diff.added[0] = { entityId: f.npcMoved.npcEntityId!, position: f.npcMovedCurrent.position };
    if (kind === "removed still exists") diff.removed[0] = { entityId: f.npcMoved.npcEntityId!, position: f.npcMoved.position };
    if (kind === "unchanged settings") f.current.npcs!.find(n => n.entityId === f.npcUpdated.npcEntityId)!.flipX = true;
    expect(() => validateComparisonPair(f.baseline, f.current, f.comparison)).toThrow("비교 데이터");
  });
  it("draws original moved/deleted/settings NPC ghosts once each, with color outlines and a world anchor connector", () => {
    const f = npcFixture(), r = recordingContext();
    drawGameComparison(r.ctx, f.baseline, f.current, f.comparison, f.images, camera, onlyNpcs);
    expect(r.images).toHaveLength(3); // A moved+updated NPC has only one ghost.
    expect(new Set(r.images.map(item => item.image))).toEqual(new Set([f.npcMoved, f.npcRemoved, f.npcUpdated].map(item => f.images.get(item.ruid)!.image)));
    for (const image of r.images) expect(image.alpha).toBeCloseTo(0.75 * 0.24);
    const added = r.strokes.find(stroke => stroke.color === GAME_COMPARISON_COLORS.added)!;
    const [a, b, c, d, tx, ty] = previewSpriteGeometry(f.npcAdded, asset, f.current, camera).matrix;
    near(added.path[0].values, [tx, ty]); near(added.path[2].values, [a * asset.width + c * asset.height + tx, b * asset.width + d * asset.height + ty]);
    expect(r.strokes.filter(stroke => stroke.color === GAME_COMPARISON_COLORS.removed)).toHaveLength(1);
    expect(r.strokes.filter(stroke => stroke.color === GAME_COMPARISON_COLORS.npcUpdated)).toHaveLength(2);
    const connector = r.strokes.find(stroke => stroke.dash.join(",") === "4,3")!;
    near(connector.path[0].values, previewWorldToScreen(f.npcMoved.position, f.baseline.scene, camera));
    near(connector.path[1].values, previewWorldToScreen(f.npcMovedCurrent.position, f.current, camera));
    expect(r.ctx.globalAlpha).toBe(0.75); expect(r.ctx.strokeStyle).toBe("initial-stroke"); expect(r.stack).toEqual([]);
  });
  it("filters NPC overlays independently without changing scenes or selectable entities", () => {
    const f = npcFixture(), r = recordingContext(), before = JSON.stringify(f);
    freezeDeep(f.baseline); freezeDeep(f.current); freezeDeep(f.comparison);
    drawGameComparison(r.ctx, f.baseline, f.current, f.comparison, f.images, camera, { ...onlyNpcs, npcs: false });
    expect(r.images).toEqual([]); expect(r.strokes).toEqual([]); expect(r.fills).toEqual([]);
    drawGameComparison(r.ctx, f.baseline, f.current, f.comparison, f.images, camera, onlyNpcs);
    expect(f.current.sprites.some(item => item.npcEntityId === f.npcRemoved.npcEntityId)).toBe(false);
    expect(JSON.stringify(f)).toBe(before);
  });
  it("keeps real foot anchors and counts when metadata is unresolved without inventing image bounds", () => {
    const f = npcFixture(), r = recordingContext(); f.images.clear();
    drawGameComparison(r.ctx, f.baseline, f.current, f.comparison, f.images, camera, onlyNpcs);
    expect(r.images).toEqual([]); expect(r.transforms).toEqual([]); expect(r.strokes).toHaveLength(2);
    expect(r.fills.every(fill => fill.path[0].operation === "arc")).toBe(true);
    expect(getComparisonCounts(f.comparison).npcsRemoved).toBe(1);
  });
});
