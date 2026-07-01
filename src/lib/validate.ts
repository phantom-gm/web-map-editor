// 맵 검증 — export 전에 사용자에게 알릴 문제를 모은다. 순수 함수(렌더/스토어 비의존).
import { parseCellKey, type CellKey } from "./cell";
import { FACINGS, type Facing, type MapEntity } from "../types/entity";

export interface MapValidation {
  errors: string[]; // 좌표/팔레트가 어긋날 수 있는 문제 — export 전에 확인 권장
  warnings: string[]; // 치명적이진 않지만 알릴 사항
}

/**
 * 엔티티 검증 — 게임 변환기(convert_map.cjs)의 fail-closed 규칙과 1:1.
 * "미완성 N건" = 변환기 "미해결 N건" 이 되도록 맞춘다.
 * @param npcClassIds NpcClass 카탈로그 id 집합(있으면 존재여부까지 검사).
 */
export function entityIssues(
  entities: MapEntity[],
  size: [number, number],
  npcClassIds?: Set<number>,
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
  npcClassIds?: Set<number>;
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
    errors.push(...entityIssues(args.entities, size, args.npcClassIds));
  }

  return { errors, warnings };
}
