import { beforeEach, describe, expect, it } from "vitest";
import {
  addGameObjectEdit, moveGameObjectEdit, parseGameObjectEdits, removeGameObjectEdit,
  type GameObjectEdits,
} from "../lib/gameObjects";
import { captureEditorSnapshot, useEditorStore } from "../store/editorStore";
import { PROJECT_TYPE, PROJECT_VERSION, type ProjectFileInput } from "../lib/projectIO";
import { emptyLayer } from "../types/blueprint";
import { toStoredTile, type PaletteTile } from "../lib/palette";
import { parseBlueprint } from "../lib/blueprintIO";

const edits = (): GameObjectEdits => ({
  version: 1,
  moved: [{ entityId: "native-house", position: [2.56, -1.28] }],
  removed: ["native-tree"],
  added: [{ entityId: "copy-1", prototypeId: "native-house", position: [5.12, -2.56] }],
});
const tile: PaletteTile = {
  name: "ground", ruid: "ground-ruid", px: [256, 128], category: "foothold",
  regStatus: "registered", hash: null, img: null, url: "",
};
function project(extra: Partial<ProjectFileInput> = {}): ProjectFileInput {
  return {
    type: PROJECT_TYPE, version: PROJECT_VERSION, map: "fixture",
    gameSync: { version: 1, baselineId: "object-baseline", mapName: "fixture" },
    size: [8, 8], groundOrigin: [3, 4], ground: [[0, 0, 0]], blocked: [[1, 1]],
    palette: [toStoredTile(tile)], staticLayer: emptyLayer(), attributeBase: emptyLayer(),
    entities: [{ id: "legacy-authoring", kind: "object", gx: 2, gy: 3, offset: [0.31, -0.57], scale: 0.127, depthW: 4 }],
    ...extra,
  };
}
const state = () => useEditorStore.getState();
const saved = () => state().exportProject();
beforeEach(() => {
  state().newProject();
  useEditorStore.setState({ palette: [] });
});

describe("native object edit contract", () => {
  it("keeps old linked projects compatible without changing either version", () => {
    state().loadProject(project(), [tile]);
    expect(saved().version).toBe(2);
    expect(saved().gameSync?.version).toBe(1);
    expect(saved()).not.toHaveProperty("gameObjectEdits");
    expect(parseGameObjectEdits({ version: 1, moved: [], removed: [], added: [] })).toBeUndefined();
  });
  it("rejects malformed, conflicting, nonfinite and chained-copy edits", () => {
    for (const invalid of [
      null, {}, { ...edits(), version: 2 }, { ...edits(), removed: null },
      { ...edits(), moved: [{ entityId: "../bad", position: [0, 0] }] },
      { ...edits(), moved: [{ entityId: "x", position: [NaN, 0] }] },
      { ...edits(), moved: [{ entityId: "x", position: [0, 0, 0] }] },
      { ...edits(), removed: ["native-house"] },
      { ...edits(), added: [{ entityId: "native-house", prototypeId: "x", position: [0, 0] }] },
      { ...edits(), added: [{ entityId: "x", prototypeId: "x", position: [0, 0] }] },
      { ...edits(), added: [
        { entityId: "x", prototypeId: "native-house", position: [0, 0] },
        { entityId: "y", prototypeId: "x", position: [0, 0] },
      ] },
    ]) expect(() => parseGameObjectEdits(invalid)).toThrow();
  });
  it("copies input positions so external mutations cannot change the loaded draft", () => {
    const input = edits();
    const parsed = parseGameObjectEdits(input)!;
    input.moved[0].position[0] = 999;
    input.added[0].position[1] = 999;
    expect(parsed.moved[0].position).toEqual([2.56, -1.28]);
    expect(parsed.added[0].position).toEqual([5.12, -2.56]);
  });
  it("moves copies in the added row and deletes them without tombstones", () => {
    const first = addGameObjectEdit(undefined, "copy", "native-house", [0, 0]);
    const moved = moveGameObjectEdit(first, "copy", [1.28, -0.64]);
    expect(first.added[0].position).toEqual([0, 0]);
    expect(moved.moved).toEqual([]);
    expect(moved.added[0].position).toEqual([1.28, -0.64]);
    expect(removeGameObjectEdit(moved, "copy")).toBeUndefined();
  });
  it("removing an original clears its move and does not duplicate removal entries", () => {
    const moved = moveGameObjectEdit(undefined, "original", [1, 2]);
    const removed = removeGameObjectEdit(moved, "original")!;
    expect(removed.moved).toEqual([]);
    expect(removed.removed).toEqual(["original"]);
    expect(removeGameObjectEdit(removed, "original")).toBe(removed);
    expect(() => moveGameObjectEdit(removed, "original", [2, 3])).toThrow();
  });
});

