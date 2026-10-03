/** Runtime NPC placements are separate from legacy authoring entities and native objects. */
export type GameNpcCell = [number, number];
export interface GameNpcPatch { cell?: GameNpcCell; flipX?: boolean; dialogId?: string }
export interface GameNpcUpdate extends GameNpcPatch { entityId: string }
export interface GameNpcAddition {
  entityId: string; npcClassId: number; cell: GameNpcCell; flipX: boolean; dialogId: string;
}
export interface GameNpcEdits { version: 1; updated: GameNpcUpdate[]; removed: string[]; added: GameNpcAddition[] }
export interface GameNpcSync { version: 1; sourceId: string }
export interface GameNpcDescriptor {
  entityId: string; spawnId: string; npcClassId: number; name: string;
  cell: GameNpcCell; sourceCell: GameNpcCell | null; position: [number, number, number];
  ruid: string; bodyScale: number; flipX: boolean; dialogId: string; enabled: boolean;
  sourceFlipX: boolean | null; sourceDialogId: string | null;
  canEdit: boolean; reason?: string;
}
export interface GameNpcClass {
  npcClassId: number; name: string; ruid: string; bodyScale: number; canAdd: boolean; reason?: string;
}
export interface GameNpcSource { stale: boolean; changedFiles: string[]; refreshAvailable: boolean; sourceId?: string | null }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const validCell = (v: unknown): v is GameNpcCell => Array.isArray(v) && v.length === 2 && v.every(n => Number.isSafeInteger(n) && n >= 0);
const empty = (): GameNpcEdits => ({ version: 1, updated: [], removed: [], added: [] });
const compact = (v: GameNpcEdits): GameNpcEdits | undefined => v.updated.length || v.removed.length || v.added.length ? v : undefined;
export function parseGameNpcSync(value: unknown): GameNpcSync | undefined {
  if (value === undefined) return undefined;
  if (!record(value) || value.version !== 1 || typeof value.sourceId !== "string" || !uuid.test(value.sourceId)) throw new Error("NPC 원본 연결 정보가 올바르지 않습니다.");
  return { version: 1, sourceId: value.sourceId };
}
export function parseGameNpcPatch(value: unknown): GameNpcPatch {
  if (!record(value) || Object.keys(value).some(k => !["cell", "flipX", "dialogId"].includes(k))) throw new Error("NPC 변경 항목을 확인하세요.");
  const patch: GameNpcPatch = {};
  if ("cell" in value) {
    if (!validCell(value.cell)) throw new Error("NPC 위치는 0 이상의 정수 칸이어야 합니다.");
    patch.cell = [...value.cell];
  }
  if ("flipX" in value) {
    if (typeof value.flipX !== "boolean") throw new Error("NPC 좌우 반전 값을 확인하세요.");
    patch.flipX = value.flipX;
  }
  if ("dialogId" in value) {
    if (typeof value.dialogId !== "string" || (value.dialogId !== "" && !validId(value.dialogId))) throw new Error("NPC 대사 ID는 영문·숫자·밑줄·하이픈 128자 이내로 입력하세요.");
    patch.dialogId = value.dialogId;
  }
  return patch;
}
export function parseGameNpcEdits(value: unknown): GameNpcEdits | undefined {
  if (value === undefined) return undefined;
  if (!record(value) || Object.keys(value).some(k => !["version", "updated", "removed", "added"].includes(k)) || value.version !== 1 || !Array.isArray(value.updated) || !Array.isArray(value.removed) || !Array.isArray(value.added)) throw new Error("NPC 편집 정보 형식이 올바르지 않습니다.");
  const seen = new Set<string>();
  const take = (id: unknown): string => {
    if (!validId(id) || seen.has(id)) throw new Error("NPC ID가 올바르지 않거나 중복되었습니다.");
    seen.add(id); return id;
  };
  const updated = value.updated.map(item => {
    if (!record(item)) throw new Error("NPC 변경 정보를 확인하세요.");
    const { entityId, ...fields } = item, patch = parseGameNpcPatch(fields);
    if (!Object.keys(patch).length) throw new Error("NPC 변경 항목이 비어 있습니다.");
    return { entityId: take(entityId), ...patch };
  });
  const removed = value.removed.map(take);
  const added = value.added.map(item => {
    if (!record(item) || Object.keys(item).some(k => !["entityId", "npcClassId", "cell", "flipX", "dialogId"].includes(k)) || typeof item.entityId !== "string" || !uuid.test(item.entityId) ||
      !Number.isSafeInteger(item.npcClassId) || Number(item.npcClassId) <= 0 || !validCell(item.cell) ||
      typeof item.flipX !== "boolean" || typeof item.dialogId !== "string") throw new Error("추가할 NPC의 종류·위치·ID를 확인하세요.");
    const patch = parseGameNpcPatch({ cell: item.cell, flipX: item.flipX, dialogId: item.dialogId });
    return { entityId: take(item.entityId), npcClassId: Number(item.npcClassId), cell: patch.cell!, flipX: patch.flipX!, dialogId: patch.dialogId! };
  });
  return compact({ version: 1, updated, removed, added });
}
export function npcEditsKey(value: GameNpcEdits | undefined): string { return JSON.stringify(parseGameNpcEdits(value) ?? null); }
export function npcCellInBounds(cell: GameNpcCell, size: readonly number[]): boolean {
  return validCell(cell) && cell[0] < size[0] && cell[1] < size[1];
}
export function updateGameNpcEdit(current: GameNpcEdits | undefined, entityId: string, input: GameNpcPatch): GameNpcEdits | undefined {
  if (!validId(entityId)) throw new Error("NPC ID를 확인하세요.");
  const patch = parseGameNpcPatch(input), edits = current ?? empty();
  if (!Object.keys(patch).length) return current;
  if (edits.removed.includes(entityId)) throw new Error("삭제한 NPC는 수정할 수 없습니다.");
  const addition = edits.added.find(item => item.entityId === entityId);
  if (addition) return { ...edits, added: edits.added.map(item => item.entityId === entityId ? { ...item, ...patch } : item) };
  const previous = edits.updated.find(item => item.entityId === entityId);
  const next = { ...previous, entityId, ...patch };
  return { ...edits, updated: previous ? edits.updated.map(item => item.entityId === entityId ? next : item) : [...edits.updated, next] };
}
export function addGameNpcEdit(current: GameNpcEdits | undefined, item: GameNpcAddition): GameNpcEdits {
  const edits = current ?? empty();
  return parseGameNpcEdits({ ...edits, added: [...edits.added, item] })!;
}
export function removeGameNpcEdit(current: GameNpcEdits | undefined, entityId: string): GameNpcEdits | undefined {
  if (!validId(entityId)) throw new Error("NPC ID를 확인하세요.");
  const edits = current ?? empty();
  if (edits.removed.includes(entityId)) return current;
  const added = edits.added.some(item => item.entityId === entityId);
  return compact({ ...edits, updated: edits.updated.filter(item => item.entityId !== entityId),
    added: edits.added.filter(item => item.entityId !== entityId), removed: added ? edits.removed : [...edits.removed, entityId] });
}
