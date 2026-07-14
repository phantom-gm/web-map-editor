import type { Blueprint, Layer, Cell } from "../types/blueprint";
import { emptyLayer } from "../types/blueprint";
import { entityFootprintCells, type MapEntity } from "../types/entity";
import { parseCellKey, type CellKey } from "./cell";

export interface ImportResult {
  mapName: string;
  size: [number, number];
  groundOrigin: [number, number];
  paletteNames: string[];
  cells: Array<[number, number, number]>; // 에디터 0-based (gx,gy,idx)
  blocked: Array<[number, number]>; // 이동불가 셀(0-based) — TileAttributeTileMap
  staticLayer: Layer; // 에디터 미편집 → verbatim 보존
  attributeBase: Layer; // origin/size/palette 보존(cells 는 blocked 로 재생성)
  entities: MapEntity[]; // 포탈/몬스터/NPC/오브젝트(0-based 로 변환)
}

/** blueprint JSON → 에디터용. Ground/Attribute cells 를 origin 빼서 0-based 로 변환. */
export function parseBlueprint(json: unknown): ImportResult {
  const bp = json as Blueprint;
  const g = bp.layers?.GroundTileMap;
  if (!g) throw new Error("GroundTileMap 레이어가 없습니다");
  const [ox, oy] = g.origin ?? [0, 0];
  const cells = (g.cells ?? []).map(
    ([gx, gy, idx]) => [gx - ox, gy - oy, idx] as [number, number, number],
  );

  const a = bp.layers?.TileAttributeTileMap ?? emptyLayer();
  const [aox, aoy] = a.origin ?? [0, 0];
  const blocked = (a.cells ?? []).map(([gx, gy]) => [gx - aox, gy - aoy] as [number, number]);

  // 엔티티 — 절대좌표 → ground origin 빼서 0-based 로.
  const entities: MapEntity[] = (bp.entities ?? []).map((e) => ({
    ...e,
    gx: e.gx - ox,
    gy: e.gy - oy,
  }));

  return {
    mapName: bp.map ?? "imported",
    size: g.size ?? [20, 20],
    groundOrigin: [ox, oy],
    paletteNames: g.palette ?? [],
    cells,
    blocked,
    staticLayer: bp.layers?.StaticTileMap ?? emptyLayer(),
    attributeBase: a,
    entities,
  };
}

/** 에디터 상태 → blueprint JSON. Ground 0-based → origin 더해 절대좌표. blocked → Attribute 레이어. */
export function buildBlueprint(args: {
  mapName: string;
  size: [number, number];
  groundOrigin: [number, number];
  paletteNames: string[];
  ground: Map<string, number>;
  blocked: Set<CellKey>;
  staticLayer: Layer;
  attributeBase: Layer;
  entities: MapEntity[];
}): Blueprint {
  const [W, H] = args.size;
  const inBounds = (gx: number, gy: number) => gx >= 0 && gy >= 0 && gx < W && gy < H;

  const [ox, oy] = args.groundOrigin;
  const cells: Cell[] = [];
  for (const [k, idx] of args.ground) {
    const [gx, gy] = parseCellKey(k);
    if (!inBounds(gx, gy)) continue; // 경계 클램프: size 밖 셀 무시
    cells.push([gx + ox, gy + oy, idx]);
  }
  cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]); // row-major (gy 우선, gx)
  const ground: Layer = {
    size: args.size,
    origin: args.groundOrigin,
    paletteCount: args.paletteNames.length,
    palette: args.paletteNames,
    cellCount: cells.length,
    cells,
  };

  // 이동불가 → TileAttributeTileMap (attributeBase 의 origin/size/palette 보존, cells 만 재생성)
  // 수동 이동불가 ∪ 모든 오브젝트 footprint 점유 셀(중복 제거). 경계 밖은 무시.
  const ab = args.attributeBase;
  const [aox, aoy] = ab.origin ?? [0, 0];
  const blockedCells = new Set<string>();
  for (const k of args.blocked) {
    const [gx, gy] = parseCellKey(k);
    if (inBounds(gx, gy)) blockedCells.add(`${gx},${gy}`);
  }
  for (const e of args.entities) {
    // 오브젝트는 "충돌"(blocks) 켠 것만 이동을 막는다 — entityExport 의 footprintCells 계약과 동일.
    //   예전엔 blocks 무시하고 모든 오브젝트 footprint 를 막아, 통과 가능해야 할 장식물이 벽이 됐다.
    if (e.kind === "object" && e.blocks !== true) continue;
    for (const [gx, gy] of entityFootprintCells(e)) {
      if (inBounds(gx, gy)) blockedCells.add(`${gx},${gy}`);
    }
  }
  const acells: Cell[] = [];
  for (const key of blockedCells) {
    const [gx, gy] = parseCellKey(key);
    acells.push([gx + aox, gy + aoy, 0]);
  }
  acells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const apalette = ab.palette.length ? ab.palette : acells.length ? ["pid:blocked"] : [];
  const asize: [number, number] =
    ab.size && ab.size[0] > 0 ? ab.size : acells.length ? args.size : [0, 0];
  const attribute: Layer = {
    size: asize,
    origin: [aox, aoy],
    paletteCount: apalette.length,
    palette: apalette,
    cellCount: acells.length,
    cells: acells,
  };

  // 엔티티 — 0-based → 절대좌표(ground origin). 경계 밖은 무시.
  const entities: MapEntity[] = args.entities
    .filter((e) => inBounds(e.gx, e.gy))
    .map((e) => ({ ...e, gx: e.gx + ox, gy: e.gy + oy }));

  return {
    map: args.mapName,
    layers: {
      GroundTileMap: ground,
      StaticTileMap: args.staticLayer,
      TileAttributeTileMap: attribute,
    },
    entities,
  };
}

/** 브라우저 다운로드. */
export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
