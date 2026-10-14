export interface ObjectVisualOffset { entityId: string; offset: [number, number] }
export const MAX_VISUAL_OFFSET: number;
export function parseObjectVisualOffsets(value: unknown): ObjectVisualOffset[];
