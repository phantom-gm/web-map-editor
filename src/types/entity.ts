// 맵 위에 배치되는 엔티티(포탈/몬스터/NPC/오브젝트). 타일 그리드와 별개의 인스턴스 레이어.
// 좌표는 에디터 0-based 셀좌표(ground 와 동일). blueprint export 시 origin 이 더해진다.
export type EntityKind = "portal" | "monster" | "npc" | "object";

// 포탈 도착 후 바라볼 방향 (아이소 4방향).
export type Facing = "SE" | "SW" | "NE" | "NW";
export const FACINGS: Facing[] = ["SE", "SW", "NE", "NW"];
export const FACING_LABEL: Record<Facing, string> = {
  SE: "SE ↘ 남동",
  SW: "SW ↙ 남서",
  NE: "NE ↗ 북동",
  NW: "NW ↖ 북서",
};

export interface MapEntity {
  id: string;
  kind: EntityKind;
  gx: number;
  gy: number;
  name?: string; // 라벨 / 에셋 이름
  ruid?: string; // 에셋 RUID(monster/npc/object 스프라이트)

  // 포탈 목적지 — 변환기(convert_map.cjs) 계약 필드명(캐논).
  destMap?: string; // 연결 맵 이름
  destCell?: [number, number]; // 도착 셀 [x, y]
  destFacing?: Facing; // 도착 후 방향

  // monster/npc — DT_NpcClass 의 NpcClassID (예: 1002). 변환기 필수.
  npcClassId?: number;

  // 종류별 선택 필드(프로덕션). 미입력이면 게임 기본값.
  spawnCount?: number; // monster: 동시 스폰 수
  spread?: number; // monster: 스폰 분산 반경(셀). 0=앵커에 모여서 스폰. (convert_map 계약 필드)
  respawnSec?: number; // monster: 리젠 간격(초)
  dialogId?: string; // npc: 대사/스크립트 id

  // 스프라이트(object/monster/npc) 점유 타일 footprint — tilesW × tilesH 셀.
  // 베이스 셀(gx,gy)이 뒤(상단) 코너, +gx/+gy 로 확장. 스프라이트는 이 영역을 덮도록 스케일되어
  // 전면 바닥에 앵커된다. footprint 셀은 점유(이동불가) 표시. 배치 시 W=이미지폭/타일폭, H=1.
  tilesW?: number;
  tilesH?: number;
  flipX?: boolean; // 스프라이트 좌우반전

  // object 이미지 렌더 기준 footprint(배율 1.0 크기). 배치 시 자동맞춤으로 고정 →
  // 이후 tilesW/tilesH(점유/충돌)를 바꿔도 이미지 크기·위치는 그대로. 크기 조절은 scaleMul 로만.
  // (미설정 시 renderWH 가 tilesW/tilesH 로 폴백 → 레거시/몬스터·NPC 는 기존 동작 유지.)
  baseW?: number;
  baseH?: number;

  // 플레이어 대비 렌더 레이어(정렬 밴드). "below"=플레이어가 위(기본), "above"=오브젝트가 플레이어를 덮음,
  //   "auto"=방식 B(동적 교차) 예약(현재는 below 로 취급). 미설정=below.
  layer?: "above" | "below" | "auto";

  // object 전용 게임 계약 필드 — export 시 채워진다(라이브 저장은 blocks 만).
  blocks?: boolean; // 이동 차단. 오브젝트는 기본 차단(관통 금지) — 명시적 false 만 통과 허용.
  footprintCells?: [number, number][]; // 앵커(gx,gy) 상대 오프셋 목록. export 계산값(차단 시, 포탈 셀 제외).
  scale?: number | [number, number]; // 스프라이트 배율. export 계산값(게임 네이티브 거대화 방지).
  offset?: [number, number]; // 스프라이트 위치 오프셋(world). export 계산값(offsetX/Y px → world).
  rotation?: number; // 기울기(회전, 도). export 계산값(= rotationDeg).

  // object 미세조정(에디터 입력, WYSIWYG). export 에서 scale/offset/rotation 으로 변환.
  scaleMul?: number; // 사이즈 배율(footprint 자동스케일에 곱함). 기본 1.
  offsetX?: number; // 화면 X 이동(px, 오른쪽+). 기본 0.
  offsetY?: number; // 화면 Y 이동(px, 아래+). 기본 0.
  rotationDeg?: number; // 기울기(회전, 도). 기본 0.
}

