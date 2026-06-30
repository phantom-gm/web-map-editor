import { create } from "zustand";
import type { Camera } from "../lib/grid";
import { toStoredTile, type PaletteTile } from "../lib/palette";
import type { Blueprint, Layer } from "../types/blueprint";
import { emptyLayer } from "../types/blueprint";
import { buildBlueprint, type ImportResult } from "../lib/blueprintIO";
import { cellKey, parseCellKey, type CellKey } from "../lib/cell";
import { parseRegistry, resolveTile, type TileRegistry, type RegStatus } from "../lib/registry";
import { PROJECT_TYPE, type ProjectFile } from "../lib/projectIO";
import { isEntityKind, newEntityId, type EntityKind, type MapEntity } from "../types/entity";

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

export type Tool = "cursor" | "brush" | "eraser" | "rect" | "eyedropper" | "block" | EntityKind;
type Ground = Map<CellKey, number>;
type Blocked = Set<CellKey>;
type Entities = MapEntity[];
export interface Snapshot {
  ground: Ground;
  blocked: Blocked;
  entities: Entities; // 불변 배열(액션마다 새 배열) → 참조 보관으로 스냅샷
}

const snap = (g: Ground, b: Blocked, e: Entities): Snapshot => ({
  ground: new Map(g),
  blocked: new Set(b),
  entities: e,
});
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

  entities: Entities;
  entitiesVer: number;
  selectedEntityId: string | null;

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

  placeEntity: (kind: EntityKind, gx: number, gy: number) => void;
  moveEntityTo: (id: string, gx: number, gy: number) => void;
  removeEntity: (id: string) => void;
  updateEntity: (id: string, patch: Partial<MapEntity>) => void;
  selectEntity: (id: string | null) => void;
  entityAt: (gx: number, gy: number) => MapEntity | null;

  commitStroke: (before: Snapshot) => void;
  undo: () => void;
  redo: () => void;

  importBlueprint: (r: ImportResult) => void;
  exportBlueprint: () => Blueprint;
  exportProject: () => ProjectFile;
  loadProject: (p: ProjectFile, tiles: PaletteTile[]) => void;
  newProject: () => void;
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
  entities: [],
  entitiesVer: 0,
  selectedEntityId: null,
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
  // 팔레트 타일 선택 — 엔티티 배치 도구가 활성이면 그대로 두고(에셋만 바꿈), 아니면 브러시로.
  setActiveIdx: (i) =>
    set((s) => ({ activeIdx: i, activeTool: isEntityKind(s.activeTool) ? s.activeTool : "brush" })),
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
      const before = snap(s.ground, s.blocked, s.entities);
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
      if (s.ground.size === 0 && s.blocked.size === 0 && s.entities.length === 0) return {};
      const before = snap(s.ground, s.blocked, s.entities);
      s.ground.clear();
      s.blocked.clear();
      return {
        entities: [],
        entitiesVer: s.entitiesVer + 1,
        selectedEntityId: null,
        groundVer: s.groundVer + 1,
        blockedVer: s.blockedVer + 1,
        undoStack: [...s.undoStack, before].slice(-UNDO_CAP),
        redoStack: [],
      };
    }),

  // 엔티티 배치. monster/npc/object 는 현재 선택 팔레트 타일을 에셋으로 참조. portal 은 마커.
  placeEntity: (kind, gx, gy) =>
    set((s) => {
      const [W, H] = s.size;
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) return {};
      const before = snap(s.ground, s.blocked, s.entities);
      let name: string | undefined;
      let ruid: string | undefined;
      if (kind === "portal") {
        name = "portal";
      } else {
        const t = s.palette[s.activeIdx];
        name = t?.name;
        ruid = t?.ruid;
      }
      const ent: MapEntity = { id: newEntityId(), kind, gx, gy, name, ruid };
      if (kind === "monster") ent.spawnCount = 1;
      return {
        entities: [...s.entities, ent],
        entitiesVer: s.entitiesVer + 1,
        selectedEntityId: ent.id,
        undoStack: [...s.undoStack, before].slice(-UNDO_CAP),
        redoStack: [],
      };
    }),
  moveEntityTo: (id, gx, gy) =>
    set((s) => {
      const [W, H] = s.size;
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) return {};
      let changed = false;
      const entities = s.entities.map((e) => {
        if (e.id !== id || (e.gx === gx && e.gy === gy)) return e;
        changed = true;
        return { ...e, gx, gy };
      });
      if (!changed) return {};
      return { entities, entitiesVer: s.entitiesVer + 1 };
    }),
  removeEntity: (id) =>
    set((s) => {
      if (!s.entities.some((e) => e.id === id)) return {};
      const before = snap(s.ground, s.blocked, s.entities);
      return {
        entities: s.entities.filter((e) => e.id !== id),
        entitiesVer: s.entitiesVer + 1,
        selectedEntityId: s.selectedEntityId === id ? null : s.selectedEntityId,
        undoStack: [...s.undoStack, before].slice(-UNDO_CAP),
        redoStack: [],
      };
    }),
  updateEntity: (id, patch) =>
    set((s) => {
      if (!s.entities.some((e) => e.id === id)) return {};
      const before = snap(s.ground, s.blocked, s.entities);
      return {
        entities: s.entities.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        entitiesVer: s.entitiesVer + 1,
        undoStack: [...s.undoStack, before].slice(-UNDO_CAP),
        redoStack: [],
      };
    }),
  selectEntity: (id) => set({ selectedEntityId: id }),
  entityAt: (gx, gy) => {
    const es = get().entities;
    for (let i = es.length - 1; i >= 0; i--) if (es[i].gx === gx && es[i].gy === gy) return es[i];
    return null;
  },

  commitStroke: (before) =>
    set((s) => {
      if (
        groundEqual(before.ground, s.ground) &&
        blockedEqual(before.blocked, s.blocked) &&
        before.entities === s.entities
      ) {
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
      const cur = snap(s.ground, s.blocked, s.entities);
      s.ground.clear();
      for (const [k, v] of prev.ground) s.ground.set(k, v);
      s.blocked.clear();
      for (const k of prev.blocked) s.blocked.add(k);
      return {
        entities: prev.entities,
        entitiesVer: s.entitiesVer + 1,
        selectedEntityId: null,
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
      const cur = snap(s.ground, s.blocked, s.entities);
      s.ground.clear();
      for (const [k, v] of next.ground) s.ground.set(k, v);
      s.blocked.clear();
      for (const k of next.blocked) s.blocked.add(k);
      return {
        entities: next.entities,
        entitiesVer: s.entitiesVer + 1,
        selectedEntityId: null,
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
        entities: r.entities,
        entitiesVer: s.entitiesVer + 1,
        selectedEntityId: null,
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
      entities: s.entities,
    });
  },

  // 전체 프로젝트(맵 + 팔레트) 직렬화. blueprint Export 와 별개.
  exportProject: () => {
    const s = get();
    const ground: Array<[number, number, number]> = [];
    for (const [k, idx] of s.ground) {
      const [gx, gy] = parseCellKey(k);
      ground.push([gx, gy, idx]);
    }
    const blocked: Array<[number, number]> = [];
    for (const k of s.blocked) {
      const [gx, gy] = parseCellKey(k);
      blocked.push([gx, gy]);
    }
    return {
      type: PROJECT_TYPE,
      version: 1,
      map: s.mapName,
      size: s.size,
      groundOrigin: s.groundOrigin,
      ground,
      blocked,
      palette: s.palette.map(toStoredTile),
      staticLayer: s.staticLayer,
      attributeBase: s.attributeBase,
      entities: s.entities,
    };
  },

  // 프로젝트 열기 — tiles 는 호출측에서 img 까지 로드해 넘긴다(tilesFromStored).
  loadProject: (p, tiles) =>
    set((s) => {
      s.ground.clear();
      for (const [gx, gy, idx] of p.ground) s.ground.set(cellKey(gx, gy), idx);
      s.blocked.clear();
      for (const [gx, gy] of p.blocked) s.blocked.add(cellKey(gx, gy));
      return {
        mapName: p.map,
        size: p.size,
        groundOrigin: p.groundOrigin,
        staticLayer: p.staticLayer ?? emptyLayer(),
        attributeBase: p.attributeBase ?? emptyLayer(),
        palette: tiles,
        entities: p.entities ?? [],
        entitiesVer: s.entitiesVer + 1,
        selectedEntityId: null,
        activeIdx: 0,
        groundVer: s.groundVer + 1,
        blockedVer: s.blockedVer + 1,
        fitNonce: s.fitNonce + 1,
        undoStack: [],
        redoStack: [],
      };
    }),

  // 새 프로젝트 — 맵(칠한 셀·이동불가·엔티티·이름·크기)만 초기화. 팔레트(자산 라이브러리)는 유지.
  newProject: () =>
    set((s) => {
      s.ground.clear();
      s.blocked.clear();
      return {
        mapName: "newmap",
        size: [20, 20],
        groundOrigin: [0, 0],
        staticLayer: emptyLayer(),
        attributeBase: emptyLayer(),
        entities: [],
        entitiesVer: s.entitiesVer + 1,
        selectedEntityId: null,
        camera: { x: 0, y: 0, zoom: 1 },
        groundVer: s.groundVer + 1,
        blockedVer: s.blockedVer + 1,
        fitNonce: s.fitNonce + 1,
        undoStack: [],
        redoStack: [],
      };
    }),
}));
