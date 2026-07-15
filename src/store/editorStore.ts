import { create } from "zustand";
import { TW, type Camera } from "../lib/grid";
import { toStoredTile, type PaletteTile } from "../lib/palette";
import type { Blueprint, Layer } from "../types/blueprint";
import { emptyLayer } from "../types/blueprint";
import { buildBlueprint, type ImportResult } from "../lib/blueprintIO";
import { cellKey, parseCellKey, type CellKey } from "../lib/cell";
import { parseRegistry, resolveTile, type TileRegistry, type RegStatus } from "../lib/registry";
import { defaultNpcCatalog, parseNpcCatalog, type NpcCatalog } from "../lib/npcClass";
import { exportEntities } from "../lib/entityExport";
import { PROJECT_TYPE, type ProjectFile } from "../lib/projectIO";
import { footprintWH, migrateEntity, newEntityId, renderWH, type EntityKind, type MapEntity } from "../types/entity";

/** 팔레트 각 타일에 레지스트리 판정(ruid/regStatus)을 채워 새 배열로 반환. */
function resolvePalette(palette: PaletteTile[], reg: TileRegistry | null): PaletteTile[] {
  // 레지스트리 없으면 기존 판정 유지(스토리지에서 온 RUID 보존 — 권위 있음).
  if (!reg) return palette;
  return palette.map((t) => {
    // 이미 RUID 보유(스토리지/이전 조회로 등록 확인됨) → 로컬 레지스트리에 없어도 강등 금지.
    if (t.ruid) return t;
    const r = resolveTile(reg, t.name, t.hash);
    return { ...t, ruid: r.ruid, regStatus: r.status };
  });
}

/**
 * 기존 팔레트에 incoming 을 이름 기준으로 병합(중복은 기존 것 재사용, 신규는 append).
 * 불러오기(프로젝트/blueprint) 시 기존 팔레트를 날리지 않기 위함.
 * incoming 의 인덱스 → 병합 후 인덱스 매핑(map cells 재배치용)을 함께 반환.
 */
