import {
  drawGamePreview, previewSpriteGeometry, previewWorldToScreen, validPreviewAsset,
  type GamePreviewImages, type GamePreviewScene,
} from "./gamePreview";
import { drawGameObjectSelection } from "./gameObjectPreview";
import { cellToScreen, type Camera } from "./grid";

export interface GameBaselinePreview {
  version: 1;
  baselineId: string;
  mapName: string;
  size: [number, number];
  groundOrigin: [number, number];
  scene: GamePreviewScene;
  /** NPCs may have a newer immutable source than the native map baseline. */
  npcSourceId?: string | null;
  runtimeSourceId?: string | null;
  /** Logical 1x1 material RUIDs, independent of palette indices and native block size. */
  ground: [number, number, string][];
  blocked: [number, number][];
}
export interface GameComparisonGroundBlock {
  name: string;
  gx: number;
  gy: number;
  size: number;
  ruid: string;
}
export interface RuntimePlacementChanges {
  moved: { entityId: string; from: [number, number, number]; to: [number, number, number] }[];
  added: { entityId: string; position: [number, number, number] }[];
  removed: { entityId: string; position: [number, number, number] }[];
  updated: { entityId: string; position: [number, number, number] }[];
}
export interface GameComparison {
  version: 1;
  baselineId: string;
  mapName: string;
  ground: {
    changedCells: { gx: number; gy: number; beforeRuid: string | null; afterRuid: string | null }[];
    /** Cells repacked because their original block was touched, excluding direct changes. */
    repackedCells: [number, number][];
    affectedBeforeBlocks: GameComparisonGroundBlock[];
    replacementBlocks: GameComparisonGroundBlock[];
  };
  objects: {
    moved: { entityId: string; from: [number, number, number]; to: [number, number, number] }[];
    added: { entityId: string; prototypeId: string; position: [number, number, number] }[];
    removed: { entityId: string; position: [number, number, number] }[];
  };
  blocked: { added: [number, number][]; removed: [number, number][] };
  monsters?: RuntimePlacementChanges;
  portals?: RuntimePlacementChanges;
  spawn?: { from: [number, number, number]; to: [number, number, number] } | null;
  npcs?: {
    moved: { entityId: string; from: [number, number, number]; to: [number, number, number] }[];
    added: { entityId: string; position: [number, number, number] }[];
    removed: { entityId: string; position: [number, number, number] }[];
    updated: { entityId: string; position: [number, number, number] }[];
  };
}
export interface GameComparisonFilters { ground: boolean; objects: boolean; blocked: boolean; npcs: boolean; monsters?: boolean; portals?: boolean; spawn?: boolean }
export interface GameComparisonCounts {
  groundChangedCells: number;
  groundRepackedCells: number;
  objectsMoved: number;
  objectsAdded: number;
  objectsRemoved: number;
  blockedAdded: number;
  blockedRemoved: number;
  npcsMoved: number; npcsAdded: number; npcsRemoved: number; npcsUpdated: number;
  monstersMoved: number; monstersAdded: number; monstersRemoved: number; monstersUpdated: number;
  portalsMoved: number; portalsAdded: number; portalsRemoved: number; portalsUpdated: number;
  spawnChanged: number;
}
/** Shared legend: blue direct ground edits, amber repack/move, green additions, red removals. */
export const GAME_COMPARISON_COLORS = {
  groundChanged: "#4dabf7",
  groundRepacked: "#f5b942",
  objectMoved: "#f5b942",
  npcUpdated: "#4dabf7",
  added: "#52d18b",
  removed: "#f07178",
} as const;

export function getComparisonCounts(comparison: GameComparison): GameComparisonCounts {
  return {
    groundChangedCells: comparison.ground.changedCells.length,
    groundRepackedCells: comparison.ground.repackedCells.length,
    objectsMoved: comparison.objects.moved.length,
    objectsAdded: comparison.objects.added.length,
    objectsRemoved: comparison.objects.removed.length,
    blockedAdded: comparison.blocked.added.length,
    blockedRemoved: comparison.blocked.removed.length,
    npcsMoved: comparison.npcs?.moved.length ?? 0, npcsAdded: comparison.npcs?.added.length ?? 0,
    npcsRemoved: comparison.npcs?.removed.length ?? 0, npcsUpdated: comparison.npcs?.updated.length ?? 0,
    monstersMoved: comparison.monsters?.moved.length ?? 0, monstersAdded: comparison.monsters?.added.length ?? 0,
    monstersRemoved: comparison.monsters?.removed.length ?? 0, monstersUpdated: comparison.monsters?.updated.length ?? 0,
    portalsMoved: comparison.portals?.moved.length ?? 0, portalsAdded: comparison.portals?.added.length ?? 0,
    portalsRemoved: comparison.portals?.removed.length ?? 0, portalsUpdated: comparison.portals?.updated.length ?? 0,
    spawnChanged: comparison.spawn ? 1 : 0,
  };
}
const finiteVector = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) && value.length === length && value.every(Number.isFinite);
const equalNumbers = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);
function invalidComparison(): never {
  throw new Error("원본과 현재 배치의 비교 데이터가 일치하지 않습니다. 비교 화면을 다시 불러오세요.");
}

