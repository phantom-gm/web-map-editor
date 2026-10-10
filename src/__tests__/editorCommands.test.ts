import { beforeEach, describe, expect, it } from "vitest";
import { activateEditorTool, editorShortcutsBlocked, rollbackEditorStroke, palettePlacementIssue } from "../lib/editorCommands";
import { captureEditorSnapshot, useEditorStore, type Tool } from "../store/editorStore";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import { useWorkspaceSession } from "../lib/gameWorkspace";
import type { GamePreviewScene } from "../lib/gamePreview";
import { cellKey } from "../lib/cell";
import { markServerResourceImage } from "../lib/serverResourceImage";
import type { PaletteTile } from "../lib/palette";

const editor = () => useEditorStore.getState();
const view = () => useGamePreviewStore.getState();
function linkedScene(ground = true, walk = true): GamePreviewScene {
  return { baselineId: "baseline", report: { groundEditingSupported: ground, walkEditingSupported: walk } } as GamePreviewScene;
}
function selectEverything() {
  useEditorStore.setState({ selectedGameObjectId: "house", selectedGameObjectIds: ["house"],
    selectedBlockedCells: [cellKey(1, 1)], selectedGameNpcId: "npc", selectedGameRuntime: { kind: "portal", entityId: "portal" }, selectedEntityId: "legacy" });
  useGamePreviewStore.setState({ selectionMode: "blocked", multiSelect: true, placementPrototypeId: "house",
    placementNpcClassId: 101, runtimePlacement: { kind: "spawn" } });
}
function expectNoSelection() {
  expect(editor().selectedGameObjectIds).toEqual([]);
  expect(editor().selectedBlockedCells).toEqual([]);
  expect(editor().selectedGameObjectId).toBeNull();
  expect(editor().selectedGameNpcId).toBeNull();
  expect(editor().selectedGameRuntime).toBeNull();
  expect(editor().selectedEntityId).toBeNull();
  expect(view().runtimePlacement).toBeNull();
  expect(view().placementNpcClassId).toBeNull();
  expect(view().placementPrototypeId).toBeNull();
}
beforeEach(() => {
  editor().newProject();
  useEditorStore.setState({ palette: [], gameSync: { version: 1, mapName: "fixture", baselineId: "baseline" }, mapName: "fixture" });
  useWorkspaceSession.setState({ loading: false });
  useGamePreviewStore.setState({ comparisonEnabled: false, status: "ready", scene: linkedScene(), showScene: true,
    showOverlays: false, runtimePanel: null, runtimePlacement: null, showNpcs: false, showObjects: false,
    placementNpcClassId: null, placementPrototypeId: null, selectionMode: "objects", multiSelect: false });
});

