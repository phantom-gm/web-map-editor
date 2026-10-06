export type ObjectSortSetting =
  | { mode: "wall" }
  | { mode: "surface"; supportId: string }
  | { mode: "floor"; offset: [number, number]; size: [number, number]; bounds: [number, number]; padX: number };
export interface ObjectSortEdit { entityId: string; setting: ObjectSortSetting }
export function parseObjectSorting(value: unknown): ObjectSortEdit[];
export function objectAnchor(position: readonly number[], constants: { ORIGIN_X: number; ORIGIN_Y: number; TILE_W: number; TILE_H: number }): [number, number];
export const SURFACE_EPSILON: number;
