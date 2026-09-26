// 맵 검증 — export 전에 사용자에게 알릴 문제를 모은다. 순수 함수(렌더/스토어 비의존).
import { parseCellKey, type CellKey } from "./cell";
import { FACINGS, footprintWH, renderWH, type Facing, type MapEntity } from "../types/entity";
import { southIssues, southMessage } from "./southIntrusion";

export interface MapValidation {
  errors: string[]; // 좌표/팔레트가 어긋날 수 있는 문제 — export 전에 확인 권장
  warnings: string[]; // 치명적이진 않지만 알릴 사항
}

/**
 * 엔티티 검증 — 게임 변환기(convert_map.cjs)의 fail-closed 규칙과 1:1.
 * "미완성 N건" = 변환기 "미해결 N건" 이 되도록 맞춘다.
 * @param npcClassIds NpcClass 카탈로그 멤버십(있으면 존재여부까지 검사). Set/Map(byId) 둘 다 허용.
 * @param hasImage object 팔레트 이미지 해석 가능 여부(있으면 검사). 미해석이면 export 가 scale 을
 *   조용히 누락 → 게임에서 네이티브 크기(화면 뒤덮는 거대 스프라이트)로 배치되므로 사전 경고(D7).
 */
export function entityIssues(
  entities: MapEntity[],
  size: [number, number],
  npcClassIds?: { has(id: number): boolean },
  hasImage?: (e: MapEntity) => boolean,
): string[] {
  const [W, H] = size;
  const facingSet = new Set<Facing>(FACINGS);
  const out: string[] = [];
  for (const e of entities) {
    const at = `${e.kind}(${e.gx},${e.gy})`;
    if (e.gx < 0 || e.gy < 0 || e.gx >= W || e.gy >= H) out.push(`${at}: 맵(${W}×${H}) 경계 밖`);
    if (e.kind === "portal") {
      if (!e.destMap) out.push(`${at}: 목적지 맵(destMap) 없음`);
      if (!e.destCell || e.destCell.length !== 2) out.push(`${at}: 도착 셀(destCell) 없음`);
      // destFacing 은 선택(미지정 → 게임 기본 SE). 값이 있을 때만 형식 검사.
      if (e.destFacing && !facingSet.has(e.destFacing)) out.push(`${at}: 도착 방향(destFacing) 형식 오류`);
    } else if (e.kind === "monster" || e.kind === "npc") {
      if (e.npcClassId == null) out.push(`${at}: NpcClassID 없음`);
      else if (npcClassIds && !npcClassIds.has(e.npcClassId)) out.push(`${at}: NpcClassID ${e.npcClassId} — 카탈로그에 없음`);
    } else if (e.kind === "object") {
      if (!e.ruid) out.push(`${at}: RUID 없음 (팔레트에서 등록된 스프라이트로 배치)`);
      else if (hasImage && !hasImage(e)) {
        out.push(`${at}: 팔레트 이미지 미해석 — scale 계산 불가(게임에서 네이티브 크기로 거대 배치됨). 같은 RUID/이름 타일을 팔레트에 복원하세요`);
      }
    }
  }
  return out;
}

/** 경계 밖 셀·팔레트 범위 초과·빈 맵 등을 점검. errors 가 있으면 export 시 확인 다이얼로그. */
export function validateMap(args: {
  size: [number, number];
  ground: Map<CellKey, number>;
  blocked: Set<CellKey>;
  paletteCount: number;
  entities?: MapEntity[];
  npcClassIds?: { has(id: number): boolean };
  hasImage?: (e: MapEntity) => boolean;
}): MapValidation {
  const { size, ground, blocked, paletteCount } = args;
  const [W, H] = size;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (ground.size === 0) warnings.push("칠해진 Ground 셀이 없습니다 (빈 맵).");
  if (paletteCount === 0 && ground.size > 0) {
    errors.push("팔레트가 비어 있는데 칠해진 셀이 있습니다 — export 시 색 스와치로만 복원됩니다.");
  }

  let oob = 0;
  let badIdx = 0;
  for (const [k, idx] of ground) {
    const [gx, gy] = parseCellKey(k);
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) oob++;
    if (idx < 0 || idx >= paletteCount) badIdx++;
  }
  let blockedOob = 0;
  for (const k of blocked) {
    const [gx, gy] = parseCellKey(k);
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) blockedOob++;
  }

  if (oob > 0) {
    errors.push(`맵(${W}×${H}) 경계 밖 Ground 셀 ${oob}개 — export 에서 제외됩니다.`);
  }
  if (blockedOob > 0) {
    errors.push(`경계 밖 이동불가 셀 ${blockedOob}개 — export 에서 제외됩니다.`);
  }
  if (badIdx > 0) {
    errors.push(`팔레트(${paletteCount}개) 범위를 벗어난 타일 참조 ${badIdx}개.`);
  }

  if (args.entities && args.entities.length > 0) {
    errors.push(...entityIssues(args.entities, size, args.npcClassIds, args.hasImage));
    warnings.push(...entityWarnings(args.entities));
    const south = southValidation(args.entities, blocked);
    errors.push(...south.errors);
    warnings.push(...south.warnings);
  }

  return { errors, warnings };
}