function mergePalette(
  existing: PaletteTile[],
  incoming: PaletteTile[],
): { merged: PaletteTile[]; indexMap: number[] } {
  const merged = [...existing];
  const idxByName = new Map<string, number>();
  merged.forEach((t, i) => {
    if (!idxByName.has(t.name)) idxByName.set(t.name, i);
  });
  const indexMap = incoming.map((t) => {
    const ex = idxByName.get(t.name);
    if (ex !== undefined) return ex; // 같은 이름 → 기존 타일 재사용(이미지 보존)
    const ni = merged.length;
    merged.push(t);
    idxByName.set(t.name, ni);
    return ni;
  });
  return { merged, indexMap };
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 6;
const UNDO_CAP = 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type Tool = "cursor" | "brush" | "eraser" | "rect" | "eyedropper" | "block" | EntityKind;

// 팔레트 타일의 category(스토리지 subcategory)로 선택 시 활성화할 도구 결정.
//   foothold → 브러시(바닥 타일), npc/monster → 해당 배치, 그 외 전부 → 오브젝트 배치.
export function toolForCategory(category?: string): Tool {
  switch ((category || "").toLowerCase()) {
    case "foothold":
      return "brush";
    case "npc":
      return "npc";
    case "monster":
      return "monster";
    default:
      return "object";
  }
}
// 편집용 오버레이 표시 토글 — grid(빈 격자) / blocked(이동불가 빨강) / footprint(오브젝트 점유 표시)
export type VisualLayer = "grid" | "blocked" | "footprint";
export type VisualFlags = Record<VisualLayer, boolean>;
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
  npcCatalog: NpcCatalog; // 몬스터/NPC npcClassId 드롭다운 소스 (기본=번들 seed)
  activeTool: Tool;
  activeIdx: number;
  rectPreview: [number, number, number, number] | null;

  entities: Entities;
  entitiesVer: number;
  selectedEntityId: string | null;

  visual: VisualFlags; // 편집 오버레이 표시 여부 (격자/이동불가/점유)

  dirty: boolean; // 마지막 저장/불러오기 이후 변경됨 — beforeunload 경고용
  resetNonce: number; // 저장/불러오기/새로만들기 시 증가 → dirty 기준점 리셋 신호

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
  removeTiles: (indices: number[]) => void;
  hydratePalette: (tiles: PaletteTile[]) => void;
  loadRegistry: (json: unknown) => void;
  loadNpcCatalog: (json: unknown) => void;
  applyResolutions: (results: Array<{ name: string; status: RegStatus; ruid: string | null }>) => void;
  exportPaletteRuids: () => { map: string; ruids: Record<string, string> };
  setActiveIdx: (i: number) => void;
  setTool: (t: Tool) => void;
  toggleVisual: (k: VisualLayer) => void;
  applyTool: (gx: number, gy: number) => void;
  setBlockedAt: (gx: number, gy: number, on: boolean) => void;
  fillRect: (x0: number, y0: number, x1: number, y1: number) => void;
  pickAt: (gx: number, gy: number) => void;
  setRectPreview: (r: [number, number, number, number] | null) => void;
  clearAll: () => void;

  placeEntity: (kind: EntityKind, gx: number, gy: number) => void;
  moveEntityTo: (id: string, gx: number, gy: number) => void;
  removeEntity: (id: string) => void;
  duplicateEntity: (id: string) => void;
  updateEntity: (id: string, patch: Partial<MapEntity>) => void;
  selectEntity: (id: string | null) => void;

  commitStroke: (before: Snapshot) => void;
  undo: () => void;
  redo: () => void;

  importBlueprint: (r: ImportResult) => void;
  exportBlueprint: () => Blueprint;
  exportProject: () => ProjectFile;
  loadProject: (p: ProjectFile, tiles: PaletteTile[]) => void;
  newProject: () => void;
  markSaved: () => void;
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
  npcCatalog: defaultNpcCatalog(),
  activeTool: "cursor", // 열 때 기본 = 커서(선택). 팔레트 타일 선택 시 category 로 전환.
  activeIdx: 0,
  rectPreview: null,
  entities: [],
  entitiesVer: 0,
  selectedEntityId: null,
  visual: { grid: true, blocked: true, footprint: true },
  dirty: false,
  resetNonce: 0,
  undoStack: [],
  redoStack: [],

  // 저장 완료 표시 — dirty 기준점 리셋(resetNonce 증가로 App 구독이 dirty 해제).
  markSaved: () => set((s) => ({ resetNonce: s.resetNonce + 1 })),

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
    set((s) => {
      const palette = [...s.palette, ...resolvePalette(tiles, s.registry)];
      const activeIdx = s.palette.length === 0 && tiles.length > 0 ? 0 : s.activeIdx;
      // 활성 타일이 새로 정해지면 도구도 category 로 전환 — 안 하면 object 타일이 활성인데
      // 브러시가 남아 바닥에 오브젝트를 칠하는 사고(계약 §4 위반)가 남(브라우저 실측 재현).
      return { palette, activeIdx, activeTool: toolForCategory(palette[activeIdx]?.category) };
    }),
  // 이미 ruid/regStatus 가 채워진 타일(리소스 스토리지에서 불러온 것)을 그대로 append.
  // resolvePalette 를 거치지 않아 등록 정보가 보존된다(registry 미로드여도 ruid 유지).
  addResolvedTiles: (tiles) =>
    set((s) => {
      // 동일 ruid 중복 추가 방지(이미 팔레트에 있으면 제외).
      const have = new Set(s.palette.map((t) => t.ruid).filter(Boolean));
      const fresh = tiles.filter((t) => !t.ruid || !have.has(t.ruid));
      if (fresh.length === 0) return {};
      const palette = [...s.palette, ...fresh];
      const activeIdx = s.palette.length === 0 ? 0 : s.activeIdx;
      return { palette, activeIdx, activeTool: toolForCategory(palette[activeIdx]?.category) };
    }),
  // 팔레트 타일 삭제(여러 개). ground 가 팔레트 인덱스를 참조하므로 인덱스 리맵 필수:
  // 삭제된 타일을 쓰던 셀은 제거하고, 남은 타일 인덱스를 앞으로 당긴다.
  // (undo 스냅샷은 팔레트를 담지 않아 인덱스가 어긋나므로 되돌리기 스택을 비운다)
  removeTiles: (indices) =>
    set((s) => {
      const remove = new Set(indices.filter((i) => i >= 0 && i < s.palette.length));
      if (remove.size === 0) return {};
      const remap: number[] = []; // old idx → new idx (-1 = 삭제됨)
      let next = 0;
      for (let i = 0; i < s.palette.length; i++) remap[i] = remove.has(i) ? -1 : next++;
      const palette = s.palette.filter((_, i) => !remove.has(i));
      const ground: Ground = new Map();
      for (const [k, idx] of s.ground) {
        const ni = remap[idx];
        if (ni >= 0) ground.set(k, ni); // 삭제된 타일 셀은 버림
      }
      const mappedActive = remap[s.activeIdx];
      const activeIdx = Math.min(mappedActive >= 0 ? mappedActive : 0, Math.max(0, palette.length - 1));
      return {
        palette,
        ground,
        activeIdx,
        groundVer: s.groundVer + 1,
        undoStack: [],
        redoStack: [],
      };
    }),
  // 영속 저장에서 복원 — 팔레트가 비어 있을 때만 교체(사용자 추가분 덮어쓰기 방지). 복원은 dirty 아님.
  hydratePalette: (tiles) =>
    set((s) =>
      s.palette.length > 0 || tiles.length === 0
        ? {}
        : { palette: tiles, activeIdx: 0, resetNonce: s.resetNonce + 1 },
    ),
  loadRegistry: (json) =>
    set((s) => {
      const reg = parseRegistry(json);
      return { registry: reg, palette: resolvePalette(s.palette, reg) };
    }),
  loadNpcCatalog: (json) => set({ npcCatalog: parseNpcCatalog(json) }),
  applyResolutions: (results) =>
    set((s) => {
      const byName = new Map(results.map((r) => [r.name, r]));
      return {
        palette: s.palette.map((t) => {
          const r = byName.get(t.name);
          if (!r) return t;
          // 서버가 RUID 를 못 찾았는데 이미 RUID 보유(스토리지 등록 타일)면 강등하지 않음.
          if (!r.ruid && t.ruid) return t;
          return { ...t, ruid: r.ruid ?? undefined, regStatus: r.status };
        }),
      };
    }),
  exportPaletteRuids: () => {
    const s = get();
    const ruids: Record<string, string> = {};
    for (const t of s.palette) if (t.ruid) ruids[t.name] = t.ruid;
    return { map: s.mapName, ruids };
  },
  // 팔레트 타일 선택 — 타일 category 로 도구 자동 전환(foothold=브러시, npc/monster/그외=배치).
  setActiveIdx: (i) =>
    set((s) => ({ activeIdx: i, activeTool: toolForCategory(s.palette[i]?.category) })),
  setTool: (t) => set({ activeTool: t }),

  toggleVisual: (k) => set((s) => ({ visual: { ...s.visual, [k]: !s.visual[k] } })),

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

  // 이동불가 단일 셀 on/off — block 도구 좌클릭(생성)/우클릭(지우기)에 사용.
  setBlockedAt: (gx, gy, on) =>
    set((s) => {
      const [W, H] = s.size;
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) return {};
      const key = cellKey(gx, gy);
      if (on) {
        if (s.blocked.has(key)) return {};
        s.blocked.add(key);
      } else if (!s.blocked.delete(key)) {
        return {};
      }
      return { blockedVer: s.blockedVer + 1 };
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
      let tilesW: number | undefined;
      let nw = 0, nh = 0;
      if (kind === "portal") {
        name = "portal";
      } else if (kind === "object" && !((s.palette[s.activeIdx]?.img?.naturalWidth ?? 0) > 0)) {
        // 이미지 없는 팔레트 타일(RUID 매핑만 불러온 경우 등) → 네이티브 크기를 알 수 없다.
        //   여기서 baseW 를 1 로 찍으면 그 잘못된 크기가 영구 고정되어 게임까지 조용히 흘러간다.
        //   배치를 거부하는 게 맞다(호출측 CanvasGrid 가 이유를 알린다).
        return {};
      } else {
        const t = s.palette[s.activeIdx];
        name = t?.name;
        ruid = t?.ruid;
        nw = t?.img?.naturalWidth ?? 0;
        nh = t?.img?.naturalHeight ?? 0;
        // 점유 폭 기본값 — 오브젝트는 항상 1×1(아래), 몬스터·NPC 만 이미지폭/타일폭(반올림)을 쓴다.
        tilesW = kind === "object" || nw <= 0 ? 1 : Math.max(1, Math.round(nw / TW));
      }
      const ent: MapEntity = { id: newEntityId(), kind, gx, gy, name, ruid, tilesW };
      if (kind !== "portal") ent.tilesH = 1;
      if (kind === "object") {
        // 이미지 크기 = 소스 픽셀 1:1(고정 PPU). baseW 를 정수 타일로 반올림하지 않는다 —
        //   반올림하면 90px→1타일(64px, −29%), 100px→2타일(128px, +28%) 처럼 비슷한 에셋이
        //   2배까지 벌어져 "크기가 제각각" 해진다. 실수로 두면 export scale 이 항상 56/64 로 일정.
        //   점유(tilesW/H=1×1)와 완전 분리 — 크기는 배율(scaleMul), 충돌은 인스펙터 W×H 로.
        //   (몬스터·NPC 는 baseW 미설정 → 기존처럼 tilesW 가 이미지도 결정.)
        ent.baseW = nw > 0 ? nw / TW : 1;
        ent.baseH = nh > 0 ? nh / TW : 1;
      }
      if (kind === "monster") ent.spawnCount = 1;
      // 포탈 도착 셀 기본값 = 배치 위치(현재 셀). 목적지 맵만 채우면 되도록 하고, 필요 시 변경.
      // destFacing 은 미설정(=무관) 으로 둔다 — 변환기가 미지정 시 기본 SE 로 emit.
      if (kind === "portal") ent.destCell = [gx, gy];
      // 겹침 허용 — 클릭 셀에 그대로 배치. footprint 가 맵 밖으로 나가지 않게 앵커만 클램프.
      if (kind !== "portal") {
        const [fw, fh] = footprintWH(ent);
        ent.gx = Math.max(0, Math.min(gx, W - fw));
        ent.gy = Math.max(0, Math.min(gy, H - fh));
      }
      return {
        entities: [...s.entities, ent],
        entitiesVer: s.entitiesVer + 1,
        selectedEntityId: ent.id,
        // 배치 후 즉시 커서(선택) 모드로 — 방금 만든 엔티티를 바로 리사이즈/이동/설정.
        // 연속 생성이 아니라 "하나 만들고 조작". 또 만들려면 배치 도구를 다시 누른다.
        activeTool: "cursor",
        undoStack: [...s.undoStack, before].slice(-UNDO_CAP),
        redoStack: [],
      };
    }),
  moveEntityTo: (id, gx, gy) =>
    set((s) => {
      const [W, H] = s.size;
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) return {};
      const ent = s.entities.find((e) => e.id === id);
      if (!ent || (ent.gx === gx && ent.gy === gy)) return {};
      // 겹침 허용 — 경계만 확인(footprint 가 맵 밖으로 나가면 이동 안 함). 다른 오브젝트와 겹쳐도 OK.
      if (ent.kind !== "portal") {
        const [w, h] = footprintWH(ent);
        if (gx + w > W || gy + h > H) return {};
      }
      return {
        entities: s.entities.map((e) => (e.id === id ? { ...e, gx, gy } : e)),
        entitiesVer: s.entitiesVer + 1,
      };
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
  // 복사 — 같은 속성으로 원본 footprint 바로 옆(+gx)에 배치(겹침 허용, 경계 클램프). 선택+커서.
  duplicateEntity: (id) =>
    set((s) => {
      const src = s.entities.find((e) => e.id === id);
      if (!src) return {};
      const before = snap(s.ground, s.blocked, s.entities);
      const [W, H] = s.size;
      const [fw, fh] = footprintWH(src);
      // 복사본은 원본과 겹치지 않게 옆으로. 오브젝트는 점유(1×1 고정)가 아니라 "보이는 폭"(renderWH)
      //   만큼 밀어야 한다 — 점유 기준으로 밀면 큰 스프라이트가 1칸만 이동해 거의 포개진다.
      const visW = Math.max(1, Math.ceil(renderWH(src)[0]));
      const step = src.kind === "portal" ? 1 : src.kind === "object" ? visW : fw;
      const gx = Math.max(0, Math.min(src.gx + step, W - (src.kind === "portal" ? 1 : fw)));
      const gy = Math.max(0, Math.min(src.gy, H - (src.kind === "portal" ? 1 : fh)));
      const copy: MapEntity = { ...src, id: newEntityId(), gx, gy };
      return {
        entities: [...s.entities, copy],
        entitiesVer: s.entitiesVer + 1,
        selectedEntityId: copy.id,
        activeTool: "cursor",
        undoStack: [...s.undoStack, before].slice(-UNDO_CAP),
        redoStack: [],
      };
    }),
  selectEntity: (id) => set({ selectedEntityId: id }),

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
      // 기존 팔레트 유지 + blueprint 팔레트 병합(이름 기준; 같은 이름 기존 타일의 이미지 보존) + cells 인덱스 리맵.
      const incoming = resolvePalette(
        r.paletteNames.map((name) => ({ name, url: "", img: null })),
        s.registry,
      );
      const { merged, indexMap } = mergePalette(s.palette, incoming);
      s.ground.clear();
      for (const [gx, gy, idx] of r.cells) s.ground.set(cellKey(gx, gy), indexMap[idx] ?? idx);
      s.blocked.clear();
      for (const [gx, gy] of r.blocked) s.blocked.add(cellKey(gx, gy));
      return {
        mapName: r.mapName,
        size: r.size,
        groundOrigin: r.groundOrigin,
        staticLayer: r.staticLayer,
        attributeBase: r.attributeBase,
        palette: merged,
        entities: r.entities.map(migrateEntity),
        entitiesVer: s.entitiesVer + 1,
        selectedEntityId: null,
        activeIdx: 0,
        groundVer: s.groundVer + 1,
        blockedVer: s.blockedVer + 1,
        fitNonce: s.fitNonce + 1,
        undoStack: [],
        redoStack: [],
        dirty: false,
        resetNonce: s.resetNonce + 1,
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
      entities: exportEntities(s.entities, s.palette), // object 에 scale/footprintCells 부착
    };
  },

  // 프로젝트 열기 — tiles 는 호출측에서 img 까지 로드해 넘긴다(tilesFromStored).
  // 기존 팔레트는 유지하고 프로젝트 팔레트를 병합(이름 기준) + ground 인덱스를 병합 인덱스로 리맵.
  loadProject: (p, tiles) =>
    set((s) => {
      const { merged, indexMap } = mergePalette(s.palette, tiles);
      s.ground.clear();
      for (const [gx, gy, idx] of p.ground) s.ground.set(cellKey(gx, gy), indexMap[idx] ?? idx);
      s.blocked.clear();
      for (const [gx, gy] of p.blocked) s.blocked.add(cellKey(gx, gy));
      return {
        mapName: p.map,
        size: p.size,
        groundOrigin: p.groundOrigin,
        staticLayer: p.staticLayer ?? emptyLayer(),
        attributeBase: p.attributeBase ?? emptyLayer(),
        palette: merged,
        entities: (p.entities ?? []).map(migrateEntity), // 레거시 target* → dest* 하위호환
        entitiesVer: s.entitiesVer + 1,
        selectedEntityId: null,
        activeIdx: 0,
        groundVer: s.groundVer + 1,
        blockedVer: s.blockedVer + 1,
        fitNonce: s.fitNonce + 1,
        undoStack: [],
        redoStack: [],
        dirty: false,
        resetNonce: s.resetNonce + 1,
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
        dirty: false,
        resetNonce: s.resetNonce + 1,
      };
    }),
}));
