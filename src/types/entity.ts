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
  // 베이스 셀(gx,gy)이 **앞-아래 tip**, −gx/−gy(북서, 화면 위)로 확장한다(entityFootprintCells).
  //   bottom-center pivot 스프라이트가 발에서 위로 서므로 점유도 위로 뻗어야 스프라이트를 덮는다.
  //   footprint 셀은 점유(이동불가) 표시. 배치 시 W=1, H=1(점유는 사람이 저작).
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

  // 겹침 우선순위 tiebreak. 게임 order = ENTITY_BASE + 앞줄×10 + sortOffset (build_map).
  //   같은 앞줄(gy+tilesH−1)에서 겹칠 때 값이 클수록 앞(위)에 그려짐. 기본 0. ±소수(같은 줄 tiebreak).
  //   |값|≥10 이면 한 줄 이상 넘어 다른 행 오브젝트와의 앞뒤도 뒤집음(주의).
  sortOffset?: number;

  // object 전용 게임 계약 필드 — export 시 채워진다(라이브 저장은 blocks 만).
  blocks?: boolean; // 이동 차단. 오브젝트는 기본 차단(관통 금지) — 명시적 false 만 통과 허용.
  footprintCells?: [number, number][]; // 앵커(gx,gy) 상대 오프셋 목록. export 계산값(차단 시, 포탈 셀 제외).
  scale?: number | [number, number]; // 스프라이트 배율. export 계산값(게임 네이티브 거대화 방지).
  // 게임 깊이(y-정렬)용 지면 점유 셀 수 — export 시 저작값 tilesW/tilesH 를 그대로 내보낸 것.
  //   ⚠ 스프라이트 파생 금지(예전 round(baseW) 는 정보량 0이라 게임 정렬을 깨뜨렸다).
  //   앵커 (gx,gy) = rect 뒤-위 코너. 계약: docs/map/depth/웹맵에디터_깊이footprint_export_요청.md
  depthW?: number;
  depthH?: number;
  // 스프라이트 렌더 크기(효과 타일 = renderWH × scaleMul) — 반투명 페이드의 (B) 겹침 rect 용. export 계산값.
  //   build_map 이 spriteH≥FADE_MIN_H 로 Fade 대상 판정 + BaseW/BaseH 메타로 굽는다.
  spriteW?: number;
  spriteH?: number;
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

/** 사람에게 보여 줄 엔티티 라벨 — 검증·경고 문구 공용. `object(5,1) "가로등_A"`, 이름이 없으면 종류와 좌표만. */
export function entityLabel(e: MapEntity): string {
  const at = `${e.kind}(${e.gx},${e.gy})`;
  return e.name ? `${at} "${e.name}"` : at;
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
  // ⚠ 1타일 미만(작은 스프라이트)도 허용 — object 는 배치 시 baseW = 네이티브폭/64 (실수) 로 잡는다.
  //    1 로 클램프하면 64px 미만 에셋이 강제로 커져 픽셀 1:1(PPU) 이 깨진다. 0/음수만 방어.
  const w = e.baseW ?? e.tilesW ?? 1;
  const h = e.baseH ?? e.tilesH ?? 1;
  return [w > 0 ? w : 1, h > 0 ? h : 1];
}

/**
 * 인스펙터 "스프라이트 크기로 점유 채우기" 의 제안값 — 보이는 크기(renderWH × 배율)를 정사각으로.
 *
 * ⚠ **제안값일 뿐이다.** export 에서 이걸로 depthW 를 파생하면 안 된다 — 스프라이트 크기로는
 *   "밑동 1칸 나무" 와 "4×4 베이스 집" 을 구분할 수 없다(둘 다 실효 3.7타일). 지면 점유는 사람이
 *   캔버스의 점유 rect 를 보며 저작해야 한다. 이 함수는 그 저작의 *출발점*을 한 번에 채워줄 뿐이다.
 */
export function suggestedFootprint(e: MapEntity): [number, number] {
  const [rw] = renderWH(e);
  const mul = e.scaleMul && e.scaleMul > 0 ? e.scaleMul : 1;
  const n = Math.max(1, Math.round(rw * mul));
  return [n, n];
}

// GAME iso 상수 — build_map.cjs(TILE_W/TILE_H) · IsoProjectLogic.mlua 와 반드시 일치.
//   여기 값이 게임과 어긋나면 점유 표시가 게임 정렬/충돌과 틀어진다.
export const GAME_TILE_HALF_W = 0.28; // = TILE_W(0.56) * 0.5
export const GAME_TILE_HALF_H = 0.14; // = TILE_H(0.28) * 0.5
export const PX_TO_WORLD = 0.56 / 64; // 에디터 px → 게임 world (= 0.00875). entityExport 의 값과 동일.

