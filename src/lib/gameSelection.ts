import { SURFACE_EPSILON } from "./objectSorting.cjs";
import { cellKey, parseCellKey, type CellKey } from "./cell";
import {
  addGameObjectEdit, moveGameObjectEdit, removeGameObjectEdit, setGameObjectSorting,
  type GameObjectDescriptor, type GameObjectEdits, type GameObjectPosition,
} from "./gameObjects";
import type { GamePreviewScene } from "./gamePreview";

export type GameSelectionMode = "replace" | "add" | "toggle";
export type GameSelectionOperation = "move" | "duplicate" | "delete";

export function mergeGameSelection<T extends string>(current: readonly T[], incoming: readonly T[], mode: GameSelectionMode): T[] {
  const next = new Set(mode === "replace" ? [] : current);
  for (const value of new Set(incoming)) {
    if (mode === "toggle" && next.has(value)) next.delete(value);
    else next.add(value);
  }
  return [...next];
}
export interface GameSelectionInput {
  gameSync: { baselineId: string; mapName: string } | undefined;
  size: [number, number];
  blocked: Set<CellKey>;
  gameObjectEdits: GameObjectEdits | undefined;
  selectedGameObjectIds: string[];
  selectedBlockedCells: CellKey[];
}
export interface GameSelectionPlan {
  gameObjectEdits: GameObjectEdits | undefined;
  blocked: Set<CellKey>;
  selectedGameObjectIds: string[];
  selectedBlockedCells: CellKey[];
  objectsChanged: boolean;
  blockedChanged: boolean;
  changed: boolean;
}
const stale = () => new Error("현재 편집과 미리보기 배치가 다릅니다. 미리보기 갱신 후 다시 선택해 주세요.");
const near = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, i) => Number.isFinite(value) && Number.isFinite(b[i]) && Math.abs(value - b[i]) <= 1e-7);
const validVector = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
function descriptorMap(items: GameObjectDescriptor[]): Map<string, GameObjectDescriptor> {
  const result = new Map<string, GameObjectDescriptor>();
  for (const item of items) {
    if (!item.entityId || result.has(item.entityId) || !validVector(item.position) || !validVector(item.sourcePosition)) throw stale();
    result.set(item.entityId, item);
  }
  return result;
}

/** Check the entire native overlay, including an undo of a deletion/copy absent from the old scene. */
export function currentGameObjects(input: GameSelectionInput, scene: GamePreviewScene): Map<string, GameObjectDescriptor> {
  if (!input.gameSync || input.gameSync.baselineId !== scene.baselineId || input.gameSync.mapName !== scene.mapName) {
    throw new Error("현재 게임 맵과 선택한 배치의 원본 연결이 다릅니다.");
  }
  const { TILE_W, TILE_H, DEPTH_SCALE } = scene.constants;
  if (![TILE_W, TILE_H, DEPTH_SCALE].every(Number.isFinite) || TILE_W <= 0 || TILE_H <= 0) throw stale();
  const objects = descriptorMap(scene.objects ?? []);
  const prototypes = descriptorMap(scene.objectPrototypes ?? []);
  const added = new Map((input.gameObjectEdits?.added ?? []).map(item => [item.entityId, item]));
  const moved = new Map((input.gameObjectEdits?.moved ?? []).map(item => [item.entityId, item]));
  const removed = new Set(input.gameObjectEdits?.removed ?? []);
  const expectedIds = new Set([...prototypes.keys()].filter(id => !prototypes.get(id)?.libraryOnly && !removed.has(id)));
  for (const id of added.keys()) {
    if (expectedIds.has(id)) throw stale();
    expectedIds.add(id);
  }
  if (objects.size !== expectedIds.size || [...expectedIds].some(id => !objects.has(id))) throw stale();
  for (const id of moved.keys()) if (!prototypes.has(id) || removed.has(id) || added.has(id)) throw stale();
  for (const id of removed) if (!prototypes.has(id)) throw stale();
  for (const [id, object] of objects) {
    const addition = added.get(id);
    const prototypeId = addition?.prototypeId ?? id;
    const prototype = prototypes.get(prototypeId);
    if (!prototype || object.prototypeId !== prototypeId || !near(object.sourcePosition, prototype.sourcePosition)) throw stale();
    const target = addition?.position ?? moved.get(id)?.position ?? prototype.sourcePosition.slice(0, 2);
    const expected = [target[0], target[1], prototype.sourcePosition[2] + (target[1] - prototype.sourcePosition[1]) * DEPTH_SCALE + (addition?.depthOffset ?? 0)];
    const setting = input.gameObjectEdits?.sorting?.find(row => row.entityId === id)?.setting;
    if (JSON.stringify(setting) !== JSON.stringify(object.sortSetting)) throw stale();
    if (setting?.mode === "surface") {
      const support = objects.get(setting.supportId);
      if (!support || support.sortSetting?.mode === "surface") throw stale();
      expected[2] = support.position[2] - SURFACE_EPSILON;
    }
    if (!near(object.position, expected)) throw stale();
    if (prototype.resourceId && object.scale !== (addition?.scale ?? 1)) throw stale();
    if (object.canMove !== prototype.canMove || object.canDelete !== prototype.canDelete || object.canDuplicate !== prototype.canDuplicate) throw stale();
  }
  return objects;
}

