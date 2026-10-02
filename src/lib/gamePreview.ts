import { TH, TW, type Camera, type Dims } from "./grid";

export interface GamePreviewConstants {
  TILE_W: number;
  TILE_H: number;
  ORIGIN_X: number;
  ORIGIN_Y: number;
  PPU: number;
  DEPTH_SCALE: number;
  GROUND_ORDER: number;
}
export interface GamePreviewSprite {
  id: string;
  path: string;
  name: string;
  ruid: string;
  kind: "ground" | "object" | "other";
  position: [number, number, number];
  scale: [number, number];
  quaternion: [number, number, number, number];
  rotationDeg: number;
  flipX: boolean;
  flipY: boolean;
  sortingLayer: string | null;
  orderInLayer: number;
  sourceOrder: number;
  color?: [number, number, number, number];
  ground?: { gx: number; gy: number; size: number };
}
export interface GamePreviewScene {
  version: 1;
  baselineId: string;
  mapName: string;
  constants: GamePreviewConstants;
  groundOrigin: [number, number];
  groundBrushRuids?: string[];
  defaultSortingLayer: string;
  sprites: GamePreviewSprite[];
  warnings: string[];
  report?: {
    hiddenSpriteCount?: number;
    unsupportedSpriteCount?: number;
    counts?: { groundCells: number; groundEntities: number; bySize: Record<string, number> };
    [key: string]: unknown;
  };
}
/** Resource metadata pivot is normalized from the image's bottom-left corner. */
export interface GamePreviewAsset {
  width: number;
  height: number;
  pivot: [number, number];
  pixelsPerUnit?: number;
  version?: string;
}
export interface GamePreviewImage {
  image: HTMLImageElement;
  asset: GamePreviewAsset;
}
export type GamePreviewImages = Map<string, GamePreviewImage>;

export function validPreviewAsset(value: unknown): value is GamePreviewAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<GamePreviewAsset>;
  return Number.isFinite(asset.width) && (asset.width ?? 0) > 0 &&
    Number.isFinite(asset.height) && (asset.height ?? 0) > 0 &&
    Array.isArray(asset.pivot) && asset.pivot.length === 2 &&
    asset.pivot.every(Number.isFinite) &&
    (asset.pixelsPerUnit === undefined || Number.isFinite(asset.pixelsPerUnit) && asset.pixelsPerUnit > 0);
}

/** Actual game coordinates use the scene constants, never the legacy editor iso.ts constants. */
export function previewWorldToScreen(
  world: readonly [number, number] | readonly [number, number, number],
  scene: Pick<GamePreviewScene, "constants" | "groundOrigin">,
  camera: Camera,
): [number, number] {
  const c = scene.constants;
  const dx = scene.groundOrigin[0] - c.ORIGIN_X;
  const dy = scene.groundOrigin[1] - c.ORIGIN_Y;
  const ox = (dx - dy) * c.TILE_W / 2;
  const oy = -(dx + dy) * c.TILE_H / 2;
  return [
    (world[0] - ox) * (TW / c.TILE_W) * camera.zoom + camera.x,
    (oy - world[1]) * (TH / c.TILE_H) * camera.zoom + camera.y,
  ];
}

export interface PreviewSpriteGeometry {
  anchor: [number, number];
  /** Native image pixels to screen CSS pixels: a,b,c,d,tx,ty. */
  matrix: [number, number, number, number, number, number];
  bounds: [number, number, number, number];
}

export function previewSpriteGeometry(
  sprite: GamePreviewSprite, asset: GamePreviewAsset, scene: GamePreviewScene, camera: Camera,
): PreviewSpriteGeometry {
  const anchor = previewWorldToScreen(sprite.position, scene, camera);
  const ppu = asset.pixelsPerUnit ?? scene.constants.PPU;
  const kx = TW / scene.constants.TILE_W * camera.zoom / ppu;
  const ky = TH / scene.constants.TILE_H * camera.zoom / ppu;
  const sx = sprite.scale[0] * (sprite.flipX ? -1 : 1);
  const sy = sprite.scale[1] * (sprite.flipY ? -1 : 1);
  const rad = sprite.rotationDeg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  // The source image and screen have y down; game world has y up.
  const a = kx * cos * sx, b = -ky * sin * sx;
  const c = kx * sin * sy, d = ky * cos * sy;
  const pivotX = asset.pivot[0] * asset.width;
  const pivotY = (1 - asset.pivot[1]) * asset.height;
  const tx = anchor[0] - a * pivotX - c * pivotY;
  const ty = anchor[1] - b * pivotX - d * pivotY;
  const corners = [[0, 0], [asset.width, 0], [0, asset.height], [asset.width, asset.height]]
    .map(([x, y]) => [a * x + c * y + tx, b * x + d * y + ty]);
  return {
    anchor, matrix: [a, b, c, d, tx, ty],
    bounds: [
      Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1])),
      Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1])),
    ],
  };
}

