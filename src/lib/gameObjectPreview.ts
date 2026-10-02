import {
  previewSpriteGeometry, previewWorldToScreen, sortPreviewSprites, validPreviewAsset,
  type GamePreviewAsset, type GamePreviewImages, type GamePreviewScene, type GamePreviewSprite,
} from "./gamePreview";
import type { Camera } from "./grid";
import { TW, TH } from "./grid";
import type { GameObjectDescriptor, GameObjectPosition } from "./gameObjects";

export function previewScreenToWorld(x: number, y: number, scene: GamePreviewScene, camera: Camera): GameObjectPosition {
  const origin = previewWorldToScreen([0, 0], scene, camera);
  return [(x - origin[0]) / (TW / scene.constants.TILE_W * camera.zoom),
    -(y - origin[1]) / (TH / scene.constants.TILE_H * camera.zoom)];
}
export function objectCellOffset(position: readonly number[], origin: readonly number[], scene: GamePreviewScene): [number, number] {
  const dx = (position[0] - origin[0]) / (scene.constants.TILE_W / 2);
  const dy = -(position[1] - origin[1]) / (scene.constants.TILE_H / 2);
  return [Math.round((dx + dy) / 2), Math.round((dy - dx) / 2)];
}
export function offsetObjectPosition(origin: readonly number[], gx: number, gy: number, scene: GamePreviewScene): GameObjectPosition {
  return [
    Number((origin[0] + (gx - gy) * scene.constants.TILE_W / 2).toFixed(8)),
    Number((origin[1] - (gx + gy) * scene.constants.TILE_H / 2).toFixed(8)),
  ];
}
export function snapObjectPosition(position: readonly number[], origin: readonly number[], scene: GamePreviewScene): GameObjectPosition {
  const [gx, gy] = objectCellOffset(position, origin, scene);
  return offsetObjectPosition(origin, gx, gy, scene);
}
/** Invert the same native-pivot/rotation/scale matrix used to draw, including negative scales. */
export function previewSpritePixelAt(
  sprite: GamePreviewSprite, asset: GamePreviewAsset, scene: GamePreviewScene, camera: Camera, x: number, y: number,
): [number, number] | null {
  const [a, b, c, d, tx, ty] = previewSpriteGeometry(sprite, asset, scene, camera).matrix;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  const px = (d * (x - tx) - c * (y - ty)) / det;
  const py = (-b * (x - tx) + a * (y - ty)) / det;
  return px >= 0 && py >= 0 && px < asset.width && py < asset.height ? [px, py] : null;
}
let alphaContext: CanvasRenderingContext2D | null | undefined;
function opaqueAt(image: HTMLImageElement, pixel: [number, number], asset: GamePreviewAsset): boolean {
  if (alphaContext === undefined) {
    const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
    alphaContext = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!alphaContext) return true;
  try {
    alphaContext.clearRect(0, 0, 1, 1);
    alphaContext.drawImage(image, Math.floor(pixel[0] * image.naturalWidth / asset.width),
      Math.floor(pixel[1] * image.naturalHeight / asset.height), 1, 1, 0, 0, 1, 1);
    return alphaContext.getImageData(0, 0, 1, 1).data[3] > 16;
  } catch { return false; } // Unreadable pixels must not select an invisible bounding-box corner.
}
export function gameObjectHitCandidates(
  x: number, y: number, scene: GamePreviewScene, images: GamePreviewImages, camera: Camera,
): GameObjectDescriptor[] {
  const objects = new Map((scene.objects ?? []).map(object => [object.entityId, object]));
  const found: GameObjectDescriptor[] = [];
  for (const sprite of sortPreviewSprites(scene).reverse()) {
    const object = sprite.objectEntityId ? objects.get(sprite.objectEntityId) : undefined;
    const resolved = images.get(sprite.ruid);
    if (!object || !resolved || (sprite.color?.[3] ?? 1) <= 0) continue;
    const pixel = previewSpritePixelAt(sprite, resolved.asset, scene, camera, x, y);
    if (pixel && opaqueAt(resolved.image, pixel, resolved.asset)) found.push(object);
  }
  return found;
}
function spriteWithDraftPosition(sprite: GamePreviewSprite, position: GameObjectPosition, scene: GamePreviewScene): GamePreviewSprite {
  return {
    ...sprite, position: [position[0], position[1], sprite.position[2] + (position[1] - sprite.position[1]) * scene.constants.DEPTH_SCALE],
  };
}
export function sceneWithObjectDraft(scene: GamePreviewScene, entityId: string, position: GameObjectPosition): GamePreviewScene {
  return { ...scene, sprites: scene.sprites.map(sprite => sprite.objectEntityId === entityId
    ? spriteWithDraftPosition(sprite, position, scene) : sprite) };
}
export function drawGameObjectSelection(
  ctx: CanvasRenderingContext2D, entityId: string, scene: GamePreviewScene, images: GamePreviewImages, camera: Camera,
  color = "#ffd166",
): void {
  const sprite = scene.sprites.find(item => item.objectEntityId === entityId);
  const resolved = sprite && images.get(sprite.ruid);
  if (!sprite || !resolved) return;
  const geometry = previewSpriteGeometry(sprite, resolved.asset, scene, camera);
  const [a, b, c, d, tx, ty] = geometry.matrix;
  const { width, height } = resolved.asset;
  const corners = [[0, 0], [width, 0], [width, height], [0, height]]
    .map(([x, y]) => [a * x + c * y + tx, b * x + d * y + ty]);
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
  ctx.beginPath(); ctx.moveTo(corners[0][0], corners[0][1]);
  for (const [x, y] of corners.slice(1)) ctx.lineTo(x, y);
  ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(...geometry.anchor, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Move a local selection by integer iso cells without changing saved object descriptors. */
export function sceneWithGameObjectGroupDraft(
  scene: GamePreviewScene, entityIds: string[], delta: [number, number],
): GamePreviewScene {
  if (delta.length !== 2 || !delta.every(Number.isInteger) || (!delta[0] && !delta[1]) || !entityIds.length) return scene;
  const selected = new Set(entityIds);
  let changed = false;
  const sprites = scene.sprites.map(sprite => {
    if (!sprite.objectEntityId || !selected.has(sprite.objectEntityId)) return sprite;
    changed = true;
    const position = offsetObjectPosition(sprite.position, delta[0], delta[1], scene);
    return spriteWithDraftPosition(sprite, position, scene);
  });
  return changed ? { ...scene, sprites } : scene;
}

/** Marquee selection intersects native transformed bounds, in front-to-back draw order.
 * Protected objects remain selectable for inspection; edit capabilities are enforced separately.
 * Unlike point hits, this deliberately uses the image bounds rather than per-pixel alpha.
 */
export function gameObjectsInScreenRect(
  rect: { x0: number; y0: number; x1: number; y1: number },
  scene: GamePreviewScene, images: GamePreviewImages, camera: Camera,
): string[] {
  if (![rect.x0, rect.y0, rect.x1, rect.y1].every(Number.isFinite)) return [];
  const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
  const objects = new Set((scene.objects ?? []).map(object => object.entityId));
  const selected = new Set<string>();
  for (const sprite of sortPreviewSprites(scene).reverse()) {
    const id = sprite.objectEntityId;
    const resolved = images.get(sprite.ruid);
    const alpha = sprite.color?.[3] ?? 1;
    if (!id || !objects.has(id) || selected.has(id) || !resolved || !validPreviewAsset(resolved.asset)
      || !Number.isFinite(alpha) || alpha <= 0 || resolved.image.naturalWidth <= 0 || resolved.image.naturalHeight <= 0) continue;
    const { matrix, bounds } = previewSpriteGeometry(sprite, resolved.asset, scene, camera);
    if (!matrix.every(Number.isFinite) || !bounds.every(Number.isFinite)
      || Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-12) continue;
    const [left, top, right, bottom] = bounds;
    if (left <= x1 && right >= x0 && top <= y1 && bottom >= y0) selected.add(id);
  }
  return [...selected];
}
