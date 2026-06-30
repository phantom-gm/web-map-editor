// 에디터 프로젝트 파일(.json) — 맵 + 팔레트(이미지·카테고리·RUID)까지 한 파일에.
// 게임용 blueprint(Export)와 별개. 다시 열면 작업 상태가 그대로 복원된다(다른 PC 포함).
import type { Layer } from "../types/blueprint";
import type { MapEntity } from "../types/entity";
import type { StoredTile } from "./palette";

export const PROJECT_TYPE = "web-map-editor-project";

export interface ProjectFile {
  type: typeof PROJECT_TYPE;
  version: 1;
  map: string;
  size: [number, number];
  groundOrigin: [number, number];
  ground: Array<[number, number, number]>; // [gx, gy, paletteIdx]
  blocked: Array<[number, number]>; // [gx, gy]
  palette: StoredTile[];
  staticLayer: Layer;
  attributeBase: Layer;
  entities: MapEntity[]; // 0-based 셀좌표(에디터 네이티브)
}

export function isProjectFile(o: unknown): o is ProjectFile {
  return !!o && typeof o === "object" && (o as { type?: unknown }).type === PROJECT_TYPE;
}