/** This validates a response pair; it neither reads the editor store nor changes either scene. */
export function validateComparisonPair(
  baseline: GameBaselinePreview, current: GamePreviewScene, comparison: GameComparison,
): true {
  const scenes = [baseline.scene, current];
  const runtimeSourceId = baseline.runtimeSourceId ?? null;
  if (runtimeSourceId !== null && (typeof runtimeSourceId !== "string" || !runtimeSourceId)) invalidComparison();
  if (scenes.some(scene => (scene.runtimeSource?.sourceId ?? null) !== runtimeSourceId)) invalidComparison();
  const npcSourceId = baseline.npcSourceId ?? null;
  if (npcSourceId !== null && (typeof npcSourceId !== "string" || !npcSourceId)) invalidComparison();
  if (scenes.some(scene => (scene.npcSource?.sourceId ?? null) !== npcSourceId)) invalidComparison();
  if (baseline.version !== 1 || comparison.version !== 1 || !baseline.baselineId || !baseline.mapName ||
    comparison.baselineId !== baseline.baselineId || comparison.mapName !== baseline.mapName ||
    !finiteVector(baseline.size, 2) || baseline.size.some(value => !Number.isSafeInteger(value) || value <= 0) ||
    !finiteVector(baseline.groundOrigin, 2)) invalidComparison();
  for (const scene of scenes) {
    if (scene.version !== 1 || scene.baselineId !== baseline.baselineId || scene.mapName !== baseline.mapName ||
      !finiteVector(scene.groundOrigin, 2) || !equalNumbers(scene.groundOrigin, baseline.groundOrigin)) invalidComparison();
  }
  const constantKeys = ["TILE_W", "TILE_H", "ORIGIN_X", "ORIGIN_Y", "PPU", "DEPTH_SCALE", "GROUND_ORDER"] as const;
  if (constantKeys.some(key => !Number.isFinite(baseline.scene.constants[key]) ||
    current.constants[key] !== baseline.scene.constants[key]) ||
    current.constants.TILE_W <= 0 || current.constants.TILE_H <= 0 || current.constants.PPU <= 0 ||
    current.defaultSortingLayer !== baseline.scene.defaultSortingLayer) invalidComparison();

  const validCell = (x: number, y: number) => Number.isSafeInteger(x) && Number.isSafeInteger(y) &&
    x >= 0 && y >= 0 && x < baseline.size[0] && y < baseline.size[1];
  const cells = (items: [number, number][]) => {
    const seen = new Set<string>();
    for (const tuple of items) {
      if (!finiteVector(tuple, 2) || !validCell(tuple[0], tuple[1])) invalidComparison();
      const key = tuple.join(",");
      if (seen.has(key)) invalidComparison();
      seen.add(key);
    }
    return seen;
  };
  const changed = cells(comparison.ground.changedCells.map(cell => [cell.gx, cell.gy]));
  const repacked = cells(comparison.ground.repackedCells);
  if ([...repacked].some(key => changed.has(key))) invalidComparison();
  for (const cell of comparison.ground.changedCells) {
    if (cell.beforeRuid === cell.afterRuid ||
      [cell.beforeRuid, cell.afterRuid].some(ruid => ruid !== null && (typeof ruid !== "string" || !ruid))) invalidComparison();
  }
  for (const block of [...comparison.ground.affectedBeforeBlocks, ...comparison.ground.replacementBlocks]) {
    if (!block.name || !block.ruid || !Number.isSafeInteger(block.size) || block.size <= 0 ||
      !validCell(block.gx, block.gy) || !validCell(block.gx + block.size - 1, block.gy + block.size - 1)) invalidComparison();
  }
  const addedBlocked = cells(comparison.blocked.added), removedBlocked = cells(comparison.blocked.removed);
  if ([...addedBlocked].some(key => removedBlocked.has(key))) invalidComparison();
  const objectIds = new Set<string>();
  const addId = (id: string) => {
    if (!id || objectIds.has(id)) invalidComparison();
    objectIds.add(id);
  };
  for (const item of comparison.objects.moved) {
    addId(item.entityId);
    if (!finiteVector(item.from, 3) || !finiteVector(item.to, 3)) invalidComparison();
  }
  for (const item of [...comparison.objects.added, ...comparison.objects.removed]) {
    addId(item.entityId);
    if (!finiteVector(item.position, 3)) invalidComparison();
  }
  if (comparison.npcs) {
    const oldNpcs = new Map((baseline.scene.npcs ?? []).map(item => [item.entityId, item]));
    const currentNpcs = new Map((current.npcs ?? []).map(item => [item.entityId, item]));
    if (oldNpcs.size !== (baseline.scene.npcs ?? []).length || currentNpcs.size !== (current.npcs ?? []).length) invalidComparison();
    const idsFor = (items: { entityId: string }[]) => {
      if (!Array.isArray(items)) invalidComparison();
      const ids = new Set<string>();
      for (const item of items) { if (!item.entityId || ids.has(item.entityId)) invalidComparison(); ids.add(item.entityId); }
    };
    const positionMatches = (actual: unknown, expected?: readonly number[]) =>
      finiteVector(actual, 3) && !!expected && equalNumbers(actual, expected);
    for (const key of ["moved", "added", "removed", "updated"] as const) idsFor(comparison.npcs[key]);
    for (const item of comparison.npcs.moved) {
      if (!positionMatches(item.from, oldNpcs.get(item.entityId)?.position) ||
        !positionMatches(item.to, currentNpcs.get(item.entityId)?.position) || equalNumbers(item.from, item.to)) invalidComparison();
    }
    for (const item of comparison.npcs.added) {
      if (oldNpcs.has(item.entityId) || !positionMatches(item.position, currentNpcs.get(item.entityId)?.position)) invalidComparison();
    }
    for (const item of comparison.npcs.removed) {
      if (currentNpcs.has(item.entityId) || !positionMatches(item.position, oldNpcs.get(item.entityId)?.position)) invalidComparison();
    }
    // A move and a setting edit may describe the same NPC; additions/removals cannot.
    for (const item of comparison.npcs.updated) {
      const previous = oldNpcs.get(item.entityId), next = currentNpcs.get(item.entityId);
      if (!previous || !next || !positionMatches(item.position, next.position) ||
        (previous.flipX === next.flipX && previous.dialogId === next.dialogId)) invalidComparison();
    }
  }
  for (const kind of ["monsters", "portals"] as const) {
    const diff = comparison[kind];
    if (!diff) continue;
    const before = new Map((baseline.scene[kind] ?? []).map(item => [item.entityId, item]));
    const after = new Map((current[kind] ?? []).map(item => [item.entityId, item]));
    if (before.size !== (baseline.scene[kind] ?? []).length || after.size !== (current[kind] ?? []).length) invalidComparison();
    const matches = (position: unknown, expected?: readonly number[]) => finiteVector(position, 3) && !!expected && equalNumbers(position, expected);
    for (const key of ["moved", "added", "removed", "updated"] as const) {
      if (!Array.isArray(diff[key]) || new Set(diff[key].map(item => item.entityId)).size !== diff[key].length) invalidComparison();
    }
    for (const item of diff.moved) {
      if (!matches(item.from, before.get(item.entityId)?.position) || !matches(item.to, after.get(item.entityId)?.position) || equalNumbers(item.from, item.to)) invalidComparison();
    }
    for (const item of diff.added) if (before.has(item.entityId) || !matches(item.position, after.get(item.entityId)?.position)) invalidComparison();
    for (const item of diff.removed) if (after.has(item.entityId) || !matches(item.position, before.get(item.entityId)?.position)) invalidComparison();
    for (const item of diff.updated) {
      const previous = before.get(item.entityId), next = after.get(item.entityId);
      if (!previous || !next || !matches(item.position, next.position)) invalidComparison();
      const settings = kind === "monsters" ? ["monsterClassId","count","spread","respawnMinSec","respawnMaxSec","firstSpawnSec","enabled"]
        : ["destMap","destCell","destFacing","enabled"];
      if (settings.every(key => JSON.stringify(Reflect.get(previous, key)) === JSON.stringify(Reflect.get(next, key)))) invalidComparison();
    }
  }
  if (comparison.spawn && (!finiteVector(comparison.spawn.from, 3) || !finiteVector(comparison.spawn.to, 3) ||
    !baseline.scene.spawn || !current.spawn || !equalNumbers(comparison.spawn.from, baseline.scene.spawn.position) ||
    !equalNumbers(comparison.spawn.to, current.spawn.position) || equalNumbers(comparison.spawn.from, comparison.spawn.to))) invalidComparison();
  return true;
}

