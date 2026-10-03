import type { RuntimeProjectFields } from "./gameRuntime";
// 에디터 프로젝트 파일(.json) — 맵 + 팔레트(참조·카테고리·RUID)까지 한 파일에.
// 게임용 blueprint(Export)와 별개. 다시 열면 작업 상태가 그대로 복원된다(다른 PC 포함).
//
// ⚠ 이미지 바이트는 담지 않는다. 팔레트 항목은 **RUID 참조 + px(치수)** 만 갖고, 이미지는
//   에디터가 RUID 로 스토리지에서 받아 IndexedDB 에 캐시한다(imageResolver).
//   버전 이력:
//     v1 — palette[].url 에 base64 PNG 인라인. ferendel.json 이 78.6MB(97%가 base64)까지 커져
//          GitHub 100MB 한도에 근접하고 git pack 이 720MB 로 불어났다.
//     v2 — 참조만. 같은 맵이 약 0.3MB. 상세·마이그레이션: legend_of_light
//          docs/map/MAP_PROJECT_ASSET_REFERENCE_PLAN.md
//   v1 파일은 계속 **열 수 있고**(인라인 base64 를 읽어 캐시로 승격), 저장하면 v2 로 승격된다.
import type { GameNpcEdits, GameNpcSync } from "./gameNpc";
import type { GameObjectEdits } from "./gameObjects";
import type { Layer } from "../types/blueprint";
import type { MapEntity } from "../types/entity";
import type { StoredTile, StoredTileInput } from "./palette";

export const PROJECT_TYPE = "web-map-editor-project";
export const PROJECT_VERSION = 2;

/** 로컬 게임 스냅샷 참조. 게임 파일 자체나 절대 경로는 프로젝트에 담지 않는다. */
export interface GameSyncMetadata {
  version: 1;
  baselineId: string;
  mapName: string;
}

/** 잘못된 링크를 조용히 일반 프로젝트로 열면 원본 동기화 계약을 잃으므로 거부한다. */
export function parseGameSync(value: unknown, mapName?: string): GameSyncMetadata | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("게임 동기화 정보 형식이 올바르지 않습니다.");
  }
  const link = value as Partial<GameSyncMetadata>;
  if (link.version !== 1 || typeof link.baselineId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(link.baselineId) ||
    typeof link.mapName !== "string" || !link.mapName.trim()) {
    throw new Error("게임 동기화 정보의 버전·스냅샷 ID·맵 이름을 확인하세요.");
  }
  if (mapName !== undefined && link.mapName !== mapName) {
    throw new Error("프로젝트 맵 이름과 게임 동기화 맵 이름이 다릅니다.");
  }
  return { version: 1, baselineId: link.baselineId, mapName: link.mapName };
}

export interface ProjectFile extends RuntimeProjectFields {
  type: typeof PROJECT_TYPE;
  version: number; // 쓰기는 항상 PROJECT_VERSION(2). 읽기는 1도 허용.
  map: string;
  gameSync?: GameSyncMetadata;
  gameObjectEdits?: GameObjectEdits;
  gameNpcEdits?: GameNpcEdits;
  gameNpcSync?: GameNpcSync;
  size: [number, number];
  groundOrigin: [number, number];
  ground: Array<[number, number, number]>; // [gx, gy, paletteIdx]
  blocked: Array<[number, number]>; // [gx, gy]
  palette: StoredTile[];
  staticLayer: Layer;
  attributeBase: Layer;
  entities: MapEntity[]; // 0-based 셀좌표(에디터 네이티브)
}

/** 읽기용 — v1 팔레트 항목의 url(base64)까지 받아들인다. */
export interface ProjectFileInput extends Omit<ProjectFile, "palette"> {
  palette: StoredTileInput[];
}

export function isProjectFile(o: unknown): o is ProjectFileInput {
  return !!o && typeof o === "object" && (o as { type?: unknown }).type === PROJECT_TYPE;
}
