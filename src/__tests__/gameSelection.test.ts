import { beforeEach, describe, expect, it, vi } from "vitest";
import { cellKey, type CellKey } from "../lib/cell";
import { planGameSelectionTransform } from "../lib/gameSelection";
import type { GameObjectDescriptor, GameObjectEdits } from "../lib/gameObjects";
import type { GamePreviewScene } from "../lib/gamePreview";
import { PROJECT_TYPE, PROJECT_VERSION, type ProjectFileInput } from "../lib/projectIO";
import { toStoredTile, type PaletteTile } from "../lib/palette";
import { emptyLayer } from "../types/blueprint";
import { parseBlueprint } from "../lib/blueprintIO";
import { useEditorStore } from "../store/editorStore";

const constants = { TILE_W: 2.56, TILE_H: 1.28, ORIGIN_X: 15, ORIGIN_Y: 15, PPU: 100, DEPTH_SCALE: 0.21875, GROUND_ORDER: -1000 };
const copyId = "11111111-2222-4333-8444-555555555555";
function object(entityId: string, position: [number, number, number], locked = false): GameObjectDescriptor {
  return {
    entityId, prototypeId: entityId, spriteId: "native-" + entityId, name: entityId, ruid: "resource-" + entityId,
    position, sourcePosition: [...position], canMove: !locked, canDuplicate: !locked, canDelete: !locked,
    ...(locked ? { reason: "보호된 오브젝트" } : {}),
  };
}
const prototypes = [
  object("a", [0.13742153, -9.38127164, 2.75]),
  object("b", [-2.31571983, 3.81313742, -0.23]),
  object("protected", [7, -4, 1], true),
];
const tile: PaletteTile = { name: "ground", ruid: "ground", px: [256, 128], img: null, url: "", hash: null, category: "foothold", regStatus: "registered" };
const seeded = (): GameObjectEdits => ({
  version: 1, moved: [], removed: [],
  added: [{ entityId: copyId, prototypeId: "b", position: [-1.03571983, 3.17313742] }],
});
const state = () => useEditorStore.getState();
const saved = () => state().exportProject();
function project(edits?: GameObjectEdits): ProjectFileInput {
  return {
    type: PROJECT_TYPE, version: PROJECT_VERSION, map: "group",
    gameSync: { version: 1, baselineId: "group-baseline", mapName: "group" },
    size: [12, 12], groundOrigin: [0, 0], ground: [[0, 0, 0]],
    blocked: [[2, 2], [3, 2], [7, 7], [8, 8]], palette: [toStoredTile(tile)],
    staticLayer: emptyLayer(), attributeBase: emptyLayer(),
    entities: [{ id: "legacy-untouched", kind: "object", gx: 3, gy: 6, offset: [0.2, -0.45], scale: 0.173 }],
    ...(edits ? { gameObjectEdits: edits } : {}),
  };
}
function load(edits?: GameObjectEdits) {
  state().loadProject(project(edits), [tile]);
}
function sceneFor(edits = state().gameObjectEdits): GamePreviewScene {
  const original = structuredClone(prototypes);
  const removed = new Set(edits?.removed ?? []);
  const objects = original.filter(item => !removed.has(item.entityId)).map(item => {
    const target = edits?.moved.find(move => move.entityId === item.entityId)?.position;
    return target ? { ...item, position: [target[0], target[1], item.sourcePosition[2] + (target[1] - item.sourcePosition[1]) * constants.DEPTH_SCALE] as [number, number, number] } : { ...item, position: [...item.position] as [number, number, number] };
  });
  for (const addition of edits?.added ?? []) {
    const prototype = original.find(item => item.entityId === addition.prototypeId)!;
    objects.push({
      ...prototype, entityId: addition.entityId, spriteId: "generated-" + addition.entityId,
      position: [addition.position[0], addition.position[1], prototype.sourcePosition[2] + (addition.position[1] - prototype.sourcePosition[1]) * constants.DEPTH_SCALE],
    });
  }
  return {
    version: 1, baselineId: "group-baseline", mapName: "group", constants, groundOrigin: [0, 0],
    defaultSortingLayer: "Default", sprites: [], warnings: [], objects, objectPrototypes: original,
    report: { walkEditingSupported: true },
  };
}
function select(ids = ["a", copyId], cells: CellKey[] = [cellKey(2, 2), cellKey(3, 2)]) {
  state().selectGameObjects(ids);
  state().selectBlockedCells(cells);
}
function expectAtomicFailure(run: () => boolean, reason?: string) {
  const before = saved(), history = state().undoStack, redo = state().redoStack;
  const dirty = state().dirty, objectsVer = state().gameObjectsVer, blockedVer = state().blockedVer;
  expect(run()).toBe(false);
  expect(saved()).toEqual(before);
  expect(state().undoStack).toBe(history);
  expect(state().redoStack).toBe(redo);
  expect(state().dirty).toBe(dirty);
  expect(state().gameObjectsVer).toBe(objectsVer);
  expect(state().blockedVer).toBe(blockedVer);
  expect(state().gameSelectionError).toBeTruthy();
  if (reason) expect(state().gameSelectionError).toContain(reason);
}
beforeEach(() => {
  state().newProject();
  useEditorStore.setState({ palette: [] });
  load(seeded());
});

