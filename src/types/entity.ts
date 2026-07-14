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

  // 오목(ㄴ/ㄷ/T자) footprint — 직사각 run 들의 합집합. 앵커(gx,gy) 상대 오프셋 [dx,dy,w,h][].
  //   미설정 = [[0,0,tilesW,tilesH]] (단일 직사각, 기존 동작). 여관 포치처럼 가운데-아래가 파인
  //   건물은 직사각 하나로 표현하면 개구부에 선 플레이어의 앞뒤를 옳게 판정할 수 없다.
  //   깊이 판정(playerBehind)은 run 별 반평면 판정의 OR — 어느 한 팔이라도 뒤면 통짜 전체가 위.
  //   ⚠ tilesW/tilesH 는 항상 run 들의 **바운딩 박스**로 동기 유지(setFootprintRects 가 강제).
  //     게이트·z정렬 앞줄·복사 간격 등 바운딩 박스만 필요한 소비자가 그대로 쓰기 위함.
  //   Spec: legend_of_light/docs/map/depth/아이소메트릭_깊이정렬_런분해_설계.md
  footprintRects?: Array<[number, number, number, number]>;

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
  // 오목 run 이 있으면 tilesW/H 를 **항상 바운딩 박스로 재파생**한다. 저장 파일의 값을 믿지 않는다.
  //   footprintWH 는 run 우선이라 에디터 화면은 늘 맞게 보이지만, export 는 저장된 tilesW/H 를
  //   그대로 내보내므로(스프레드) 파일이 어긋나 있으면 게임만 조용히 틀어진다.
  //   loadProject / importBlueprint 가 둘 다 여기를 통과 → 재파생 지점은 이 한 곳이면 충분.
  if (validRects(out)) {
    const [w, h] = footprintWH(out);
    out.tilesW = w;
    out.tilesH = h;
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

/**
 * 유효한 run 목록. 없으면 null → 단일 직사각 경로.
 * ⚠ 규칙은 여기 한 곳 — 오프셋(dx,dy) ≥ 0, 크기(w,h) ≥ 1.
 *   dx<0 을 허용하면 앵커가 바운딩 박스의 뒤-위 코너가 아니게 되고, footprintWH 는 max 만 보므로
 *   바운딩 박스가 실제 점유보다 **작아진다**(게이트·z정렬이 조용히 어긋남).
 *   convert_map.normRects 가 같은 규칙을 강제한다(파이프라인 양끝 일치).
 */
export function validRects(e: MapEntity): Array<[number, number, number, number]> | null {
  const rs = e.footprintRects;
  if (!Array.isArray(rs) || rs.length === 0) return null;
  const ok = rs.filter(
    (r) => Array.isArray(r) && r.length === 4 && r[0] >= 0 && r[1] >= 0 && r[2] >= 1 && r[3] >= 1,
  );
  return ok.length ? ok : null;
}

/**
 * 점유 run 들 — 앵커 절대 셀 좌표 [{gx,gy,ax,ay}]. footprintRects 미설정이면 단일 직사각 1개.
 * 깊이 판정(playerBehind)·점유 셀·바운딩 박스의 단일 원천.
 */
export function footprintRuns(e: MapEntity): Array<{ gx: number; gy: number; ax: number; ay: number }> {
  const rs = validRects(e);
  if (!rs) {
    const w = Math.max(1, e.tilesW ?? 1);
    const h = Math.max(1, e.tilesH ?? 1);
    return [{ gx: e.gx, gy: e.gy, ax: e.gx + w - 1, ay: e.gy + h - 1 }];
  }
  return rs.map(([dx, dy, w, h]) => ({
    gx: e.gx + dx,
    gy: e.gy + dy,
    ax: e.gx + dx + Math.max(1, w) - 1,
    ay: e.gy + dy + Math.max(1, h) - 1,
  }));
}

/**
 * 엔티티 점유(충돌) footprint 크기 [W,H] (타일 단위, 최소 1). 미설정이면 [1,1].
 * ⚠ footprintRects 가 있으면 run 들의 **바운딩 박스** — 게이트·z정렬 앞줄·복사 간격 등
 *   "대략의 크기"만 필요한 소비자가 오목 모양을 몰라도 되게 한다(오목은 판정 함수만 알면 됨).
 */
export function footprintWH(e: MapEntity): [number, number] {
  const rs = validRects(e);
  if (!rs) return [Math.max(1, e.tilesW ?? 1), Math.max(1, e.tilesH ?? 1)];
  let maxAx = -Infinity, maxAy = -Infinity;
  for (const [dx, dy, w, h] of rs) {
    if (dx + Math.max(1, w) - 1 > maxAx) maxAx = dx + Math.max(1, w) - 1;
    if (dy + Math.max(1, h) - 1 > maxAy) maxAy = dy + Math.max(1, h) - 1;
  }
  // run 오프셋(dx,dy)은 0 이상이 규약 — 앵커가 바운딩 박스의 뒤-위 코너다.
  return [Math.max(1, maxAx + 1), Math.max(1, maxAy + 1)];
}

/**
 * 깊이 판정 — 플레이어(px,py)가 이 오브젝트보다 **뒤**인가(= 오브젝트가 플레이어를 덮는가).
 * 게임 런타임(IsoObjectDepthLogic.Apply)의 캐논 규칙 미러. 순서가 중요하다:
 *   1) inside(어느 run 위) → front (통과 가능 장식물 위에 선 플레이어를 보여준다)
 *   2) 그 외, 어느 run 하나라도 반평면 뒤(px ≤ ax AND py ≤ ay) → behind
 * ⚠ run 결합은 **OR**다(AND 아님). 스프라이트는 draw 1번이라 어느 한 팔이라도 가려야 하면
 *   통짜 전체가 위여야 한다. 8×8 ㄴ자 검증: OR 오판 0 / AND 오판 8 (런분해 설계 §1).
 */
export function playerBehind(e: MapEntity, px: number, py: number): boolean {
  const runs = footprintRuns(e);
  for (const r of runs) {
    if (px >= r.gx && px <= r.ax && py >= r.gy && py <= r.ay) return false; // inside → front
  }
  for (const r of runs) {
    if (px <= r.ax && py <= r.ay) return true; // 어느 run 하나라도 뒤 → 오브젝트가 위
  }
  return false;
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
 * 엔티티가 점유하는 footprint 셀들(0-based). 포탈은 footprint 없음 → 빈 배열.
 * footprintRects 가 있으면 run 들의 **합집합**(중복 셀 dedup) — 오목 모양의 구멍은 점유되지 않는다.
 * 충돌(DT_Walk)·점유 오버레이·"충돌 범위 < 스프라이트" 경고가 전부 이 함수를 쓰므로 자동으로 따라온다.
 */
export function entityFootprintCells(e: MapEntity): Array<[number, number]> {
  if (e.kind === "portal") return [];
  const runs = footprintRuns(e);
  const out: Array<[number, number]> = [];
  // 단일 run(오늘의 거의 모든 오브젝트)은 자기끼리 겹칠 수 없다 → dedup Set 을 만들지 않는다.
  //   이 함수는 캔버스 draw 에서 엔티티마다 호출되고 draw 는 마우스 이동마다 돈다(hover 갱신).
  if (runs.length === 1) {
    const r = runs[0];
    for (let gy = r.gy; gy <= r.ay; gy++) {
      for (let gx = r.gx; gx <= r.ax; gx++) out.push([gx, gy]);
    }
    return out;
  }
  const seen = new Set<string>();
  for (const r of runs) {
    for (let gy = r.gy; gy <= r.ay; gy++) {
      for (let gx = r.gx; gx <= r.ax; gx++) {
        const k = `${gx},${gy}`;
        if (seen.has(k)) continue; // run 이 겹치는 코너 셀 — 한 번만
        seen.add(k);
        out.push([gx, gy]);
      }
    }
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
