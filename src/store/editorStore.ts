import { create } from "zustand";
import type { Camera } from "../lib/grid";
import type { PaletteTile } from "../lib/palette";
import type { Blueprint, Layer } from "../types/blueprint";
import { emptyLayer } from "../types/blueprint";
import { buildBlueprint, type ImportResult } from "../lib/blueprintIO";
import { cellKey, type CellKey } from "../lib/cell";
import { parseRegistry, resolveTile, type TileRegistry, type RegStatus } from "../lib/registry";

/** 팔레트 각 타일에 레지스트리 판정(ruid/regStatus)을 채워 새 배열로 반환. */
function resolvePalette(palette: PaletteTile[], reg: TileRegistry | null): PaletteTile[] {
  if (!reg) return palette.map((t) => ({ ...t, ruid: undefined, regStatus: undefined }));
  return palette.map((t) => {
    const r = resolveTile(reg, t.name, t.hash);
    return { ...t, ruid: r.ruid, regStatus: r.status };
  });
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 6;
const UNDO_CAP = 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type Tool = "cursor" | "brush" | "eraser" | "rect" | "eyedropper" | "block";
type Ground = Map<CellKey, number>;
type Blocked = Set<CellKey>;
export interface Snapshot {
  ground: Ground;
  blocked: Blocked;
}

const snap = (g: Ground, b: Blocked): Snapshot => ({ ground: new Map(g), blocked: new Set(b) });
function groundEqual(a: Ground, b: Ground): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}
function blockedEqual(a: Blocked, b: Blocked): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

export interface EditorState {
  mapName: string;
  size: [number, number];
  camera: Camera;
  hover: [number, number] | null;
  fitNonce: number;

  ground: Ground;
  groundVer: number;
  blocked: Blocked;
  blockedVer: number;
  groundOrigin: [number, number];
  staticLayer: Layer;
  attributeBase: Layer;

  palette: PaletteTile[];
  registry: TileRegistry | null;
  activeTool: Tool;
  activeIdx: number;
  rectPreview: [number, number, number, number] | null;

  undoStack: Snapshot[];
  redoStack: Snapshot[];

  setMapName: (n: string) => void;
  setSize: (w: number, h: number) => void;
  panBy: (dx: number, dy: number) => void;
  zoomAt: (factor: number, cx: number, cy: number) => void;
  setHover: (cell: [number, number] | null) => void;
  setCamera: (cam: Camera) => void;
  requestFit: () => void;

  addTiles: (tiles: PaletteTile[]) => void;
  addResolvedTiles: (tiles: PaletteTile[]) => void;
  hydratePalette: (tiles: PaletteTile[]) => void;
  loadRegistry: (json: unknown) => void;
  applyResolutions: (results: Array<{ name: string; status: RegStatus; ruid: string | null }>) => void;
  exportPaletteRuids: () => { map: string; ruids: Record<string, string> };
  setActiveIdx: (i: number) => void;
  setTool: (t: Tool) => void;
  applyTool: (gx: number, gy: number) => void;
  fillRect: (x0: number, y0: number, x1: number, y1: number) => void;
  pickAt: (gx: number, gy: number) => void;
  setRectPreview: (r: [number, number, number, number] | null) => void;
  clearAll: () => void;

  commitStroke: (before: Snapshot) => void;
  undo: () => void;
  redo: () => void;

  importBlueprint: (r: ImportResult) => void;
  exportBlueprint: () => Blueprint;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  mapName: "newmap",
  size: [20, 20],
  camera: { x: 0, y: 0, zoom: 1 },
  hover: null,
  fitNonce: 0,

  ground: new Map(),
  groundVer: 0,
  blocked: new Set(),
  blockedVer: 0,
  groundOrigin: [0, 0],
  staticLayer: emptyLayer(),
  attributeBase: emptyLayer(),
  palette: [],
  registry: null,
  activeTool: "brush",
  activeIdx: 0,
  rectPreview: null,
  undoStack: [],
  redoStack: [],