describe("ephemeral group selection", () => {
  it("merges/toggles IDs, accepts only present blocked cells, and keeps the last object primary", () => {
    const before = saved();
    state().selectGameObjects(["a", "a", "b"]);
    expect(state().selectedGameObjectIds).toEqual(["a", "b"]);
    expect(state().selectedGameObjectId).toBe("b");
    state().selectBlockedCells(["2,2", "2,2", "11,11"]);
    expect(state().selectedBlockedCells).toEqual(["2,2"]);
    expect(state().selectedGameObjectIds).toEqual(["a", "b"]);
    state().selectGameObjects(["a", copyId], "toggle");
    expect(state().selectedGameObjectIds).toEqual(["b", copyId]);
    expect(state().selectedGameObjectId).toBe(copyId);
    expect(state().selectedBlockedCells).toEqual(["2,2"]);
    state().selectBlockedCells(["3,2"], "add");
    state().selectBlockedCells(["2,2", "7,7"], "toggle");
    expect(state().selectedBlockedCells).toEqual(["3,2", "7,7"]);
    state().selectGameObjects(["a"]);
    expect(state().selectedBlockedCells).toEqual([]);
    expect(state().selectedGameObjectId).toBe("a");
    expect(saved()).toEqual(before);
    expect(state().dirty).toBe(false);
    expect(state().undoStack).toHaveLength(0);
  });
  it("keeps legacy single-object actions consistent with the group selection", () => {
    select();
    state().selectGameObject("a");
    expect(state().selectedGameObjectIds).toEqual(["a"]);
    expect(state().selectedBlockedCells).toEqual([]);
    state().moveGameObjectTo("a", [1.41742153, -10.02127164]);
    expect(state().selectedGameObjectIds).toEqual(["a"]);
    const added = state().addGameObject("a", [2.69742153, -10.66127164])!;
    expect(state().selectedGameObjectIds).toEqual([added]);
    expect(state().selectedGameObjectId).toBe(added);
    state().selectGameObjects(["a", added]);
    state().selectBlockedCells(["2,2"]);
    state().removeGameObject(added);
    expect(state().selectedGameObjectIds).toEqual(["a"]);
    expect(state().selectedGameObjectId).toBe("a");
    expect(state().selectedBlockedCells).toEqual(["2,2"]);
    state().setBlockedAt(2, 2, false);
    expect(state().selectedBlockedCells).toEqual([]);
    state().clearGameSelection();
    expect(state().selectedGameObjectIds).toEqual([]);
    expect(state().selectedGameObjectId).toBeNull();
  });
  it("does not serialize selection or error UI and clears them on load, import, new, undo and redo", () => {
    select();
    expect(state().transformGameSelection("move", sceneFor(), [0, 1])).toBe(true);
    const draft = saved();
    for (const key of ["selectedGameObjectIds", "selectedGameObjectId", "selectedBlockedCells", "gameSelectionError"]) expect(draft).not.toHaveProperty(key);
    const mark = () => {
      state().selectGameObjects(["a"]);
      state().selectBlockedCells([...state().blocked].slice(0, 1));
      useEditorStore.setState({ gameSelectionError: "previous error" });
    };
    const empty = () => {
      expect(state().selectedGameObjectIds).toEqual([]);
      expect(state().selectedBlockedCells).toEqual([]);
      expect(state().selectedGameObjectId).toBeNull();
      expect(state().gameSelectionError).toBeNull();
    };
    mark(); state().undo(); empty();
    mark(); state().redo(); empty();
    expect(saved()).toEqual(draft);
    mark(); state().loadProject(draft, [tile]); empty();
    expect(saved()).toEqual(draft);
    mark(); state().importBlueprint(parseBlueprint({ map: "plain", layers: { GroundTileMap: { size: [2, 2], origin: [0, 0], palette: ["ground"], cells: [] } } })); empty();
    mark(); state().newProject(); empty();
  });
});

