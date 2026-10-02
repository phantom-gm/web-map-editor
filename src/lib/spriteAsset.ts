/** Native sprite pixels and normalized pivot (origin at the bottom-left). */
export interface SpriteMetadata {
  width: number;
  height: number;
  pivot: [number, number];
  pixelsPerUnit: number;
  version: string;
  pivotSource: "storage" | "mod";
}

export interface SpriteAssetsResponse {
  images: Record<string, string | null>;
  sprites: Record<string, SpriteMetadata>;
  errors: Record<string, string>;
}