/**
 * offset(px) 을 게임 셀 shift [dcx, dcy] (round 전 실수) 로 환산. build_map 의 offCx/offCy 와 동일 수식.
 *   ox,oy = offset(world). export 규약대로 offsetY 는 부호 반전(화면 아래+ → world 위+).
 */
export function offsetCellShift(e: MapEntity): [number, number] {
  const ox = (e.offsetX ?? 0) * PX_TO_WORLD;
  const oy = -(e.offsetY ?? 0) * PX_TO_WORLD;
  const dcx = (ox / GAME_TILE_HALF_W - oy / GAME_TILE_HALF_H) / 2;
  const dcy = (-oy / GAME_TILE_HALF_H - ox / GAME_TILE_HALF_W) / 2;
  return [dcx, dcy];
}

/** 엔티티가 점유하는 footprint 셀들(0-based). 포탈은 footprint 없음 → 빈 배열. */
export function entityFootprintCells(e: MapEntity): Array<[number, number]> {
  if (e.kind === "portal") return [];
  const [w, h] = footprintWH(e);
  // 앵커(gx,gy) + offset 을 **게임과 동일하게 정렬**한다 → 스프라이트 발셀 (ax,ay) = 앞-아래 tip,
  //   거기서 −방향(북서)으로 w×h 뻗는다. build_map 의 offset-정렬(ax=round(gx+offCx), depthGx=ax−(w−1))
  //   과 셀이 정확히 일치 → **에디터 점유 표시 = 게임 on-top(정렬) 영역 = 충돌 영역**. WYSIWYG.
  //   offset 이 0이면 (ax,ay)=(gx,gy) → 예전 순수 −방향과 동일(하위호환).
  //   ⚠ 예전엔 여기서 offset 을 무시했다. 그래서 offset 큰 오브젝트(다리 offset −0.63 등)의 점유가
  //     게임 footprint 와 (−1,+1) 어긋나, 에디터에서 "위"로 저작한 셀이 게임에선 위로 안 올라오고
  //     정작 게임이 올려주는 셀은 에디터에 안 보였다(사용자 신고: 다리_B 정렬·on-top 붕괴).
  const [dcx, dcy] = offsetCellShift(e);
  const ax = Math.round(e.gx + dcx);
  const ay = Math.round(e.gy + dcy);
  return footprintFromAnchor(ax, ay, w, h);
}

/** 앵커(ax,ay)에서 −방향(북서)으로 w×h 셀. entityFootprintCells / entityDisplayFootprintCells 공유. */
function footprintFromAnchor(ax: number, ay: number, w: number, h: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) out.push([ax - i, ay - j]);
  }
  return out;
}

/**
 * **에디터 캔버스 표시 전용** 점유 셀 — offset 을 무시하고 앵커(gx,gy)에 고정한다.
 *   `entityFootprintCells`(export/게임/충돌/sortOffset)와 달리 offset 이동 시 점유 다이아몬드가
 *   따라 움직이지 않는다 → "X/Y 이동(offset)"은 스프라이트 이미지만 미세 조정하고, 지면 점유는
 *   사용자가 gx/gy·tilesW/H 로 저작한 그대로 유지된다. 근거: OBJECT_PIVOT_ALIGNMENT.md §"점유 = 앵커 기준,
 *   변화 없음", 그리고 offset 을 이미지 넛지로 다루는 인스펙터 라벨("X 이동(px)").
 *
 *   ⚠ 트레이드오프: offset≠0 인 오브젝트(다리 등)는 게임 build_map 이 footprint 를 offset 만큼
 *     밀어 굽으므로, **에디터 점유 표시(이 함수)와 게임 실제 footprint(entityFootprintCells)가
 *     최대 (−1,+1) 셀 어긋나 보일 수 있다**. export 는 여전히 offset-정렬이라 게임 동작은 정확하다.
 *     둘을 완전히 일치시키려면 게임 파이프라인이 footprint 를 앵커(gx,gy)에 고정해야 한다(별도 결정).
 */
export function entityDisplayFootprintCells(e: MapEntity): Array<[number, number]> {
  if (e.kind === "portal") return [];
  const [w, h] = footprintWH(e);
  return footprintFromAnchor(e.gx, e.gy, w, h);
}

let _seq = 0;
/** 인스턴스 고유 id. crypto.randomUUID 우선, 없으면 카운터+시각. */
export function newEntityId(): string {
  const c = typeof crypto !== "undefined" ? (crypto as Crypto & { randomUUID?: () => string }) : undefined;
  if (c?.randomUUID) return c.randomUUID();
  _seq += 1;
  return `e${_seq}_${Date.now().toString(36)}`;
}
