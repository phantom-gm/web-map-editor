import { parseObjectSorting, type ObjectSortSetting, type ObjectSortEdit } from "./objectSorting.cjs";
/** Sparse edits to native game objects; legacy project entities stay unchanged. */
export type GameObjectPosition = [number, number];
export interface GameObjectMove { entityId: string; position: GameObjectPosition }
export interface GameObjectAddition extends GameObjectMove { prototypeId: string; scale?: number; depthOffset?: number }
export interface GameObjectEdits {
  version: 1;
  resources?: string[];
  sorting?: ObjectSortEdit[];
  moved: GameObjectMove[];
  removed: string[];
  added: GameObjectAddition[];
}
export interface GameObjectDescriptor {
  entityId: string;
  prototypeId: string;
  spriteId: string;
  name: string;
  ruid: string;
  position: [number, number, number];
  sourcePosition: [number, number, number];
  canMove: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  libraryOnly?: boolean;
  resourceId?: string;
  scale?: number;
  depthOffset?: number;
  reason?: string;
  collisionNote?: string;
  sortSetting?: ObjectSortSetting;
  sortInfo?: { order: number; footprint: [number, number, number, number] | null; bounds: [number, number]; padX: number };
}

const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
function validId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}
function validPosition(value: unknown): value is GameObjectPosition {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const empty = (): GameObjectEdits => ({ version: 1, moved: [], removed: [], added: [] });
function compact(value: GameObjectEdits): GameObjectEdits | undefined {
  return value.moved.length || value.removed.length || value.added.length || value.resources?.length || value.sorting?.length ? value : undefined;
}

/** Validate before changing editor state. Absence and an empty v1 overlay both mean no native edits. */
export function parseGameObjectEdits(value: unknown): GameObjectEdits | undefined {
  if (value === undefined) return undefined;
  if (!record(value) || value.version !== 1 ||
    !Array.isArray(value.moved) || !Array.isArray(value.removed) || !Array.isArray(value.added)) {
    throw new Error("게임 오브젝트 편집 정보 형식이 올바르지 않습니다.");
  }
  const resources = value.resources;
  if (resources !== undefined && (!Array.isArray(resources) || resources.length > 500 || new Set(resources).size !== resources.length || resources.some(id => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)))) throw new Error("서버 소재 목록을 확인하세요.");
  const sorting = parseObjectSorting(value.sorting);
  const seen = new Set<string>();
  const take = (id: unknown): string => {
    if (!validId(id) || seen.has(id)) throw new Error("게임 오브젝트 ID가 올바르지 않거나 중복되었습니다.");
    seen.add(id); return id;
  };
  const moved: GameObjectMove[] = value.moved.map(item => {
    if (!record(item) || !validPosition(item.position)) throw new Error("게임 오브젝트 위치를 확인하세요.");
    return { entityId: take(item.entityId), position: [...item.position] };
  });
  const removed = value.removed.map(take);
  const added: GameObjectAddition[] = value.added.map(item => {
    if (!record(item) || !validPosition(item.position) || !validId(item.prototypeId)) {
      throw new Error("추가할 게임 오브젝트의 원본과 위치를 확인하세요.");
    }
    const entityId = take(item.entityId);
    if (entityId === item.prototypeId) throw new Error("복제 오브젝트와 원본 ID는 달라야 합니다.");
    if (item.scale !== undefined && (!item.prototypeId.startsWith("resource_") || typeof item.scale !== "number" || !Number.isFinite(item.scale) || item.scale < 0.01 || item.scale > 100)) throw new Error("소재 크기를 확인하세요.");
    if (item.depthOffset !== undefined && (!item.prototypeId.startsWith("resource_") || typeof item.depthOffset !== "number" || !Number.isFinite(item.depthOffset) || Math.abs(item.depthOffset) > 100)) throw new Error("소재 앞뒤 보정값을 확인하세요.");
    return { entityId, prototypeId: item.prototypeId, position: [...item.position], ...(item.scale !== undefined ? { scale: item.scale as number } : {}), ...(item.depthOffset !== undefined ? { depthOffset: item.depthOffset as number } : {}) };
  });
  if (added.some(item => added.some(other => other.entityId === item.prototypeId))) {
    throw new Error("복제 원본은 게임 기준 배치의 오브젝트여야 합니다.");
  }
  if (sorting.some(row => removed.includes(row.entityId) || row.setting.mode === "surface" && removed.includes(row.setting.supportId))) throw new Error("정렬 대상이나 받치는 가구가 삭제되어 있습니다.");
  return compact({ version: 1, moved, removed, added, ...(sorting.length ? { sorting } : {}), ...(resources !== undefined ? { resources: [...resources] as string[] } : {}) });
}

