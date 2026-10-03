import type { PaletteTile } from "./palette";

interface VerifiedImage {
  ruid: string;
  url: string;
  source: string;
}

// Trust is scoped to this decoded image, its exact server RUID, and its source.
// Saved project metadata or a copied RUID alone cannot mark a local image trusted.
const verifiedImages = new WeakMap<HTMLImageElement, VerifiedImage>();
const validRuid = (ruid: string | undefined): ruid is string =>
  typeof ruid === "string" && /^[a-f0-9]{32}$/i.test(ruid);
const loadedImage = (image: HTMLImageElement | null): image is HTMLImageElement =>
  !!image && Number.isFinite(image.naturalWidth) && image.naturalWidth > 0 &&
  Number.isFinite(image.naturalHeight) && image.naturalHeight > 0;
const imageSource = (image: HTMLImageElement) => image.currentSrc || image.src;

/** Call only after an MSW server image lookup and a successful image decode. */
export function markServerResourceImage(tile: PaletteTile): void {
  if (!validRuid(tile.ruid) || !loadedImage(tile.img) || !tile.url) return;
  verifiedImages.set(tile.img, {
    ruid: tile.ruid.toLowerCase(),
    url: tile.url,
    source: imageSource(tile.img),
  });
}

export function isServerResourceImage(tile: PaletteTile | undefined): boolean {
  if (!tile || !validRuid(tile.ruid) || !loadedImage(tile.img) || !tile.url) return false;
  const verified = verifiedImages.get(tile.img);
  return !!verified && verified.ruid === tile.ruid.toLowerCase() &&
    verified.url === tile.url && verified.source === imageSource(tile.img);
}
