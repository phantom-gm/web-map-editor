import { beforeEach, expect, it } from "vitest";
import { useEditorStore } from "../store/editorStore";
import { makeMovementFeedback, movementLabel, sceneWithMovementFeedback, visibleMovementFeedback } from "../lib/gameMoveFeedback";
import type { GamePreviewScene, GamePreviewSprite } from "../lib/gamePreview";
import { PROJECT_TYPE, PROJECT_VERSION } from "../lib/projectIO";
import { emptyLayer } from "../types/blueprint";

const state = () => useEditorStore.getState();
const constants = { TILE_W: 2.56, TILE_H: 1.28, ORIGIN_X: 15, ORIGIN_Y: 15, PPU: 100, DEPTH_SCALE: 0.21875, GROUND_ORDER: -1000 };
function scene(): GamePreviewScene {
  const objects = ["rock", "tree"].map((entityId, i) => {
    const sourcePosition: [number, number, number] = [i * 3, i ? -i * 2 : 0, i];
    const edit = state().gameObjectEdits?.moved.find(o => o.entityId === entityId);
    const position: [number, number, number] = edit ? [...edit.position, sourcePosition[2] + (edit.position[1] - sourcePosition[1]) * constants.DEPTH_SCALE] : [...sourcePosition];
    const visualOffset = state().gameObjectEdits?.visualOffsets?.find(o => o.entityId === entityId)?.offset;
    if (visualOffset) position[2] += visualOffset[1] * constants.DEPTH_SCALE; // z follows the drawn Y
    return { entityId, prototypeId: entityId, spriteId: entityId, name: entityId, ruid: entityId, sourcePosition, position,
      canMove: true, canDuplicate: true, canDelete: true, ...(visualOffset ? { visualOffset } : {}) };
  });
  const sprites: GamePreviewSprite[] = objects.map(o => ({
    id: o.entityId, objectEntityId: o.entityId, path: o.entityId, name: o.name, ruid: o.ruid,
    kind: "object", position: [...o.position], visualOffset: o.visualOffset, scale: [1, 1], quaternion: [0, 0, 0, 1],
    rotationDeg: 0, flipX: false, flipY: false, sortingLayer: null, orderInLayer: 0, sourceOrder: 0,
  }));
  return { version: 1, baselineId: "movement-test", mapName: "test", constants, groundOrigin: [0, 0],
    defaultSortingLayer: "Default", sprites, objects, objectPrototypes: objects.map(o => ({ ...o, position: o.sourcePosition })),
    warnings: [], report: { walkEditingSupported: true } };
}
beforeEach(() => {
  state().newProject();
  state().loadProject({ type: PROJECT_TYPE, version: PROJECT_VERSION, map: "test", size: [12, 12],
    gameSync: { version: 1, baselineId: "movement-test", mapName: "test" },
    ground: [], blocked: [[2, 2], [3, 2]], palette: [], groundOrigin: [0, 0],
    staticLayer: emptyLayer(), attributeBase: emptyLayer(), entities: [] }, []);
  state().selectGameObjects(["rock"]);
});
it("shows the exact successful move immediately without moving the camera or changing saved data shape", () => {
  const before = scene(), camera = state().camera;
  expect(state().transformGameSelection("move", before, [1, 0])).toBe(true);
  const feedback = visibleMovementFeedback(state())!;
  expect(movementLabel(feedback)).toBe("X +1칸 · Y 0칸");
  expect(feedback.from).toEqual([0, 0]);
  expect(feedback.to).toEqual([1.28, -0.64]);
  const immediate = sceneWithMovementFeedback(before, feedback);
  expect(immediate.sprites[0].position).toEqual([1.28, -0.64, -0.14]);
  expect(immediate.sprites[1]).toBe(before.sprites[1]);
  expect(before.sprites[0].position).toEqual([0, 0, 0]);
  expect(state().camera).toBe(camera);
  expect(state().exportProject()).not.toHaveProperty("gameMoveFeedback");
  expect(state().undoStack[0]).not.toHaveProperty("gameMoveFeedback");
  // Server response already contains the target; never apply the same displacement twice.
  const response = scene();
  expect(sceneWithMovementFeedback(response, feedback).sprites).toEqual(response.sprites);
});
it("supports group moves and preserves the separate image offset", () => {
  state().offsetGameObjectVisual("rock", [0.2, 0.4], scene());
  state().selectGameObjects(["rock", "tree"]);
  const before = scene();
  expect(state().transformGameSelection("move", before, [0, -2])).toBe(true);
  const feedback = visibleMovementFeedback(state())!;
  expect(feedback.sprites).toHaveLength(2);
  const immediate = sceneWithMovementFeedback(before, feedback);
  // rock z also carries its image offset (0.4 * DEPTH_SCALE): z follows the drawn Y.
  const expected = [[2.56, 1.28, 0.28 + 0.4 * 0.21875], [5.56, -0.72, 1.28]];
  immediate.sprites.forEach((s, i) => s.position.forEach((v, k) => expect(v).toBeCloseTo(expected[i][k], 9)));
  expect(immediate.sprites[0].visualOffset).toEqual([0.2, 0.4]);
  expect(sceneWithMovementFeedback(scene(), feedback).sprites).toEqual(scene().sprites);
});
it("shows pixel-only movement without changing the logical cell or depth", () => {
  const before = scene();
  state().offsetGameObjectVisual("rock", [0, 0.04], before);
  const feedback = visibleMovementFeedback(state())!;
  expect(movementLabel(feedback)).toBe("가로 0px · 세로 +4px");
  const immediate = sceneWithMovementFeedback(before, feedback);
  expect(immediate.sprites[0].position).toEqual(before.sprites[0].position);
  expect(immediate.sprites[0].visualOffset).toEqual([0, 0.04]);
  expect(feedback.to).toEqual([0, 0.04]);
  expect(sceneWithMovementFeedback(scene(), feedback).sprites).toEqual(scene().sprites);
});
it("shows blocked-only movement using the map origin", () => {
  state().selectGameObjects([]);
  state().selectBlockedCells(["2,2"]);
  const before = scene();
  expect(state().transformGameSelection("move", before, [0, 1])).toBe(true);
  const feedback = visibleMovementFeedback(state())!;
  expect(feedback.beforeCells).toEqual(["2,2"]);
  expect(feedback.cells).toEqual(["2,3"]);
  expect(feedback.from).toEqual([0, 16.64]);
  expect(feedback.to).toEqual([-1.28, 16]);
});
it("removes feedback after selection change, undo, reload, or explicit dismissal", () => {
  state().transformGameSelection("move", scene(), [1, 0]);
  expect(visibleMovementFeedback(state())).not.toBeNull();
  state().selectGameObjects(["tree"]); state().selectGameObjects(["rock"]);
  expect(visibleMovementFeedback(state())).toBeNull();
  state().transformGameSelection("move", scene(), [1, 0]); state().undo();
  expect(visibleMovementFeedback(state())).toBeNull();
  state().redo(); state().selectGameObjects(["rock"]);
  expect(visibleMovementFeedback(state())).toBeNull();
  state().transformGameSelection("move", scene(), [1, 0]); state().clearGameMoveFeedback();
  expect(visibleMovementFeedback(state())).toBeNull();
  state().transformGameSelection("move", scene(), [1, 0]);
  state().loadProject(state().exportProject(), []);
  expect(visibleMovementFeedback(state())).toBeNull();
});
it("does not show a successful move for a rejected or zero-distance operation", () => {
  state().selectBlockedCells(["2,2"]);
  const saved = state().exportProject();
  expect(state().transformGameSelection("move", scene(), [1, 0])).toBe(false);
  expect(visibleMovementFeedback(state())).toBeNull();
  expect(state().exportProject()).toEqual(saved);
  state().selectGameObjects(["rock"]);
  state().transformGameSelection("move", scene(), [1, 0]);
  state().transformGameSelection("move", scene(), [0, 0]);
  expect(visibleMovementFeedback(state())).toBeNull();
});
it("ignores feedback for a different map or document revision", () => {
  const before = scene();
  const f = makeMovementFeedback(before, state(), ["rock"], [], [], [1, 0])!;
  expect(sceneWithMovementFeedback({ ...before, baselineId: "other" }, f).sprites).toBe(before.sprites);
  expect(visibleMovementFeedback({ ...state(), gameMoveFeedback: f, documentNonce: state().documentNonce + 1 })).toBeNull();
  expect(visibleMovementFeedback({ ...state(), gameMoveFeedback: f, blockedVer: state().blockedVer + 1 })).toBeNull();
});
