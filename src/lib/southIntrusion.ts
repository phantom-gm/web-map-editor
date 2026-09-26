// 1×1 지면 오브젝트의 **정렬 바닥선**이 남쪽 이웃 칸 중심을 넘는가 — 게임 `depth_check.cjs` 검사 (10)(MS-26) 의 에디터 미러.
//   요청서: legend_of_light/docs/map/depth/260926_웹맵에디터_1x1_오브젝트_offset_요청.md §4 R1
//
// 배경: 게임은 오브젝트 하나에 정렬키 z 하나를 주고, 그 z 는 **스프라이트가 그려지는 바닥 y**(셀 중심 − offsetY)다.
//   액터(몬스터·NPC·원격 플레이어)의 z 는 발 y. 1×1 오브젝트는 런타임 보정이 없어 바닥선이 곧 화면 순서라,
//   offsetY 가 커서 바닥선이 **남쪽 이웃 칸(gx+1 또는 gy+1)** 의 중심 아래로 내려가면 그 칸에 선 액터가 오브젝트 뒤로 간다.
//   페른델 가로등 12개(offsetY 17px)가 그랬다(2026-09-26 신고).
//
// 단위: 전부 **에디터 px**(TW 64 / TH 32). 게임 world 로는 1px = TILE_W/64 = 0.04u, 셀 한 칸 깊이(TH/2 = 16px) = 0.64u.
//   게임 상수 SOUTH_CLEARANCE(0.02u)·SOUTH_WATCH(0.1u)를 같은 환산으로 px 에 옮겼다 — 판정은 px 끼리라 환산 오차가 없다.
//
// ⚠ 판정을 셀 기준으로 바꾸지 말 것 — 게임이 셀 중심·발자국 tip 앵커를 각각 시도했다가 신고 3건으로 폐기했다(요청서 §4 "바꾸지 말아야 할 것").
//   처방은 저작(offsetY 를 자기 칸 안으로)이고, 이 모듈은 그 저작을 **빌드 전에** 알려 주는 자리다.
import { TH } from "./grid";
import { cellKey, type CellKey } from "./cell";
import { walkBlockedCells } from "./walkCells";
import { entityLabel, footprintWH, type MapEntity } from "../types/entity";

/** 셀 중심에서 남쪽 이웃 칸 중심까지의 화면 y 거리(px) = 셀 한 칸 깊이. */
export const SOUTH_CELL_PX = TH / 2; // 16
/** 게임 SOUTH_CLEARANCE 0.02u ÷ 0.04u/px — 바닥선이 이웃 중심에 이만큼 이하로 붙으면(동률 포함) 빌드 게이트가 **차단**(exit 1). */
export const SOUTH_CLEARANCE_PX = 0.5;
/** 게임 SOUTH_WATCH 0.1u ÷ 0.04u/px — 이만큼 이하면 게임은 관찰만 하고, 에디터는 **경고**한다(빌드에서 막히기 전에). */
export const SOUTH_WATCH_PX = 2.5;
/** 경고 없이 쓸 수 있는 offsetY 상한(px) = 16 − 2.5 → 13. 요청서 §1 표의 "≤ 13px 통과". */
export const SAFE_OFFSET_Y_PX = Math.floor(SOUTH_CELL_PX - SOUTH_WATCH_PX);
/** 권장값(px) — 기단·밑동이 자기 칸 남쪽 절반에 앉는다(요청서 §1, Maker 실측 2026-09-26). */
export const RECOMMENDED_OFFSET_Y_PX = 11;

export type SouthLevel = "watch" | "block";

export interface SouthIntrusion {
  level: SouthLevel;
  /** 바닥선 − 남쪽 이웃 칸 중심(px). 양수면 이웃 칸 액터가 앞이고 그 값이 여유. 0 이하면 액터가 뒤. */
  clearancePx: number;
  /** 판정에 쓰인(설 수 있는 이웃 중 여유가 가장 작은) 남쪽 이웃 칸. 둘 다 같은 y 라 실질적으로 첫 후보. */
  neighbor: [number, number];
  offsetY: number;
}

/** 액터가 설 수 없는 칸 — 게임 DT_Walk 의 미러(이동불가 칠 + 충돌 오브젝트 footprint, 포탈 칸 제외). */
export interface StandCtx {
  cannotStand: Set<CellKey>;
}

