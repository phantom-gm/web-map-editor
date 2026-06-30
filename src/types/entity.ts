// 맵 위에 배치되는 엔티티(포탈/몬스터/NPC/오브젝트). 타일 그리드와 별개의 인스턴스 레이어.
// 좌표는 에디터 0-based 셀좌표(ground 와 동일). blueprint export 시 origin 이 더해진다.
export type EntityKind = "portal" | "monster" | "npc" | "object";

export interface MapEntity {
  id: string;
  kind: EntityKind;
  gx: number;
  gy: number;
  name?: string; // 라벨 / 에셋 이름
  ruid?: string; // 에셋 RUID(monster/npc/object 스프라이트)

  // 종류별 선택 필드(프로덕션). 미입력이면 게임 기본값.
  targetMap?: string; // portal: 연결 맵
  targetX?: number; // portal: 도착 X
  targetY?: number; // portal: 도착 Y
  spawnCount?: number; // monster: 동시 스폰 수
  respawnSec?: number; // monster: 리젠 간격(초)
  dialogId?: string; // npc: 대사/스크립트 id
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

let _seq = 0;
/** 인스턴스 고유 id. crypto.randomUUID 우선, 없으면 카운터+시각. */
export function newEntityId(): string {
  const c = typeof crypto !== "undefined" ? (crypto as Crypto & { randomUUID?: () => string }) : undefined;
  if (c?.randomUUID) return c.randomUUID();
  _seq += 1;
  return `e${_seq}_${Date.now().toString(36)}`;
}