describe("atomic object and explicit blocked-cell transforms", () => {
  it("moves original and added objects with the selected cells in one observable update", () => {
    select();
    const before = saved(), oldBlocked = state().blocked, oldObjectsVer = state().gameObjectsVer, oldBlockedVer = state().blockedVer;
    const observed: ReturnType<typeof saved>[] = [];
    const unsubscribe = useEditorStore.subscribe(() => observed.push(saved()));
    expect(state().transformGameSelection("move", sceneFor(), [0, 1])).toBe(true);
    unsubscribe();
    const result = saved();
    expect(observed).toHaveLength(1);
    expect(observed[0]).toEqual(result); // A save subscriber sees the complete group, never half the edit.
    expect(state().undoStack).toHaveLength(1);
    expect(state().gameObjectsVer).toBe(oldObjectsVer + 1);
    expect(state().blockedVer).toBe(oldBlockedVer + 1);
    expect(result.gameObjectEdits?.moved).toEqual([{ entityId: "a", position: [-1.14257847, -10.02127164] }]);
    expect(result.gameObjectEdits?.added[0]).toEqual({ entityId: copyId, prototypeId: "b", position: [-2.31571983, 2.53313742] });
    expect(result.blocked).toEqual([[7, 7], [8, 8], [2, 3], [3, 3]]);
    expect([...oldBlocked]).toEqual(["2,2", "3,2", "7,7", "8,8"]);
    expect(result.entities).toEqual(before.entities);
    expect(result.ground).toEqual(before.ground);
    expect(state().selectedGameObjectIds).toEqual(["a", copyId]);
    expect(state().selectedGameObjectId).toBe(copyId);
    expect(state().selectedBlockedCells).toEqual(["2,3", "3,3"]);
    expect(state().dirty).toBe(true);
  });
  it("duplicates both categories without altering originals and preserves new IDs across undo/redo/reload", () => {
    select();
    const before = saved(), scene = sceneFor();
    expect(state().transformGameSelection("duplicate", scene, [0, 2])).toBe(true);
    const result = saved(), copiedIds = state().selectedGameObjectIds;
    expect(copiedIds).toHaveLength(2);
    expect(new Set(copiedIds).size).toBe(2);
    expect(copiedIds).not.toContain(copyId);
    expect(state().selectedGameObjectId).toBe(copiedIds[1]);
    expect(result.gameObjectEdits?.added.slice(0, 1)).toEqual(before.gameObjectEdits?.added);
    expect(result.gameObjectEdits?.added.slice(1).map(item => item.prototypeId)).toEqual(["a", "b"]);
    expect(result.gameObjectEdits?.added.slice(1).map(item => item.entityId)).toEqual(copiedIds);
    expect(result.gameObjectEdits?.added.slice(1).map(item => item.position)).toEqual([[-2.42257847, -10.66127164], [-3.59571983, 1.89313742]]);
    expect(result.blocked).toEqual([...before.blocked, [2, 4], [3, 4]]);
    expect(state().selectedBlockedCells).toEqual(["2,4", "3,4"]);
    expect(state().undoStack).toHaveLength(1);
    state().markSaved(); state().undo();
    expect(saved()).toEqual(before);
    expect(state().dirty).toBe(true);
    expect(state().selectedGameObjectIds).toEqual([]);
    state().redo();
    expect(saved()).toEqual(result);
    expect(state().selectedBlockedCells).toEqual([]);
    state().loadProject(saved(), [tile]);
    expect(saved()).toEqual(result);
  });
  it("deletes only selected native objects and explicit blocked cells, with one exact undo", () => {
    select(["a", copyId], ["2,2"]);
    const before = saved();
    expect(state().transformGameSelection("delete", sceneFor())).toBe(true);
    expect(saved().gameObjectEdits?.removed).toEqual(["a"]);
    expect(saved().gameObjectEdits?.added).toEqual([]);
    expect(saved().blocked).toEqual([[3, 2], [7, 7], [8, 8]]);
    expect(saved().entities).toEqual(before.entities);
    expect(state().selectedGameObjectIds).toEqual([]);
    expect(state().selectedBlockedCells).toEqual([]);
    expect(state().undoStack).toHaveLength(1);
    state().undo();
    expect(saved()).toEqual(before);
  });
  it("allows simultaneous selected-cell translation through another selected source cell", () => {
    select(["a"], ["2,2", "3,2"]);
    const before = saved();
    expect(state().transformGameSelection("move", sceneFor(), [1, 0])).toBe(true);
    expect(saved().blocked).toEqual([[7, 7], [8, 8], [3, 2], [4, 2]]);
    expect(state().selectedBlockedCells).toEqual(["3,2", "4,2"]);
    state().undo(); expect(saved()).toEqual(before);
  });
  it("supports a blocked-only group without modifying object edits or their version", () => {
    select([], ["2,2", "3,2"]);
    const before = saved(), objectsVer = state().gameObjectsVer;
    expect(state().transformGameSelection("move", sceneFor(), [0, 1])).toBe(true);
    expect(saved().gameObjectEdits).toEqual(before.gameObjectEdits);
    expect(state().gameObjectsVer).toBe(objectsVer);
    expect(state().selectedGameObjectId).toBeNull();
    expect(state().selectedBlockedCells).toEqual(["2,3", "3,3"]);
    state().undo(); expect(saved()).toEqual(before);
  });
  it("does not infer or move any blocked cell when only objects are selected", () => {
    select(["a", copyId], []);
    const before = saved(), blockedVer = state().blockedVer;
    expect(state().transformGameSelection("move", sceneFor(), [1, 0])).toBe(true);
    expect(saved().blocked).toEqual(before.blocked);
    expect(state().blockedVer).toBe(blockedVer);
    expect(state().selectedBlockedCells).toEqual([]);
  });
  it("treats zero-cell move as success without dirtying data or adding history", () => {
    select();
    const before = saved(), stack = state().undoStack;
    useEditorStore.setState({ gameSelectionError: "old error" });
    expect(state().transformGameSelection("move", sceneFor(), [0, 0])).toBe(true);
    expect(saved()).toEqual(before);
    expect(state().undoStack).toBe(stack);
    expect(state().dirty).toBe(false);
    expect(state().gameSelectionError).toBeNull();
  });
});