/** Fit both the logical map and every resolved static sprite, including tall objects outside the grid. */
export function fitPreviewCamera(
  dims: Dims, size: [number, number], scene: GamePreviewScene,
  images: ReadonlyMap<string, Pick<GamePreviewImage, "asset">>,
): Camera {
  const [width, height] = size;
  let x0 = -(height - 1) * TW / 2 - TW / 2;
  let x1 = (width - 1) * TW / 2 + TW / 2;
  let y0 = -TH / 2;
  let y1 = (width + height - 2) * TH / 2 + TH / 2;
  for (const sprite of scene.sprites) {
    const asset = images.get(sprite.ruid)?.asset;
    if (!asset) continue;
    const bounds = previewSpriteGeometry(sprite, asset, scene, { x: 0, y: 0, zoom: 1 }).bounds;
    x0 = Math.min(x0, bounds[0]); y0 = Math.min(y0, bounds[1]);
    x1 = Math.max(x1, bounds[2]); y1 = Math.max(y1, bounds[3]);
  }
  const zoom = Math.max(0.01, Math.min(
    Math.max(1, dims.w - 48) / (x1 - x0),
    Math.max(1, dims.h - 48) / (y1 - y0), 1.5,
  ));
  return { zoom, x: dims.w / 2 - (x0 + x1) / 2 * zoom, y: dims.h / 2 - (y0 + y1) / 2 * zoom };
}

/** The current game maps share the default SortingLayer. Unknown layers are never alphabetized. */
export function sortPreviewSprites(scene: GamePreviewScene): GamePreviewSprite[] {
  const isDefault = (sprite: GamePreviewSprite) => !sprite.sortingLayer || sprite.sortingLayer === scene.defaultSortingLayer;
  if (scene.sprites.some(sprite => !isDefault(sprite))) {
    // An explicit unknown layer has no verified rank: retain source order instead of inventing one.
    return [...scene.sprites].sort((a, b) => a.sourceOrder - b.sourceOrder);
  }
  return [...scene.sprites].sort((a, b) =>
    a.orderInLayer - b.orderInLayer || b.position[2] - a.position[2] || a.sourceOrder - b.sourceOrder);
}

const tintCache = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>();
function tintedImage(image: HTMLImageElement, color: [number, number, number, number] | undefined): CanvasImageSource {
  if (!color || color.slice(0, 3).every(value => value === 1)) return image;
  const rgb = color.slice(0, 3).map(value => Math.round(Math.max(0, Math.min(1, value)) * 255));
  const key = rgb.join(",");
  let variants = tintCache.get(image);
  if (!variants) { variants = new Map(); tintCache.set(image, variants); }
  const cached = variants.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;
  ctx.drawImage(image, 0, 0);
  // Modulate RGB directly so partially transparent edges keep their original alpha and hue.
  // The asset client supplies local data URLs, so this canvas is not cross-origin tainted.
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i] *= rgb[0] / 255;
    pixels.data[i + 1] *= rgb[1] / 255;
    pixels.data[i + 2] *= rgb[2] / 255;
  }
  ctx.putImageData(pixels, 0, 0);
  variants.set(key, canvas);
  return canvas;
}

export function drawGamePreview(
  ctx: CanvasRenderingContext2D, scene: GamePreviewScene, images: GamePreviewImages, camera: Camera, dims: Dims,
): void {
  for (const sprite of sortPreviewSprites(scene)) {
    const resolved = images.get(sprite.ruid);
    if (!resolved) continue; // Missing assets are counted explicitly by the loading state.
    const geometry = previewSpriteGeometry(sprite, resolved.asset, scene, camera);
    const [x0, y0, x1, y1] = geometry.bounds;
    if (x1 < 0 || y1 < 0 || x0 > dims.w || y0 > dims.h) continue;
    ctx.save();
    ctx.transform(...geometry.matrix);
    ctx.globalAlpha *= Math.max(0, Math.min(1, sprite.color?.[3] ?? 1));
    ctx.drawImage(tintedImage(resolved.image, sprite.color), 0, 0, resolved.asset.width, resolved.asset.height);
    ctx.restore();
  }
}