function translated(position: readonly number[], delta: [number, number], scene: GamePreviewScene): GameObjectPosition {
  const next: GameObjectPosition = [
    Number((position[0] + (delta[0] - delta[1]) * scene.constants.TILE_W / 2).toFixed(8)),
    Number((position[1] - (delta[0] + delta[1]) * scene.constants.TILE_H / 2).toFixed(8)),
  ];
  if (next.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6)) throw new Error("이동할 오브젝트 위치가 지원 범위를 벗어납니다.");
  return next;
}
function selectedCells(input: GameSelectionInput): CellKey[] {
  const cells = [...new Set(input.selectedBlockedCells)];
  for (const key of cells) {
    const [gx, gy] = parseCellKey(key);
    if (!Number.isSafeInteger(gx) || !Number.isSafeInteger(gy) || cellKey(gx, gy) !== key ||
      gx < 0 || gy < 0 || gx >= input.size[0] || gy >= input.size[1] || !input.blocked.has(key)) {
      throw new Error("선택한 이동불가 셀이 현재 맵에 없습니다. 다시 선택해 주세요.");
    }
  }
  return cells;
}

/** Pure preflight and immutable result. No editor state is changed until the whole plan succeeds. */
export function planGameSelectionTransform(
  input: GameSelectionInput, operation: GameSelectionOperation, scene: GamePreviewScene,
  delta: [number, number], createId: () => string,
): GameSelectionPlan {
  if (!["move", "duplicate", "delete"].includes(operation)) throw new Error("지원하지 않는 선택 편집입니다.");
  if (!Array.isArray(delta) || delta.length !== 2 || !delta.every(Number.isSafeInteger)) throw new Error("이동량은 정수 셀 단위여야 합니다.");
  const current = currentGameObjects(input, scene);
  const ids = [...new Set(input.selectedGameObjectIds)];
  const cells = selectedCells(input);
  if (cells.length && scene.report?.walkEditingSupported !== true) {
    throw new Error("이 맵은 이동불가 셀 편집을 지원하지 않습니다. 오브젝트만 선택해 편집하세요.");
  }
  if (!ids.length && !cells.length) throw new Error("편집할 오브젝트 또는 이동불가 셀을 먼저 선택하세요.");
  const capability = operation === "move" ? "canMove" : operation === "duplicate" ? "canDuplicate" : "canDelete";
  const objects = ids.map(id => {
    const object = current.get(id);
    if (!object) throw stale();
    if (object[capability] !== true) throw new Error(object.name + ": " + (object.reason || "선택한 작업을 지원하지 않는 오브젝트입니다."));
    return object;
  });
  if (operation === "move" && delta[0] === 0 && delta[1] === 0) {
    return {
      gameObjectEdits: input.gameObjectEdits, blocked: input.blocked,
      selectedGameObjectIds: ids, selectedBlockedCells: cells,
      objectsChanged: false, blockedChanged: false, changed: false,
    };
  }
  const positions = operation === "delete" ? [] : objects.map(object => translated(object.position, delta, scene));
  const selected = new Set(cells);
  const targets = operation === "delete" ? [] : cells.map(key => {
    const [gx, gy] = parseCellKey(key);
    const x = gx + delta[0], y = gy + delta[1], target = cellKey(x, y);
    if (x < 0 || y < 0 || x >= input.size[0] || y >= input.size[1]) throw new Error("선택한 이동불가 셀이 맵 경계를 벗어납니다.");
    if (input.blocked.has(target) && (operation === "duplicate" || !selected.has(target))) {
      throw new Error(operation === "duplicate" ? "복제할 이동불가 셀이 기존 셀과 겹칩니다." : "이동할 이동불가 셀이 선택하지 않은 기존 셀과 겹칩니다.");
    }
    return target;
  });

  // Allocate all copy IDs only after capability, scene and target-cell checks succeed.
  const copyIds: string[] = [];
  if (operation === "duplicate") {
    const occupied = new Set([...(scene.objectPrototypes ?? []).map(item => item.entityId), ...current.keys()]);
    for (const object of objects) {
      const prototype = scene.objectPrototypes?.find(item => item.entityId === object.prototypeId);
      if (!prototype?.canDuplicate) throw new Error("복제할 원본 오브젝트를 확인할 수 없습니다.");
      const id = createId();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || occupied.has(id)) throw new Error("복제 오브젝트 ID가 중복되었거나 올바르지 않습니다.");
      occupied.add(id); copyIds.push(id);
    }
  }
  if (operation === "delete" && input.gameObjectEdits?.sorting?.some(row => row.setting.mode === "surface" && ids.includes(row.setting.supportId) && !ids.includes(row.entityId))) {
    throw new Error("가구 위 소품이 연결되어 있습니다. 소품도 함께 선택하거나 먼저 정렬 연결을 해제하세요.");
  }
  let gameObjectEdits = input.gameObjectEdits;
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i];
    gameObjectEdits = operation === "move"
      ? moveGameObjectEdit(gameObjectEdits, object.entityId, positions[i])
      : operation === "duplicate"
        ? addGameObjectEdit(gameObjectEdits, copyIds[i], object.prototypeId, positions[i], object.resourceId ? object.scale : undefined, object.resourceId ? object.depthOffset : undefined)
        : removeGameObjectEdit(gameObjectEdits, object.entityId);
  }
  if (operation === "duplicate") for (let i = 0; i < objects.length; i++) {
    const setting = objects[i].sortSetting;
    if (setting) {
      const index = setting.mode === "surface" ? ids.indexOf(setting.supportId) : -1;
      const copied = setting.mode === "surface" && index >= 0 ? { ...setting, supportId: copyIds[index] } : setting;
      gameObjectEdits = setGameObjectSorting(gameObjectEdits, copyIds[i], copied);
    }
  }
  const blocked = cells.length ? new Set(input.blocked) : input.blocked;
  if (operation !== "duplicate") for (const key of cells) blocked.delete(key);
  for (const key of targets) blocked.add(key);
  return {
    gameObjectEdits, blocked, objectsChanged: objects.length > 0, blockedChanged: cells.length > 0, changed: true,
    selectedGameObjectIds: operation === "delete" ? [] : operation === "duplicate" ? copyIds : ids,
    selectedBlockedCells: targets,
  };
}