describe("shared editor tool commands", () => {
  it("allows continuous ground editing while a matching validated preview is refreshing", () => {
    const ruid = "a".repeat(32);
    useEditorStore.setState({ palette: [{ name: "grass", ruid }] as PaletteTile[] });
    useGamePreviewStore.setState({ status: "loading", scene: { ...linkedScene(), groundBrushRuids: [ruid] } });
    activateEditorTool("brush");
    expect(editor().activeTool).toBe("brush"); expect(palettePlacementIssue("brush")).toBeNull();
    useGamePreviewStore.setState({ scene: { ...linkedScene(), baselineId: "other" } });
    expect(palettePlacementIssue("brush")).toContain("불러오는 중");
  });
  it("saving preserves document identity; reopening even the same named project changes it", () => {
    const nonce = editor().documentNonce, project = editor().exportProject();
    editor().markSaved(); expect(editor().documentNonce).toBe(nonce);
    editor().loadProject(project, editor().palette); expect(editor().documentNonce).toBe(nonce + 1);
  });
  it("empty undo/redo leave the selection intact and hovering the same cell emits no store update", () => {
    selectEverything(); const before = editor(); editor().undo(); editor().redo(); expect(editor()).toBe(before);
    editor().setHover([2, 3]); const hovered = editor(); editor().setHover([2, 3]); expect(editor()).toBe(hovered);
  });
  it.each<Tool>(["brush", "rect", "eraser", "eyedropper", "block", "cursor"])("clears hidden selections and placement when activating %s, without editing the project", tool => {
    selectEverything();
    useGamePreviewStore.setState({ showObjects: true, showNpcs: true, runtimePanel: "monster" });
    const before = editor().exportProject(), undo = editor().undoStack;
    activateEditorTool(tool);
    expectNoSelection();
    expect(editor().activeTool).toBe(tool);
    expect(view().selectionMode).toBe("objects");
    expect(view().multiSelect).toBe(false);
    expect(editor().exportProject()).toEqual(before);
    expect(editor().undoStack).toBe(undo);
    expect(editor().dirty).toBe(false);
    if (tool !== "cursor") {
      expect(view().runtimePanel).toBeNull(); expect(view().showObjects).toBe(false); expect(view().showNpcs).toBe(false);
    }
    if (tool === "block") { expect(view().showOverlays).toBe(true); expect(editor().visual.blocked).toBe(true); }
  });
  it.each<Tool>(["object", "npc", "monster", "portal", "spawn"])("opens the correct game library for %s and waits for explicit placement", tool => {
    selectEverything();
    const before = editor().exportProject();
    activateEditorTool(tool);
    expectNoSelection();
    expect(editor().activeTool).toBe("cursor");
    expect(view().showScene).toBe(true);
    expect(view().showObjects).toBe(tool === "object");
    expect(view().showNpcs).toBe(tool === "npc");
    expect(view().runtimePanel).toBe(["monster", "portal", "spawn"].includes(tool) ? tool : null);
    expect(editor().exportProject()).toEqual(before);
  });
  it("keeps the active action intact while a map is loading or comparison is open", () => {
    for (const condition of ["loading", "comparison"] as const) {
      selectEverything();
      useWorkspaceSession.setState({ loading: condition === "loading" });
      useGamePreviewStore.setState({ comparisonEnabled: condition === "comparison" });
      const beforeEditor = editor(), beforeView = view();
      activateEditorTool("brush");
      expect(editor()).toBe(beforeEditor); expect(view()).toBe(beforeView);
    }
  });
  it("does not activate unsupported or stale ground and blocked-cell editing", () => {
    for (const tool of ["brush", "rect", "eraser", "eyedropper", "block"] as Tool[]) {
      for (const scene of [linkedScene(false, false), { ...linkedScene(), baselineId: "older" }]) {
        selectEverything(); useGamePreviewStore.setState({ scene });
        const before = editor();
        activateEditorTool(tool);
        expect(editor()).toBe(before);
      }
    }
  });
  it("preserves legacy placement tools while clearing old selections", () => {
    useEditorStore.setState({ gameSync: undefined }); selectEverything();
    activateEditorTool("monster");
    expectNoSelection(); expect(editor().activeTool).toBe("monster");
  });
});

describe("editor shortcut isolation", () => {
  const event = (target: unknown = null) => ({ target: target as EventTarget | null, isComposing: false, defaultPrevented: false });
  const noModal = { querySelector: () => null } as Pick<Document, "querySelector">;
  it("blocks text controls, their descendants, editable fields and opted-out panels", () => {
    for (const selector of ["input", "textarea", "select", '[contenteditable="true"]', '[contenteditable=""]', '[contenteditable="plaintext-only"]', '[role="textbox"]', '[data-editor-shortcuts="ignore"]']) {
      const target = { closest: (query: string) => query.split(", ").includes(selector) ? target : null };
      expect(editorShortcutsBlocked(event(target), noModal)).toBe(true);
    }
  });
  it("blocks all editor keys behind open native/ARIA/resource dialogs regardless of focus", () => {
    for (const selector of ["dialog[open]", '[aria-modal="true"]', ".rb-overlay"]) {
      const scope = { querySelector: (query: string) => query.split(", ").includes(selector) ? {} : null } as Pick<Document, "querySelector">;
      expect(editorShortcutsBlocked(event(), scope)).toBe(true);
    }
  });
  it("respects IME composition and keys already handled by another widget", () => {
    expect(editorShortcutsBlocked({ ...event(), isComposing: true }, noModal)).toBe(true);
    expect(editorShortcutsBlocked({ ...event(), defaultPrevented: true }, noModal)).toBe(true);
    expect(editorShortcutsBlocked(event({ closest: () => null }), noModal)).toBe(false);
  });
});

