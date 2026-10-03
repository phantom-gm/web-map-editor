import { previewSpritePixelAt } from "./gameObjectPreview";
import { previewSpriteGeometry, previewWorldToScreen, sortPreviewSprites, type GamePreviewImages, type GamePreviewScene } from "./gamePreview";
import type { Camera } from "./grid";
import type { GameNpcCell, GameNpcDescriptor } from "./gameNpc";
export function sceneWithNpcDraft(scene: GamePreviewScene, entityId: string, cell: GameNpcCell): GamePreviewScene {
  const npc = scene.npcs?.find(item => item.entityId === entityId);
  if (!npc) return scene;
  const dx = cell[0] - npc.cell[0], dy = cell[1] - npc.cell[1];
  const offsetX = (dx - dy) * scene.constants.TILE_W / 2;
  const offsetY = -(dx + dy) * scene.constants.TILE_H / 2;
  const position: [number, number, number] = [npc.position[0] + offsetX, npc.position[1] + offsetY, npc.position[2] + offsetY * scene.constants.DEPTH_SCALE];
  return { ...scene, npcs: scene.npcs?.map(item => item.entityId === entityId ? { ...item, cell, position } : item),
    sprites: scene.sprites.map(sprite => sprite.npcEntityId === entityId ? { ...sprite, position } : sprite) };
}
let alphaContext: CanvasRenderingContext2D | null | undefined;
export function gameNpcHitCandidates(x: number, y: number, scene: GamePreviewScene, images: GamePreviewImages, camera: Camera): GameNpcDescriptor[] {
  const npcs = new Map((scene.npcs ?? []).filter(npc => npc.enabled).map(npc => [npc.entityId, npc]));
  const result: GameNpcDescriptor[] = [];
  for (const sprite of sortPreviewSprites(scene).reverse()) {
    const npc = sprite.npcEntityId && npcs.get(sprite.npcEntityId), resolved = images.get(sprite.ruid);
    if (!resolved || (sprite.color?.[3] ?? 1) <= 0) continue;
    const pixel = previewSpritePixelAt(sprite, resolved.asset, scene, camera, x, y);
    if (!pixel) continue;
    if (alphaContext === undefined) {
      const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
      alphaContext = canvas.getContext("2d", { willReadFrequently: true });
    }
    try {
      if (alphaContext) {
        alphaContext.clearRect(0, 0, 1, 1);
        alphaContext.drawImage(resolved.image, Math.floor(pixel[0] * resolved.image.naturalWidth / resolved.asset.width),
          Math.floor(pixel[1] * resolved.image.naturalHeight / resolved.asset.height), 1, 1, 0, 0, 1, 1);
        if (alphaContext.getImageData(0, 0, 1, 1).data[3] <= 16) continue;
      }
      if (npc) result.push(npc);
      else break; // An opaque foreground sprite hides NPCs behind it.
    } catch { /* Unknown alpha pixels are not a hit. The list remains selectable. */ }
  }
  return result;
}
export function drawGameNpcLabels(ctx: CanvasRenderingContext2D, scene: GamePreviewScene, camera: Camera): void {
  ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.font = `600 ${Math.max(9, Math.min(18, 12 * camera.zoom))}px sans-serif`;
  ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.fillStyle = "#fff5ca";
  for (const npc of scene.npcs ?? []) {
    if (!npc.enabled) continue;
    // Runtime's fallback head height is 2.75 world + 0.28; BodyScale already cancels out.
    const [x, y] = previewWorldToScreen([npc.position[0], npc.position[1] + 3.03], scene, camera);
    ctx.strokeText(npc.name, x, y); ctx.fillText(npc.name, x, y);
  }
  ctx.restore();
}
export function drawGameNpcSelection(ctx: CanvasRenderingContext2D, id: string, scene: GamePreviewScene, images: GamePreviewImages, camera: Camera): void {
  const npc = scene.npcs?.find(item => item.entityId === id);
  if (!npc) return;
  const sprite = scene.sprites.find(item => item.npcEntityId === id), resolved = sprite && images.get(sprite.ruid);
  ctx.save(); ctx.strokeStyle = "#ffe184"; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
  if (sprite && resolved) {
    const { matrix } = previewSpriteGeometry(sprite, resolved.asset, scene, camera);
    const [a, b, c, d, tx, ty] = matrix, { width, height } = resolved.asset;
    const points = [[0,0],[width,0],[width,height],[0,height]].map(([x,y]) => [a*x+c*y+tx,b*x+d*y+ty]);
    ctx.beginPath(); points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.closePath(); ctx.stroke();
  }
  const [x,y] = previewWorldToScreen(npc.position, scene, camera);
  ctx.setLineDash([]); ctx.fillStyle = "#ffe184"; ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill(); ctx.restore();
}
