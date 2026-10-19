export interface ObjectFlip { entityId: string; flipX: boolean }
export function parseObjectFlips(value: unknown): ObjectFlip[];