describe("native object project history", () => {
  it("round-trips object edits and preserves all original authoring entities", () => {
    const input = project({ gameObjectEdits: edits() });
    state().loadProject(input, [tile]);
    const first = saved();
    expect(first.gameObjectEdits).toEqual(input.gameObjectEdits);
    expect(first.entities).toEqual(input.entities);
    state().loadProject(first, [tile]);
    expect(saved()).toEqual(first);
  });
  it("rejects invalid overlays and overlays without a game link before mutating state", () => {
    state().loadProject(project({ gameObjectEdits: edits() }), [tile]);
    const before = saved();
    expect(() => state().loadProject(project({ gameSync: undefined, gameObjectEdits: edits() }), [tile])).toThrow();
    expect(() => state().loadProject(project({ gameObjectEdits: { ...edits(), version: 2 } as unknown as GameObjectEdits }), [tile])).toThrow();
    expect(saved()).toEqual(before);
  });
  it("keeps stable copy IDs through save, undo, redo and reload", () => {
    state().loadProject(project(), [tile]);
    const before = saved();
    const entityId = state().addGameObject("native-house", [1.28, -0.64])!;
    expect(entityId).toBeTruthy();
    expect(state().selectedGameObjectId).toBe(entityId);
    expect(state().dirty).toBe(true);
    const added = saved();
    state().markSaved();
    state().undo();
    expect(saved()).toEqual(before);
    expect(state().dirty).toBe(true);
    state().redo();
    expect(saved()).toEqual(added);
    expect(saved().gameObjectEdits?.added[0].entityId).toBe(entityId);
    state().loadProject(saved(), [tile]);
    expect(saved()).toEqual(added);
  });
  it("interleaves native edits, ground edits and removals in one chronological undo stack", () => {
    state().loadProject(project(), [tile]);
    const versions = [saved()];
    state().moveGameObjectTo("native-house", [1.28, -0.64]); versions.push(saved());
    state().fillRect(3, 3, 3, 3); versions.push(saved());
    state().removeGameObject("native-tree"); versions.push(saved());
    for (let i = versions.length - 2; i >= 0; i--) {
      state().undo(); expect(saved()).toEqual(versions[i]);
    }
    for (let i = 1; i < versions.length; i++) {
      state().redo(); expect(saved()).toEqual(versions[i]);
    }
  });
  it("a ground stroke snapshot preserves existing native edits", () => {
    state().loadProject(project({ gameObjectEdits: edits() }), [tile]);
    const before = saved();
    const stroke = captureEditorSnapshot(state());
    state().setTool("brush");
    state().applyTool(4, 4);
    state().commitStroke(stroke);
    state().undo();
    expect(saved()).toEqual(before);
  });
  it("can commit a drag once and does not create history for an unchanged patch", () => {
    state().loadProject(project(), [tile]);
    const before = saved();
    const drag = captureEditorSnapshot(state());
    state().moveGameObjectTo("native-house", [1.28, -0.64], false);
    state().moveGameObjectTo("native-house", [2.56, -1.28], false);
    expect(state().undoStack).toHaveLength(0);
    state().commitStroke(drag);
    expect(state().undoStack).toHaveLength(1);
    state().moveGameObjectTo("native-house", [2.56, -1.28]);
    expect(state().undoStack).toHaveLength(1);
    state().undo();
    expect(saved()).toEqual(before);
  });
  it("selection is separate from authoring entities and never dirties the project", () => {
    state().loadProject(project(), [tile]);
    state().selectEntity("legacy-authoring");
    state().selectGameObject("native-house");
    expect(state().selectedEntityId).toBeNull();
    expect(state().selectedGameObjectId).toBe("native-house");
    expect(state().dirty).toBe(false);
    state().selectEntity("legacy-authoring");
    expect(state().selectedGameObjectId).toBeNull();
  });
  it("clears native edits and selection on ordinary load, blueprint import and new project", () => {
    const linked = project({ gameObjectEdits: edits() });
    const assertCleared = () => {
      expect(saved()).not.toHaveProperty("gameObjectEdits");
      expect(state().selectedGameObjectId).toBeNull();
    };
    state().loadProject(linked, [tile]);
    state().selectGameObject("native-house");
    state().loadProject(project({ gameSync: undefined }), [tile]); assertCleared();
    state().loadProject(linked, [tile]);
    state().importBlueprint(parseBlueprint({ map: "plain", layers: {
      GroundTileMap: { size: [2, 2], origin: [0, 0], palette: ["ground"], cells: [[0, 0, 0]] },
    } })); assertCleared();
    state().loadProject(linked, [tile]);
    state().newProject(); assertCleared();
    expect(state().addGameObject("native-house", [0, 0])).toBeNull();
  });
  it("manual collision edits own dirty state and share undo without altering objects", () => {
    state().loadProject(project({ gameObjectEdits: edits() }), [tile]);
    const before = saved();
    const stroke = captureEditorSnapshot(state());
    state().setTool("block");
    state().applyTool(3, 3);
    state().commitStroke(stroke);
    expect(state().dirty).toBe(true);
    expect(saved().blocked).toContainEqual([3, 3]);
    state().markSaved();
    state().undo();
    expect(state().dirty).toBe(true);
    expect(saved()).toEqual(before);
    const erase = captureEditorSnapshot(state());
    state().setBlockedAt(1, 1, false);
    state().commitStroke(erase);
    expect(saved().blocked).toEqual([]);
    state().undo();
    expect(saved()).toEqual(before);
  });
  it("clearing linked ground preserves native objects and manual collision edits", () => {
    state().loadProject(project({ gameObjectEdits: edits() }), [tile]);
    const before = saved();
    state().clearAll();
    expect(saved()).toEqual({ ...before, ground: [] });
    state().undo();
    expect(saved()).toEqual(before);
  });
});