describe("all-or-nothing group prevalidation", () => {
  it.each([
    { label: "false capability", report: { walkEditingSupported: false } },
    { label: "missing capability", report: {} },
    { label: "missing report", report: undefined },
  ])("rejects every blocked or mixed transform atomically for $label", ({ report }) => {
    const scene = { ...sceneFor(), report };
    for (const operation of ["move", "duplicate", "delete"] as const) {
      for (const ids of [[], ["a", copyId]]) {
        select(ids, ["2,2"]);
        expectAtomicFailure(() => state().transformGameSelection(operation, scene, [0, 1]), "이동불가 셀 편집을 지원하지");
      }
    }
  });
  it.each([
    { label: "false capability", report: { walkEditingSupported: false } },
    { label: "missing capability", report: {} },
    { label: "missing report", report: undefined },
  ])("keeps object-only transforms available for $label", ({ report }) => {
    for (const operation of ["move", "duplicate", "delete"] as const) {
      load(seeded());
      select(["a", copyId], []);
      const before = saved(), blockedVer = state().blockedVer;
      expect(state().transformGameSelection(operation, { ...sceneFor(), report }, [0, 1])).toBe(true);
      expect(saved().blocked).toEqual(before.blocked);
      expect(state().blockedVer).toBe(blockedVer);
      expect(saved().gameObjectEdits).not.toEqual(before.gameObjectEdits);
      expect(state().undoStack).toHaveLength(1);
    }
  });
  it("rejects move into an unselected blocked cell before changing any object", () => {
    select(["a", copyId], ["2,2"]);
    expectAtomicFailure(() => state().transformGameSelection("move", sceneFor(), [1, 0]), "겹칩니다");
  });
  it("rejects duplicate overlap with every original blocked cell, even a selected one", () => {
    select(["a", copyId], ["2,2", "3,2"]);
    expectAtomicFailure(() => state().transformGameSelection("duplicate", sceneFor(), [1, 0]), "겹칩니다");
    const createId = vi.fn(() => "new-copy");
    expect(() => planGameSelectionTransform(state(), "duplicate", sceneFor(), [1, 0], createId)).toThrow();
    expect(createId).not.toHaveBeenCalled();
  });
  it.each([[10, 0], [-3, 0], [0, 10], [0, -3]])("rejects blocked target bounds for delta %s,%s", (dx, dy) => {
    select(["a"], ["2,2"]);
    expectAtomicFailure(() => state().transformGameSelection("move", sceneFor(), [dx, dy]), "경계");
  });
  it.each(["move", "duplicate", "delete"] as const)("rejects a protected member of a %s group without partial changes", operation => {
    select(["a", "protected"], ["2,2"]);
    expectAtomicFailure(() => state().transformGameSelection(operation, sceneFor(), [0, 1]), "보호");
  });
  it.each([[0.5, 0], [0, NaN], [Infinity, 0], [Number.MAX_SAFE_INTEGER + 1, 0]])("rejects a noninteger/nonfinite/unsafe delta (%s,%s)", (dx, dy) => {
    select();
    expectAtomicFailure(() => state().transformGameSelection("move", sceneFor(), [dx, dy]), "정수");
  });
  it("rejects a foreign baseline, absent object, absent selected cell and empty selection", () => {
    select();
    expectAtomicFailure(() => state().transformGameSelection("move", { ...sceneFor(), baselineId: "other" }, [0, 1]), "원본");
    state().selectGameObjects(["absent"]);
    expectAtomicFailure(() => state().transformGameSelection("delete", sceneFor()), "미리보기");
    state().selectGameObjects(["a"]);
    useEditorStore.setState({ selectedBlockedCells: ["11,11"] });
    expectAtomicFailure(() => state().transformGameSelection("delete", sceneFor()), "셀");
    state().clearGameSelection();
    expectAtomicFailure(() => state().transformGameSelection("delete", sceneFor()), "먼저 선택");
  });
  it("rejects an old scene after a quick move, including when a different object is selected", () => {
    const staleScene = sceneFor();
    state().moveGameObjectTo("a", [1.41742153, -10.02127164]);
    state().selectGameObjects(["b"]);
    expectAtomicFailure(() => state().transformGameSelection("move", staleScene, [0, 1]), "미리보기");
    expect(state().transformGameSelection("move", sceneFor(), [0, 1])).toBe(true);
  });
  it("rejects an old scene after adding or removing a native object", () => {
    let staleScene = sceneFor();
    state().addGameObject("a", [1.41742153, -10.02127164]);
    state().selectGameObjects(["b"]);
    expectAtomicFailure(() => state().transformGameSelection("delete", staleScene), "미리보기");
    staleScene = sceneFor();
    state().removeGameObject("a");
    state().selectGameObjects(["b"]);
    expectAtomicFailure(() => state().transformGameSelection("delete", staleScene), "미리보기");
  });
  it.each(["move", "duplicate", "delete"] as const)("rejects the pre-undo scene after undoing %s", operation => {
    select(["a"], []);
    expect(state().transformGameSelection(operation, sceneFor(), [1, 0])).toBe(true);
    const staleScene = sceneFor();
    state().undo();
    state().selectGameObjects(["b"]);
    expectAtomicFailure(() => state().transformGameSelection("delete", staleScene), "미리보기");
  });
  it("accepts exact native offsets rounded to eight decimals within the backend tolerance", () => {
    load({ version: 1, moved: [{ entityId: "a", position: [0.13742153, -9.38127164] }], removed: [], added: [] });
    const current = sceneFor();
    current.objects![0].position[0] += 2e-9;
    state().selectGameObjects(["a"]);
    expect(state().transformGameSelection("move", current, [1, 0])).toBe(true);
  });
  it("does not mutate an existing draft if generated copy IDs collide", () => {
    select(["a", "b"], ["2,2"]);
    const before = saved();
    const id = vi.fn(() => "a");
    expect(() => planGameSelectionTransform(state(), "duplicate", sceneFor(), [0, 1], id)).toThrow("ID");
    expect(saved()).toEqual(before);
  });
});

