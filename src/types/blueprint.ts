// blueprint JSON 스키마 — 엔진/빌드 파이프라인이 소비하는 export 포맷.
// 실측: asset/map/map_blueprint_Map000000.json (어둠의전설 추출 포맷).
// 각 레이어 cells 는 origin 오프셋이 적용된 **절대좌표** [gx,gy,paletteIdx].
export type Cell = [gx: number, gy: number, paletteIdx: number];

export interface Layer {
  size: [number, number]; // [W, H]
  origin: [number, number]; // 셀 좌표 원점
  paletteCount: number;
  palette: string[]; // 타일 이름 (idx = 배열 위치)
  cellCount: number;
  cells: Cell[]; // sparse, 절대좌표
}

export interface Blueprint {
  map: string;
  layers: {
    GroundTileMap: Layer;
    StaticTileMap: Layer;
    TileAttributeTileMap: Layer;
  };
}

export const emptyLayer = (): Layer => ({
  size: [0, 0],
  origin: [0, 0],
  paletteCount: 0,
  palette: [],
  cellCount: 0,
  cells: [],
});