/**
 * "설 수 없는 칸" 집합 — export 가 DT_Walk 로 굽는 것과 **같은 함수**(walkCells.walkBlockedCells)에서 나온다.
 *   여기서 따로 계산하지 않는다 — 규칙이 갈리면 "에디터 통과 · 빌드 실패" 가 조용히 생긴다.
 */
export function buildStandCtx(entities: MapEntity[], blocked: ReadonlySet<CellKey>): StandCtx {
  return { cannotStand: walkBlockedCells(entities, blocked) };
}

/** 검사 대상인가 — auto 레이어(above/below 는 고정 평면) · 지면 점유 1×1(멀티셀은 런타임 클램프가 맡는다) 인 오브젝트. */
export function isSouthCandidate(e: MapEntity): boolean {
  if (e.kind !== "object") return false;
  if (e.layer === "above" || e.layer === "below") return false;
  const [w, h] = footprintWH(e);
  return w === 1 && h === 1;
}

/** 바닥선의 화면 y(셀 중심 기준 px, 아래+) = offsetY. 캔버스 바닥선 표시와 판정이 같은 값을 쓴다. */
export function baselineDyPx(e: MapEntity): number {
  return e.offsetY ?? 0;
}

/**
 * 오브젝트 하나의 판정. 대상이 아니거나, 남쪽 이웃 두 칸에 액터가 설 수 없거나, 여유가 충분하면 null.
 *   여유 = SOUTH_CELL_PX − offsetY (두 이웃은 같은 y 라 값이 같다 — 어느 칸이 설 수 있는지만 다르다).
 *   ⚠ 맵 밖 이웃도 "설 수 있다"로 본다 — 게임 게이트가 DT_Walk 만 보고 맵 경계는 안 보기 때문(SE 끝 벽 모서리가 동결 목록에
 *   있는 이유). 여기서 빼면 "에디터는 통과, 빌드는 실패"가 생긴다. 미러는 관대함까지 같아야 한다.
 */
export function judgeSouth(e: MapEntity, ctx: StandCtx): SouthIntrusion | null {
  if (!isSouthCandidate(e)) return null;
  const offsetY = baselineDyPx(e);
  let neighbor: [number, number] | null = null;
  for (const [nx, ny] of [[e.gx + 1, e.gy], [e.gx, e.gy + 1]] as Array<[number, number]>) {
    if (ctx.cannotStand.has(cellKey(nx, ny))) continue;
    neighbor = [nx, ny];
    break;
  }
  if (!neighbor) return null;
  const clearancePx = SOUTH_CELL_PX - offsetY;
  if (clearancePx <= SOUTH_CLEARANCE_PX) return { level: "block", clearancePx, neighbor, offsetY };
  if (clearancePx <= SOUTH_WATCH_PX) return { level: "watch", clearancePx, neighbor, offsetY };
  return null;
}

/** 맵 전체 — id → 판정(경고·차단만). 캔버스 배지·상태바 카운트·export 검증이 공유한다. */
export function southIssues(entities: MapEntity[], blocked: ReadonlySet<CellKey>): Map<string, SouthIntrusion> {
  const ctx = buildStandCtx(entities, blocked);
  const out = new Map<string, SouthIntrusion>();
  for (const e of entities) {
    const r = judgeSouth(e, ctx);
    if (r) out.set(e.id, r);
  }
  return out;
}

/** 사람에게 보여 줄 문구 — 인스펙터·export 검증 공용. 처방(몇 px 이하로)을 반드시 싣는다. */
export function southMessage(e: MapEntity, r: SouthIntrusion): string {
  const who = entityLabel(e);
  const fix = `Y 이동(offsetY)을 ${SAFE_OFFSET_Y_PX}px 이하로(권장 ${RECOMMENDED_OFFSET_Y_PX}px)`;
  if (r.level === "block") {
    return `${who}: 정렬 바닥선(offsetY ${r.offsetY}px)이 앞 칸 (${r.neighbor[0]},${r.neighbor[1]}) 중심 아래입니다 — 그 칸에 선 캐릭터가 오브젝트에 가려집니다. 게임 빌드 게이트(depth_check 검사 (10))가 막습니다(동결 목록에 있는 것 제외). ${fix}`;
  }
  return `${who}: 정렬 바닥선(offsetY ${r.offsetY}px)이 앞 칸 (${r.neighbor[0]},${r.neighbor[1]}) 중심에 ${r.clearancePx}px 로 붙어 있습니다 — 여유가 얇아 화면마다 앞뒤가 갈릴 수 있습니다. ${fix}`;
}
