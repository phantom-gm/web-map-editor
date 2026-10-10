import { useEditorStore, type Snapshot, type Tool } from "../store/editorStore";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import { useWorkspaceSession } from "./gameWorkspace";
import { isServerResourceImage } from "./serverResourceImage";

/** The toolbar and keyboard must leave the same selection and placement state. */
export function activateEditorTool(tool: Tool): void {
  const editor = useEditorStore.getState(), view = useGamePreviewStore.getState();
  if (useWorkspaceSession.getState().loading || view.comparisonEnabled) return;
  if (editor.gameSync && ["brush", "rect", "eraser", "eyedropper", "block"].includes(tool)) {
    const scene = view.scene;
    if (view.status === "error" || scene?.baselineId !== editor.gameSync.baselineId ||
      (tool === "block" ? scene.report?.walkEditingSupported !== true : scene.report?.groundEditingSupported !== true)) return;
  }
  editor.clearGameSelection();
  view.setRuntimePlacement(null); view.setPlacementNpc(null); view.setPlacementPrototype(null);
  view.setSelectionMode("objects"); view.setMultiSelect(false);
  if (!editor.gameSync) { editor.setTool(tool); return; }
  if (tool === "monster" || tool === "portal" || tool === "spawn" || tool === "trap") {
    view.setRuntimePanel(tool); editor.setTool("cursor"); return;
  }
  if (tool === "npc") { view.setShowNpcs(true); editor.setTool("cursor"); return; }
  if (tool === "object") { view.setShowObjects(true); view.setShowScene(true); editor.setTool("cursor"); return; }
  if (tool !== "cursor") {
    view.setRuntimePanel(null); view.setShowNpcs(false); view.setShowObjects(false);
  }
  if (tool === "block") {
    view.setShowOverlays(true);
    if (!editor.visual.blocked) editor.toggleVisual("blocked");
  }
  editor.setTool(tool);
}

type ShortcutEvent = Pick<KeyboardEvent, "target" | "isComposing" | "defaultPrevented">;
type ShortcutDocument = Pick<Document, "querySelector">;
/** Native dialogs and the resource browser isolate every editor shortcut. */
export function editorShortcutsBlocked(event: ShortcutEvent, scope?: ShortcutDocument): boolean {
  if (event.defaultPrevented || event.isComposing) return true;
  const root = scope ?? (typeof document === "undefined" ? undefined : document);
  if (root?.querySelector('dialog[open], [aria-modal="true"], .rb-overlay')) return true;
  const target = event.target as Element | null;
  return !!target?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"], [data-editor-shortcuts="ignore"]');
}

/** Explicit Escape/Ctrl+Z cancels a live stroke without consuming earlier history. */
export function rollbackEditorStroke(before: Snapshot): void {
  useEditorStore.setState(state => {
    const sameGround = before.ground.size === state.ground.size && [...before.ground].every(([key, value]) => state.ground.get(key) === value);
    const sameBlocked = before.blocked.size === state.blocked.size && [...before.blocked].every(key => state.blocked.has(key));
    const sameEntities = before.entities === state.entities;
    if (sameGround && sameBlocked && sameEntities) return state;
    state.ground.clear(); for (const [key, value] of before.ground) state.ground.set(key, value);
    state.blocked.clear(); for (const key of before.blocked) state.blocked.add(key);
    return { dirty: true, entities: before.entities,
      groundVer: state.groundVer + Number(!sameGround), blockedVer: state.blockedVer + Number(!sameBlocked),
      entitiesVer: state.entitiesVer + Number(!sameEntities) };
  });
}

/** New palette painting/placement requires a server-confirmed image; existing scene objects keep their own resource path. */
export function palettePlacementIssue(tool: Tool): string | null {
  const editor = useEditorStore.getState(), view = useGamePreviewStore.getState();
  const usesPalette = tool === "brush" || tool === "rect" || (!editor.gameSync && ["object", "npc", "monster"].includes(tool));
  if (!usesPalette) return null;
  const tile = editor.palette[editor.activeIdx];
  if (!tile?.ruid || !/^[a-f0-9]{32}$/i.test(tile.ruid)) return "이 소재는 MSW 서버와 연결되지 않았습니다. 왼쪽 팔레트에서 서버 소재를 선택하세요.";
  // Linked ground already comes from the server preview/catalog path, independently of the legacy palette cache.
  if (editor.gameSync) {
    if (view.status === "error") return view.error || "게임 미리보기를 갱신한 뒤 다시 칠하세요.";
    if (view.scene?.baselineId !== editor.gameSync.baselineId) return "게임 바닥 정보를 불러오는 중입니다. 잠시 기다려 주세요.";
    if (view.scene.groundBrushRuids?.includes(tile.ruid)) return null;
  }
  return isServerResourceImage(tile) ? null : "새 배치 전에 서버 이미지 확인이 필요합니다. 왼쪽 팔레트에서 소재를 다시 선택하세요.";
}