  setMapName: (n) => set({ mapName: n }),
  setSize: (w, h) =>
    set({ size: [Math.max(1, Math.floor(w) || 1), Math.max(1, Math.floor(h) || 1)] }),
  panBy: (dx, dy) =>
    set((s) => ({ camera: { ...s.camera, x: s.camera.x + dx, y: s.camera.y + dy } })),
  zoomAt: (factor, cx, cy) =>
    set((s) => {
      const nz = clamp(s.camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const wx = (cx - s.camera.x) / s.camera.zoom;
      const wy = (cy - s.camera.y) / s.camera.zoom;
      return { camera: { x: cx - wx * nz, y: cy - wy * nz, zoom: nz } };
    }),
  setHover: (cell) => set({ hover: cell }),
  setCamera: (cam) => set({ camera: cam }),
  requestFit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),

  addTiles: (tiles) =>
    set((s) => ({
      palette: [...s.palette, ...resolvePalette(tiles, s.registry)],
      activeIdx: s.palette.length === 0 && tiles.length > 0 ? 0 : s.activeIdx,
    })),
  // 이미 ruid/regStatus 가 채워진 타일(리소스 스토리지에서 불러온 것)을 그대로 append.
  // resolvePalette 를 거치지 않아 등록 정보가 보존된다(registry 미로드여도 ruid 유지).
  addResolvedTiles: (tiles) =>
    set((s) => {
      // 동일 ruid 중복 추가 방지(이미 팔레트에 있으면 제외).
      const have = new Set(s.palette.map((t) => t.ruid).filter(Boolean));
      const fresh = tiles.filter((t) => !t.ruid || !have.has(t.ruid));
      if (fresh.length === 0) return {};
      return {
        palette: [...s.palette, ...fresh],
        activeIdx: s.palette.length === 0 ? 0 : s.activeIdx,
      };
    }),
  // 영속 저장에서 복원 — 팔레트가 비어 있을 때만 교체(사용자 추가분 덮어쓰기 방지).
  hydratePalette: (tiles) =>
    set((s) => (s.palette.length > 0 || tiles.length === 0 ? {} : { palette: tiles, activeIdx: 0 })),
  loadRegistry: (json) =>
    set((s) => {
      const reg = parseRegistry(json);
      return { registry: reg, palette: resolvePalette(s.palette, reg) };
    }),
  applyResolutions: (results) =>
    set((s) => {
      const byName = new Map(results.map((r) => [r.name, r]));
      return {
        palette: s.palette.map((t) => {
          const r = byName.get(t.name);
          return r ? { ...t, ruid: r.ruid ?? undefined, regStatus: r.status } : t;
        }),
      };
    }),
  exportPaletteRuids: () => {
    const s = get();
    const ruids: Record<string, string> = {};
    for (const t of s.palette) if (t.ruid) ruids[t.name] = t.ruid;
    return { map: s.mapName, ruids };
  },
  setActiveIdx: (i) => set({ activeIdx: i, activeTool: "brush" }),
  setTool: (t) => set({ activeTool: t }),

