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
  respawnSec?: number; // monster: 리젠 간격(초)
  dialogId?: string; // npc: 대사/스크립트 id

  // 스프라이트(object/monster/npc) 점유 타일 footprint — tilesW × tilesH 셀.
  // 베이스 셀(gx,gy)이 뒤(상단) 코너, +gx/+gy 로 확장. 스프라이트는 이 영역을 덮도록 스케일되어
  // 전면 바닥에 앵커된다. footprint 셀은 점유(이동불가) 표시. 배치 시 W=이미지폭/타일폭, H=1.
  tilesW?: number;
  tilesH?: number;
  flipX?: boolean; // 스프라이트 좌우반전
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
  return out;
}

/** 변환기가 fail-closed 시킬 미입력 엔티티인지(배지/경고용, 카탈로그 존재여부는 별도). */
export function isEntityIncomplete(e: MapEntity): boolean {
  switch (e.kind) {
    case "portal":
      return !e.destMap || !e.destCell || !e.destFacing;
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

/** 엔티티 footprint 크기 [W,H] (타일 단위, 최소 1). 미설정이면 [1,1]. */
export function footprintWH(e: MapEntity): [number, number] {
  return [Math.max(1, e.tilesW ?? 1), Math.max(1, e.tilesH ?? 1)];
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