describe("canceling a live brush or legacy drag", () => {
  it("restores the unfinished stroke and entity drag without consuming undo or reverting other overlays", () => {
    useEditorStore.setState({ ground: new Map([[cellKey(0, 0), 1]]), blocked: new Set([cellKey(1, 1)]),
      entities: [{ id: "legacy", kind: "object", gx: 1, gy: 2 }] });
    const before = captureEditorSnapshot(editor()), undo = [captureEditorSnapshot(editor())];
    const objectEdits = { version: 1 as const, moved: [{ entityId: "house", position: [3, 4] as [number, number] }], removed: [], added: [] };
    const npcEdits = { version: 1 as const, updated: [{ entityId: "npc", flipX: true }], removed: [], added: [] };
    useEditorStore.setState({ ground: new Map([[cellKey(0, 0), 2], [cellKey(2, 2), 3]]), blocked: new Set(),
      entities: [{ ...editor().entities[0], gx: 7 }], gameObjectEdits: objectEdits, gameNpcEdits: npcEdits,
      gameSpawnEdits: { version: 1, cell: [5, 5] }, undoStack: undo, redoStack: undo });
    const versions = [editor().groundVer, editor().blockedVer, editor().entitiesVer];
    rollbackEditorStroke(before);
    expect(editor().ground).toEqual(before.ground); expect(editor().blocked).toEqual(before.blocked); expect(editor().entities).toBe(before.entities);
    expect(editor().gameObjectEdits).toBe(objectEdits); expect(editor().gameNpcEdits).toBe(npcEdits); expect(editor().gameSpawnEdits?.cell).toEqual([5, 5]);
    expect(editor().undoStack).toBe(undo); expect(editor().redoStack).toBe(undo);
    expect([editor().groundVer, editor().blockedVer, editor().entitiesVer]).toEqual(versions.map(v => v + 1));
    expect(editor().dirty).toBe(true);
  });
  it("does not dirty an unchanged rectangle draft or bump versions", () => {
    const before = captureEditorSnapshot(editor()), state = editor();
    rollbackEditorStroke(before);
    expect(editor()).toBe(state); expect(editor().dirty).toBe(false);
  });
});

describe("server-only new palette placement", () => {
  const tile = (): PaletteTile => ({ name: "server tile", ruid: "a".repeat(32), url: "https://server.example/tile.png", img: { naturalWidth: 64, naturalHeight: 32, complete: true } as HTMLImageElement });
  it("rejects unlinked local images and unverified cached images without changing the draft", () => {
    useEditorStore.setState({ gameSync: undefined, palette: [{ ...tile(), ruid: undefined }], activeIdx: 0 });
    const before = editor().exportProject();
    for (const tool of ["brush", "rect", "object", "npc", "monster"] as Tool[]) expect(palettePlacementIssue(tool)).toContain("MSW 서버");
    expect(editor().exportProject()).toEqual(before);
    useEditorStore.setState({ palette: [tile()] });
    expect(palettePlacementIssue("object")).toContain("다시 선택");
  });
  it("accepts the image confirmed by the server library and keeps marker-only tools available", () => {
    const confirmed = tile(); markServerResourceImage(confirmed);
    useEditorStore.setState({ gameSync: undefined, palette: [confirmed], activeIdx: 0 });
    for (const tool of ["brush", "rect", "object", "npc", "monster"] as Tool[]) expect(palettePlacementIssue(tool)).toBeNull();
    useEditorStore.setState({ palette: [] });
    for (const tool of ["cursor", "portal", "spawn", "block", "eraser", "eyedropper"] as Tool[]) expect(palettePlacementIssue(tool)).toBeNull();
  });
  it("keeps linked server catalog ground and native object/NPC/runtime placement on their established paths", () => {
    const source = tile();
    useEditorStore.setState({ palette: [source], activeIdx: 0 });
    useGamePreviewStore.setState({ scene: { ...linkedScene(), groundBrushRuids: [source.ruid!] } });
    expect(palettePlacementIssue("brush")).toBeNull(); expect(palettePlacementIssue("rect")).toBeNull();
    useEditorStore.setState({ palette: [] });
    for (const tool of ["object", "npc", "monster", "portal", "spawn"] as Tool[]) expect(palettePlacementIssue(tool)).toBeNull();
  });
});