  applyTool: (gx, gy) =>
    set((s) => {
      const [W, H] = s.size;
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) return {};
      const key = cellKey(gx, gy);
      if (s.activeTool === "block") {
        if (s.blocked.has(key)) return {};
        s.blocked.add(key);
        return { blockedVer: s.blockedVer + 1 };
      }
      if (s.activeTool === "eraser") {
        const g = s.ground.delete(key);
        const b = s.blocked.delete(key);
        if (!g && !b) return {};
        const patch: Partial<EditorState> = {};
        if (g) patch.groundVer = s.groundVer + 1;
        if (b) patch.blockedVer = s.blockedVer + 1;
        return patch;
      }
      // brush
      if (s.ground.get(key) === s.activeIdx) return {};
      s.ground.set(key, s.activeIdx);
      return { groundVer: s.groundVer + 1 };
    }),

  fillRect: (x0, y0, x1, y1) =>
    set((s) => {
      const [W, H] = s.size;
      const before = snap(s.ground, s.blocked);
      const minX = Math.max(0, Math.min(x0, x1));
      const maxX = Math.min(W - 1, Math.max(x0, x1));
      const minY = Math.max(0, Math.min(y0, y1));
      const maxY = Math.min(H - 1, Math.max(y0, y1));
      for (let gy = minY; gy <= maxY; gy++) {
        for (let gx = minX; gx <= maxX; gx++) {
          s.ground.set(cellKey(gx, gy), s.activeIdx);
        }
      }
      if (groundEqual(before.ground, s.ground)) return {};
      return {
        groundVer: s.groundVer + 1,
        undoStack: [...s.undoStack, before].slice(-UNDO_CAP),
        redoStack: [],
      };
    }),

  pickAt: (gx, gy) =>
    set((s) => {
      const idx = s.ground.get(cellKey(gx, gy));
      if (idx === undefined) return {};
      return { activeIdx: idx, activeTool: "brush" };
    }),

  setRectPreview: (r) => set({ rectPreview: r }),

  clearAll: () =>
    set((s) => {
      if (s.ground.size === 0 && s.blocked.size === 0) return {};
      const before = snap(s.ground, s.blocked);
      s.ground.clear();
      s.blocked.clear();
      return {
        groundVer: s.groundVer + 1,
        blockedVer: s.blockedVer + 1,
        undoStack: [...s.undoStack, before].slice(-UNDO_CAP),
        redoStack: [],
      };
    }),

  commitStroke: (before) =>
    set((s) => {
      if (groundEqual(before.ground, s.ground) && blockedEqual(before.blocked, s.blocked)) {
        return {};
      }
      return {
        undoStack: [...s.undoStack, before].slice(-UNDO_CAP),
        redoStack: [],
      };
    }),

  undo: () =>
    set((s) => {
      if (s.undoStack.length === 0) return {};
      const prev = s.undoStack[s.undoStack.length - 1];
      const cur = snap(s.ground, s.blocked);
      s.ground.clear();
      for (const [k, v] of prev.ground) s.ground.set(k, v);
      s.blocked.clear();
      for (const k of prev.blocked) s.blocked.add(k);
      return {
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, cur].slice(-UNDO_CAP),
        groundVer: s.groundVer + 1,
        blockedVer: s.blockedVer + 1,
      };
    }),
  redo: () =>
    set((s) => {
      if (s.redoStack.length === 0) return {};
      const next = s.redoStack[s.redoStack.length - 1];
      const cur = snap(s.ground, s.blocked);
      s.ground.clear();
      for (const [k, v] of next.ground) s.ground.set(k, v);
      s.blocked.clear();
      for (const k of next.blocked) s.blocked.add(k);
      return {
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, cur].slice(-UNDO_CAP),
        groundVer: s.groundVer + 1,
        blockedVer: s.blockedVer + 1,
      };
    }),

  importBlueprint: (r) =>
    set((s) => {
      s.ground.clear();
      for (const [gx, gy, idx] of r.cells) s.ground.set(cellKey(gx, gy), idx);
      s.blocked.clear();
      for (const [gx, gy] of r.blocked) s.blocked.add(cellKey(gx, gy));
      return {
        mapName: r.mapName,
        size: r.size,
        groundOrigin: r.groundOrigin,
        staticLayer: r.staticLayer,
        attributeBase: r.attributeBase,
        palette: resolvePalette(
          r.paletteNames.map((name) => ({ name, url: "", img: null })),
          s.registry,
        ),
        activeIdx: 0,
        groundVer: s.groundVer + 1,
        blockedVer: s.blockedVer + 1,
        fitNonce: s.fitNonce + 1,
        undoStack: [],
        redoStack: [],
      };
    }),
  exportBlueprint: () => {
    const s = get();
    return buildBlueprint({
      mapName: s.mapName,
      size: s.size,
      groundOrigin: s.groundOrigin,
      paletteNames: s.palette.map((t) => t.name),
      ground: s.ground,
      blocked: s.blocked,
      staticLayer: s.staticLayer,
      attributeBase: s.attributeBase,
    });
  },
}));