function checkTarget(entityId: string, position?: GameObjectPosition): void {
  if (!validId(entityId) || position !== undefined && !validPosition(position)) {
    throw new Error("게임 오브젝트 ID 또는 위치가 올바르지 않습니다.");
  }
}
function samePosition(a: GameObjectPosition, b: GameObjectPosition): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
export function moveGameObjectEdit(
  current: GameObjectEdits | undefined, entityId: string, position: GameObjectPosition,
): GameObjectEdits {
  checkTarget(entityId, position);
  const edits = current ?? empty();
  if (edits.removed.includes(entityId)) throw new Error("삭제한 게임 오브젝트는 이동할 수 없습니다.");
  const addition = edits.added.find(item => item.entityId === entityId);
  if (addition) {
    if (samePosition(addition.position, position)) return edits;
    return { ...edits, added: edits.added.map(item => item.entityId === entityId ? { ...item, position: [...position] } : item) };
  }
  const previous = edits.moved.find(item => item.entityId === entityId);
  if (previous && samePosition(previous.position, position)) return edits;
  const changed = { entityId, position: [...position] as GameObjectPosition };
  return { ...edits, moved: previous ? edits.moved.map(item => item.entityId === entityId ? changed : item) : [...edits.moved, changed] };
}
export function addGameObjectEdit(
  current: GameObjectEdits | undefined, entityId: string, prototypeId: string, position: GameObjectPosition, scale?: number, depthOffset?: number,
): GameObjectEdits {
  checkTarget(entityId, position); checkTarget(prototypeId);
  const edits = current ?? empty();
  if (entityId === prototypeId || edits.added.some(item => item.entityId === prototypeId)) {
    throw new Error("복제 원본은 게임 기준 배치의 오브젝트여야 합니다.");
  }
  if (edits.moved.some(item => item.entityId === entityId) || edits.removed.includes(entityId) ||
    edits.added.some(item => item.entityId === entityId)) throw new Error("이미 사용 중인 게임 오브젝트 ID입니다.");
  return parseGameObjectEdits({ ...edits, added: [...edits.added, { entityId, prototypeId, position: [...position], ...(scale !== undefined ? { scale } : {}), ...(depthOffset !== undefined ? { depthOffset } : {}) }] })!;
}
export function removeGameObjectEdit(current: GameObjectEdits | undefined, entityId: string): GameObjectEdits | undefined {
  checkTarget(entityId);
  const edits = current ?? empty();
  if (edits.removed.includes(entityId)) return current;
  const addition = edits.added.some(item => item.entityId === entityId);
  return compact({
    ...edits, ...(edits.sorting ? { sorting: edits.sorting.filter(row => row.entityId !== entityId) } : {}), moved: edits.moved.filter(item => item.entityId !== entityId),
    added: edits.added.filter(item => item.entityId !== entityId),
    removed: addition ? edits.removed : [...edits.removed, entityId],
  });
}

export function setGameObjectSorting(current: GameObjectEdits | undefined, entityId: string, setting?: ObjectSortSetting): GameObjectEdits | undefined {
  checkTarget(entityId);
  const edits = current ?? empty();
  const sorting = (edits.sorting ?? []).filter(row => row.entityId !== entityId);
  if (setting) sorting.push({ entityId, setting });
  return parseGameObjectEdits({ ...edits, sorting });
}

export function addGameResourceReferences(current: GameObjectEdits | undefined, ids: string[]): GameObjectEdits {
  const edits = current ?? empty();
  return parseGameObjectEdits({ ...edits, resources: [...new Set([...(edits.resources ?? []), ...ids])] })!;
}
export function scaleGameResourceEdit(current: GameObjectEdits | undefined, entityId: string, scale: number): GameObjectEdits {
  const target = current?.added.find(item => item.entityId === entityId);
  if (!target?.prototypeId.startsWith("resource_")) throw new Error("새 서버 소재 배치만 크기를 바꿀 수 있습니다.");
  return parseGameObjectEdits({ ...current, added: current!.added.map(item => item.entityId === entityId ? { ...item, scale } : item) })!;
}

export function depthGameResourceEdit(current: GameObjectEdits | undefined, entityId: string, depthOffset: number): GameObjectEdits {
  const target = current?.added.find(item => item.entityId === entityId);
  if (!target?.prototypeId.startsWith("resource_")) throw new Error("새 서버 소재만 앞뒤를 보정할 수 있습니다.");
  return parseGameObjectEdits({ ...current, added: current!.added.map(item => item.entityId === entityId ? { ...item, depthOffset } : item) })!;
}