// 레거시 project.json 하위호환: 과거 필드(targetMap/targetX/targetY) → 캐논(destMap/destCell).
type LegacyEntity = MapEntity & { targetMap?: string; targetX?: number; targetY?: number };
export function migrateEntity(raw: MapEntity): MapEntity {
  const e = raw as LegacyEntity;
  const out: MapEntity = { ...raw };
  if (out.destMap === undefined && e.targetMap !== undefined) out.destMap = e.targetMap;
  if (out.destCell === undefined && (e.targetX !== undefined || e.targetY !== undefined)) {
    out.destCell = [e.targetX ?? 0, e.targetY ?? 0];
  }
  delete (out as LegacyEntity).targetMap;
  delete (out as LegacyEntity).targetX;
  delete (out as LegacyEntity).targetY;
  // object 이미지 크기 분리(신규): 기존 저장 파일은 baseW 미보유 → 현재 tilesW/tilesH 로 1회 고정해
  // 기존 렌더를 그대로 보존하면서, 이후 W×H(점유) 변경이 이미지에 영향을 주지 않게 한다.
  if (out.kind === "object" && out.baseW === undefined) {
    out.baseW = Math.max(1, out.tilesW ?? 1);
    out.baseH = Math.max(1, out.tilesH ?? 1);
  }
  return out;
}

/** 변환기가 fail-closed 시킬 미입력 엔티티인지(배지/경고용, 카탈로그 존재여부는 별도). */
export function isEntityIncomplete(e: MapEntity): boolean {
  switch (e.kind) {
    case "portal":
      // destFacing 은 선택(미지정 → 게임 기본 SE). 필수는 목적지 맵+셀뿐.
      return !e.destMap || !e.destCell;
    case "monster":
    case "npc":
      return e.npcClassId == null;
    case "object":
      return !e.ruid;
    default:
      return false;
  }
}

export interface EntityKindMeta {
  label: string;
  color: string;
  marker: string; // 에셋 이미지 없을 때 표시할 글자
}

export const ENTITY_KINDS: EntityKind[] = ["portal", "monster", "npc", "object"];

export const ENTITY_META: Record<EntityKind, EntityKindMeta> = {
  portal: { label: "포탈", color: "#b06ff0", marker: "P" },
  monster: { label: "몬스터", color: "#e0604f", marker: "M" },
  npc: { label: "NPC", color: "#5fcf86", marker: "N" },
  object: { label: "오브젝트", color: "#e8b54a", marker: "O" },
};

export const isEntityKind = (s: string): s is EntityKind =>
  s === "portal" || s === "monster" || s === "npc" || s === "object";

/** 엔티티 점유(충돌) footprint 크기 [W,H] (타일 단위, 최소 1). 미설정이면 [1,1]. */
export function footprintWH(e: MapEntity): [number, number] {
  return [Math.max(1, e.tilesW ?? 1), Math.max(1, e.tilesH ?? 1)];
}

/**
 * 이미지 렌더 기준 footprint [W,H] — 스프라이트 크기·앵커 계산에만 사용(점유 footprintWH 와 분리).
 * baseW/baseH(배치 시 고정) 우선, 없으면 tilesW/tilesH 로 폴백(레거시·몬스터·NPC 는 기존과 동일).
 */
export function renderWH(e: MapEntity): [number, number] {
  return [Math.max(1, e.baseW ?? e.tilesW ?? 1), Math.max(1, e.baseH ?? e.tilesH ?? 1)];
}

/** 엔티티가 점유하는 footprint 셀들(0-based). 포탈은 footprint 없음 → 빈 배열. */
export function entityFootprintCells(e: MapEntity): Array<[number, number]> {
  if (e.kind === "portal") return [];
  const [w, h] = footprintWH(e);
  const out: Array<[number, number]> = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) out.push([e.gx + i, e.gy + j]);
  }
  return out;
}

let _seq = 0;
/** 인스턴스 고유 id. crypto.randomUUID 우선, 없으면 카운터+시각. */
export function newEntityId(): string {
  const c = typeof crypto !== "undefined" ? (crypto as Crypto & { randomUUID?: () => string }) : undefined;
  if (c?.randomUUID) return c.randomUUID();
  _seq += 1;
  return `e${_seq}_${Date.now().toString(36)}`;
}