it("duplicates resized server resources and ignores unplaced library prototypes", () => {
  const resource = "a".repeat(64), prototypeId = "resource_" + resource;
  const patch: GameObjectEdits = { version: 1, resources: [resource], moved: [], removed: [], added: [{ entityId: copyId, prototypeId, position: [0.123, 0.456], scale: 0.75, depthOffset: -0.4 }] };
  load(patch);
  const scene = sceneFor({ version: 1, moved: [], removed: [], added: [] });
  const prototype = { ...object(prototypeId, [0, 0, 0]), libraryOnly: true, resourceId: resource, scale: 1 };
  scene.objectPrototypes = [...prototypes, prototype];
  scene.objects = [...structuredClone(prototypes), { ...prototype, entityId: copyId, libraryOnly: false, position: [0.123, 0.456, 0.456 * 0.21875 - 0.4], scale: 0.75, depthOffset: -0.4 }];
  state().selectGameObjects([copyId]);
  expect(state().transformGameSelection("duplicate", scene, [1, 0])).toBe(true);
  expect(saved().gameObjectEdits?.added[1].scale).toBe(0.75);
  expect(saved().gameObjectEdits?.added[1].depthOffset).toBe(-0.4);
  expect(saved().gameObjectEdits?.added[1].position).toEqual([1.403, -0.184]);
  expect(saved().gameObjectEdits?.resources).toEqual([resource]);
});
