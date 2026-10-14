import { cellToScreen, TW, TH, type Camera, type Dims } from "./grid";
import { parseCellKey, type CellKey } from "./cell";
import { drawGamePreview, previewWorldToScreen, type GamePreviewScene, type GamePreviewSprite, type GamePreviewImages } from "./gamePreview";
import { drawGameObjectSelection, offsetObjectPosition, sceneWithObjectDraft } from "./gameObjectPreview";
import type { GameObjectDescriptor } from "./gameObjects";

/** UI-only, scoped to one successful edit and its exact document/selection versions. */
export interface GameMoveFeedback {
  baselineId: string; mapName: string; documentNonce: number; gameObjectsVer: number; blockedVer: number;
  ids: string[]; cells: CellKey[]; beforeCells: CellKey[];
  unit: "cell" | "pixel"; delta: [number, number];
  sprites: GamePreviewSprite[]; objects: GameObjectDescriptor[];
  from: [number, number]; to: [number, number];
}
export interface MovementState {
  gameSync: { baselineId: string; mapName: string } | undefined;
  documentNonce: number; gameObjectsVer: number; blockedVer: number;
  selectedGameObjectIds: string[]; selectedBlockedCells: CellKey[];
  gameSelectionError: string | null; gameMoveFeedback: GameMoveFeedback | null;
}
const signed = (n: number) => (n > 0 ? "+" : "") + Number(n.toFixed(4));
export function movementLabel(feedback: Pick<GameMoveFeedback, "unit" | "delta">): string {
  const [x, y] = feedback.delta;
  return feedback.unit === "cell" ? "X " + signed(x) + "칸 · Y " + signed(y) + "칸"
    : "가로 " + signed(x) + "px · 세로 " + signed(y) + "px";
}
export function visibleMovementFeedback(state: MovementState): GameMoveFeedback | null {
  const f = state.gameMoveFeedback;
  if (!f || state.gameSelectionError || state.gameSync?.baselineId !== f.baselineId || state.gameSync.mapName !== f.mapName ||
    state.documentNonce !== f.documentNonce || state.gameObjectsVer !== f.gameObjectsVer || state.blockedVer !== f.blockedVer ||
    JSON.stringify(state.selectedGameObjectIds) !== JSON.stringify(f.ids) || JSON.stringify(state.selectedBlockedCells) !== JSON.stringify(f.cells)) return null;
  return f;
}
export function makeMovementFeedback(scene: GamePreviewScene, state: Pick<MovementState, "documentNonce" | "gameObjectsVer" | "blockedVer">,
  ids: string[], beforeCells: CellKey[], cells: CellKey[], delta: [number, number], unit: "cell" | "pixel" = "cell",
): GameMoveFeedback | null {
  if (!delta.every(Number.isFinite) || !delta.some(n => n !== 0)) return null;
  const selected = new Set(ids);
  const sprites = scene.sprites.filter(s => s.objectEntityId && selected.has(s.objectEntityId));
  const objects = (scene.objects ?? []).filter(o => selected.has(o.entityId));
  const primary = sprites.find(s => s.objectEntityId === ids[ids.length - 1]) ?? sprites[0];
  const object = objects.find(o => o.entityId === ids[ids.length - 1]) ?? objects[0];
  let from: [number, number];
  if (primary) from = [primary.position[0] + (primary.visualOffset?.[0] ?? 0), primary.position[1] + (primary.visualOffset?.[1] ?? 0)];
  else if (object) from = [object.position[0], object.position[1]];
  else if (beforeCells.length) {
    const [x, y] = parseCellKey(beforeCells[0]), c = scene.constants;
    const gx = x + scene.groundOrigin[0] - c.ORIGIN_X, gy = y + scene.groundOrigin[1] - c.ORIGIN_Y;
    from = [(gx - gy) * c.TILE_W / 2, -(gx + gy) * c.TILE_H / 2];
  } else return null;
  const to: [number, number] = unit === "cell" ? offsetObjectPosition(from, ...delta, scene) : [from[0] + delta[0] / 100, from[1] + delta[1] / 100];
  return { documentNonce: state.documentNonce, gameObjectsVer: state.gameObjectsVer, blockedVer: state.blockedVer, baselineId: scene.baselineId, mapName: scene.mapName, ids: [...ids], cells: [...cells], beforeCells: [...beforeCells],
    unit, delta: [...delta], from, to, sprites: structuredClone(sprites), objects: structuredClone(objects) };
}
/** Absolute targets from the captured edit: safe both before AND after the server preview arrives. */
export function sceneWithMovementFeedback(scene: GamePreviewScene, feedback: GameMoveFeedback | null): GamePreviewScene {
  if (!feedback || scene.baselineId !== feedback.baselineId || scene.mapName !== feedback.mapName) return scene;
  let next = scene;
  for (const before of feedback.sprites) {
    const id = before.objectEntityId!;
    if (feedback.unit === "cell") next = sceneWithObjectDraft(next, id, offsetObjectPosition(before.position, ...feedback.delta, scene));
    else next = { ...next, sprites: next.sprites.map(s => s.objectEntityId !== id ? s : { ...s, visualOffset: [
      (before.visualOffset?.[0] ?? 0) + feedback.delta[0] / 100,
      (before.visualOffset?.[1] ?? 0) + feedback.delta[1] / 100,
    ] }) };
  }
  return next;
}
export function drawMovementFeedback(ctx: CanvasRenderingContext2D, feedback: GameMoveFeedback, scene: GamePreviewScene,
  images: GamePreviewImages, camera: Camera, dims: Dims): void {
  const beforeScene = { ...scene, sprites: feedback.sprites, objects: feedback.objects };
  ctx.save(); ctx.globalAlpha *= 0.22;
  drawGamePreview(ctx, beforeScene, images, camera, dims);
  ctx.restore();
  ctx.save(); ctx.globalAlpha *= 0.65;
  for (const id of feedback.ids) drawGameObjectSelection(ctx, id, beforeScene, images, camera, "#75dce8");
  ctx.strokeStyle = "#75dce8"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
  for (const key of feedback.beforeCells) {
    const [x, y] = cellToScreen(...parseCellKey(key), camera), w = TW * camera.zoom / 2, h = TH * camera.zoom / 2;
    ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w, y); ctx.lineTo(x, y + h); ctx.lineTo(x - w, y); ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
  const from = previewWorldToScreen(feedback.from, scene, camera), to = previewWorldToScreen(feedback.to, scene, camera);
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  ctx.save(); ctx.setLineDash([]); ctx.strokeStyle = "#132832"; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(...from); ctx.lineTo(...to); ctx.stroke();
  ctx.strokeStyle = "#75dce8"; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = "#75dce8"; ctx.beginPath(); ctx.arc(...from, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffd166";
  if (Math.hypot(to[0] - from[0], to[1] - from[1]) >= 8) {
    ctx.beginPath(); ctx.moveTo(...to);
    for (const a of [angle - Math.PI / 6, angle + Math.PI / 6]) ctx.lineTo(to[0] - 11 * Math.cos(a), to[1] - 11 * Math.sin(a));
    ctx.closePath(); ctx.fill();
  } else { ctx.beginPath(); ctx.arc(...to, 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