/**
 * 1×1 지면 오브젝트의 정렬 바닥선이 남쪽 이웃 칸을 침범하는가(요청서 R1 · 게임 depth_check 검사 (10) 미러).
 *   block(바닥선이 이웃 중심 이하) = errors — 게임 빌드 게이트가 exit 1 로 막는 것(동결 목록 밖)이라 export 전에 "•" 로 보인다.
 *   watch(여유 2.5px 이하) = warnings — 게임은 관찰만, 에디터는 미리 알린다.
 * 둘 다 export 를 막지는 않는다(확인 다이얼로그) — 동결 목록(식생·물가·벽 모서리 30건)은 저작자 판단으로 그대로 둘 수 있어야 한다.
 */
export function southValidation(entities: MapEntity[], blocked: Set<CellKey>): MapValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const issues = southIssues(entities, blocked);
  for (const e of entities) {
    const r = issues.get(e.id);
    if (!r) continue;
    (r.level === "block" ? errors : warnings).push(southMessage(e, r));
  }
  return { errors, warnings };
}

/**
 * 치명적이지 않지만 알릴 엔티티 사항. errors 와 달리 export 를 막지 않는다.
 *
 * 점유(W×H) < 스프라이트 + 충돌 켬: 배치 기본 점유가 1×1 이라 큰 오브젝트에 충돌을 켜면 한 칸만
 *   막히기 쉽다. 단, 나무처럼 "캐노피는 넓고 밑동만 막는" 의도적 구성도 정상이므로 warning.
 *
 * ⚠ 실효 크기 = renderWH × scaleMul. 배율을 빼먹으면 안 된다 — 침엽수는 네이티브 baseW≈15.9 지만
 *   배율 0.23 이라 실효 3.7타일이다. 네이티브로 비교하면 "약 16×16" 으로 오독해 오탐이 된다.
 *
 * ⚠ **`blocks` 게이트를 풀지 말 것** — "깊이도 이 값을 쓰니 통과 가능한 것도 경고하자" 는 시도가
 *   있었는데 실측에서 170/292(58.2%)가 발동했다. 대부분 나무·바위였고, 그것들은 **1×1 이 정답**이다
 *   (캐노피는 넓어도 지면에 닿는 건 밑동 한 칸). 결정적으로 침엽수_B 실효 3.7타일 = 페른델민가_A
 *   실효 3.7타일 — **스프라이트 크기로는 "밑동 1칸 나무" 와 "4×4 베이스 집" 을 구분할 수 없다**
 *   (요청서 부록 B: 스프라이트에서 지면 footprint 추론 불가. 경고에도 그대로 적용된다).
 *   저작 누락은 자동 탐지 대상이 아니다 — 캔버스의 점유 rect 와 인스펙터로 사람이 저작한다.
 *   `blocks=true` 일 때만 경고하는 이유: 그때만 footprint 가 "무엇이 막히는가" 라는 명확한 뜻을 갖는다.
 */
export function entityWarnings(entities: MapEntity[]): string[] {
  const out: string[] = [];
  for (const e of entities) {
    if (e.kind !== "object" || e.blocks !== true) continue;
    const [fw, fh] = footprintWH(e);
    const [rw, rh] = renderWH(e);
    const mul = e.scaleMul && e.scaleMul > 0 ? e.scaleMul : 1;
    const sw = Math.max(1, Math.round(rw * mul));
    const sh = Math.max(1, Math.round(rh * mul));
    if (fw < sw || fh < sh) {
      out.push(
        `object(${e.gx},${e.gy}) "${e.name ?? ""}": 충돌 범위(${fw}×${fh})가 스프라이트(약 ${sw}×${sh}타일)보다 작습니다 — 그 칸만 막힙니다. 의도한 게 아니면 지면 점유(W×H)를 올리세요.`,
      );
    }
  }
  return out;
}