type Point = [number, number];
/** The cell/block boundary uses the same logical-cell center projection as the editor grid. */
function blockPolygon(gx: number, gy: number, size: number, camera: Camera): Point[] {
  return [
    [gx - 0.5, gy - 0.5], [gx + size - 0.5, gy - 0.5],
    [gx + size - 0.5, gy + size - 0.5], [gx - 0.5, gy + size - 0.5],
  ].map(([x, y]) => cellToScreen(x, y, camera));
}
function polygonPath(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath(); ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
}
function drawCell(ctx: CanvasRenderingContext2D, cell: [number, number], camera: Camera, color: string, hatch = false, faint = false) {
  const points = blockPolygon(...cell, 1, camera);
  ctx.save(); polygonPath(ctx, points);
  ctx.fillStyle = color + (faint ? "12" : "32"); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = faint ? 1 : 1.5;
  ctx.setLineDash(faint ? [3, 3] : []); ctx.stroke();
  if (hatch) {
    ctx.clip(); ctx.setLineDash([]); ctx.lineWidth = 1;
    const x0 = Math.min(...points.map(p => p[0])), x1 = Math.max(...points.map(p => p[0]));
    const y0 = Math.min(...points.map(p => p[1])), y1 = Math.max(...points.map(p => p[1]));
    ctx.beginPath();
    for (let x = x0 - (y1 - y0); x < x1; x += 8) {
      ctx.moveTo(x, y0); ctx.lineTo(x + y1 - y0, y1);
    }
    ctx.stroke();
  }
  ctx.restore();
}
function outlineObject(
  ctx: CanvasRenderingContext2D, id: string, scene: GamePreviewScene, images: GamePreviewImages, camera: Camera, color: string,
) {
  const sprite = scene.sprites.find(item => item.objectEntityId === id);
  const asset = sprite && images.get(sprite.ruid)?.asset;
  if (asset && validPreviewAsset(asset)) drawGameObjectSelection(ctx, id, scene, images, camera, color);
}
function outlineNpc(
  ctx: CanvasRenderingContext2D, id: string, scene: GamePreviewScene, images: GamePreviewImages, camera: Camera, color: string,
  kind: "npcs" | "monsters" | "portals" = "npcs",
) {
  const npc = scene[kind]?.find(item => item.entityId === id);
  if (!npc) return;
  const sprite = scene.sprites.find(item => (kind === "npcs" ? item.npcEntityId : kind === "monsters" ? item.monsterEntityId : item.portalEntityId) === id), asset = sprite && images.get(sprite.ruid)?.asset;
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
  if (sprite && asset && validPreviewAsset(asset)) {
    const [a, b, c, d, tx, ty] = previewSpriteGeometry(sprite, asset, scene, camera).matrix;
    const points: Point[] = [[0, 0], [asset.width, 0], [asset.width, asset.height], [0, asset.height]]
      .map(([x, y]) => [a * x + c * y + tx, b * x + d * y + ty]);
    polygonPath(ctx, points); ctx.stroke();
  }
  const point = previewWorldToScreen(npc.position, scene, camera);
  ctx.setLineDash([]); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(...point, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
function drawConnector(ctx: CanvasRenderingContext2D, from: Point, to: Point) {
  const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy);
  if (length < 0.01) return;
  ctx.save(); ctx.strokeStyle = GAME_COMPARISON_COLORS.objectMoved; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(...from); ctx.lineTo(...to); ctx.stroke();
  ctx.setLineDash([]); const angle = Math.atan2(dy, dx), head = Math.min(8, length / 3);
  ctx.beginPath();
  ctx.moveTo(to[0] - Math.cos(angle - Math.PI / 6) * head, to[1] - Math.sin(angle - Math.PI / 6) * head);
  ctx.lineTo(...to);
  ctx.lineTo(to[0] - Math.cos(angle + Math.PI / 6) * head, to[1] - Math.sin(angle + Math.PI / 6) * head);
  ctx.stroke(); ctx.restore();
}

/** Draw after the current scene. Ghosts are a separate overlay, never injected into hit-test/edit scenes.
 * The caller owns view switching and keeps the same camera for original/current/highlight views.
 */
export function drawGameComparison(
  ctx: CanvasRenderingContext2D, baseline: GameBaselinePreview, currentScene: GamePreviewScene,
  comparison: GameComparison, images: GamePreviewImages, camera: Camera, filters: GameComparisonFilters,
): void {
  validateComparisonPair(baseline, currentScene, comparison);
  if (filters.ground) {
    for (const cell of comparison.ground.repackedCells) drawCell(ctx, cell, camera, GAME_COMPARISON_COLORS.groundRepacked, false, true);
    for (const block of comparison.ground.affectedBeforeBlocks) {
      ctx.save(); polygonPath(ctx, blockPolygon(block.gx, block.gy, block.size, camera));
      ctx.strokeStyle = GAME_COMPARISON_COLORS.groundRepacked; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.restore();
    }
    for (const cell of comparison.ground.changedCells) drawCell(ctx, [cell.gx, cell.gy], camera, GAME_COMPARISON_COLORS.groundChanged);
  }
  if (filters.objects) {
    const oldIds = new Set([...comparison.objects.moved, ...comparison.objects.removed].map(item => item.entityId));
    const ghosts = baseline.scene.sprites.filter(sprite => sprite.objectEntityId && oldIds.has(sprite.objectEntityId));
    if (ghosts.length) {
      ctx.save(); ctx.globalAlpha *= 0.24;
      // The backing canvas bounds only cull sprites; geometry remains in CSS pixels with the shared camera.
      drawGamePreview(ctx, { ...baseline.scene, sprites: ghosts }, images, camera, { w: ctx.canvas.width, h: ctx.canvas.height });
      ctx.restore();
    }
    for (const item of comparison.objects.removed) outlineObject(ctx, item.entityId, baseline.scene, images, camera, GAME_COMPARISON_COLORS.removed);
    for (const item of comparison.objects.moved) {
      outlineObject(ctx, item.entityId, baseline.scene, images, camera, GAME_COMPARISON_COLORS.objectMoved);
      outlineObject(ctx, item.entityId, currentScene, images, camera, GAME_COMPARISON_COLORS.objectMoved);
      drawConnector(ctx, previewWorldToScreen(item.from, baseline.scene, camera), previewWorldToScreen(item.to, currentScene, camera));
    }
    for (const item of comparison.objects.added) outlineObject(ctx, item.entityId, currentScene, images, camera, GAME_COMPARISON_COLORS.added);
  }
  for (const kind of ["npcs", "monsters", "portals"] as const) {
    const changed = comparison[kind];
    if (!filters[kind] || !changed) continue;
    const oldIds = new Set([...changed.moved, ...changed.removed, ...changed.updated].map(item => item.entityId));
    const ghosts = baseline.scene.sprites.filter(sprite => {
      const id = kind === "npcs" ? sprite.npcEntityId : kind === "monsters" ? sprite.monsterEntityId : sprite.portalEntityId;
      return !!id && oldIds.has(id);
    });
    if (ghosts.length) {
      ctx.save(); ctx.globalAlpha *= 0.24;
      drawGamePreview(ctx, { ...baseline.scene, sprites: ghosts }, images, camera, { w: ctx.canvas.width, h: ctx.canvas.height });
      ctx.restore();
    }
    for (const item of changed.removed) outlineNpc(ctx, item.entityId, baseline.scene, images, camera, GAME_COMPARISON_COLORS.removed, kind);
    for (const item of changed.moved) {
      outlineNpc(ctx, item.entityId, baseline.scene, images, camera, GAME_COMPARISON_COLORS.objectMoved, kind);
      outlineNpc(ctx, item.entityId, currentScene, images, camera, GAME_COMPARISON_COLORS.objectMoved, kind);
      drawConnector(ctx, previewWorldToScreen(item.from, baseline.scene, camera), previewWorldToScreen(item.to, currentScene, camera));
    }
    for (const item of changed.added) outlineNpc(ctx, item.entityId, currentScene, images, camera, GAME_COMPARISON_COLORS.added, kind);
    for (const item of changed.updated) outlineNpc(ctx, item.entityId, currentScene, images, camera, GAME_COMPARISON_COLORS.npcUpdated, kind);
  }
  if (filters.spawn && comparison.spawn) {
    const from = previewWorldToScreen(comparison.spawn.from, baseline.scene, camera);
    const to = previewWorldToScreen(comparison.spawn.to, currentScene, camera);
    drawConnector(ctx, from, to);
    ctx.save(); ctx.strokeStyle = GAME_COMPARISON_COLORS.objectMoved; ctx.lineWidth = 2;
    for (const point of [from, to]) { ctx.beginPath(); ctx.arc(...point, 9, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
  if (filters.blocked) {
    for (const cell of comparison.blocked.removed) drawCell(ctx, cell, camera, GAME_COMPARISON_COLORS.removed, true);
    for (const cell of comparison.blocked.added) drawCell(ctx, cell, camera, GAME_COMPARISON_COLORS.added, true);
  }
}
