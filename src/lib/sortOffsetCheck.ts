// 겹치는 멀티셀 오브젝트의 sortOffset 자동 판정 — 순수 함수(스토어/렌더 비의존).
//   계약: docs/map/isometric/에디터_sortOffset_요구사항.md (R1~R4)
//
// 배경: MSW 는 스프라이트당 정렬키(z, 작을수록 앞)가 하나뿐이라, footprint 가 겹치는 두 멀티셀
//   오브젝트가 **같은 z** 를 가지면 그 위 플레이어가 lo≥hi(해 없음)에 걸려 뒤로 숨는다(요구서 §2).
//   해결은 앞에 그려질 쪽에 **더 큰 sortOffset**(= 더 작은 z)을 주는 것. sortOffset 은 이미 스키마에
//   있고 파이프라인이 소비한다(convert_map:197 → build_map:394) — 새 필드가 아니라 **누락을 없애는** 일.
//
// ⚠ 방향이 맞아야 한다(§R2): 반대로 벌리면 안 고친 것과 같다. 그래서 방향은 요구서 §5 의
//   **셀 단위 판정**(isFrontOfRect 로 실제 밟는 칸에서 앞/뒤 판정)으로 결정한다 — 북서코너 깊이
//   비교 휴리스틱은 표본 1건(다리)뿐이라 기본값 제안용일 뿐, 여기선 안전한 셀 판정을 쓴다.
import {
  entityFootprintCells,
  footprintWH,
  GAME_TILE_HALF_H,
  PX_TO_WORLD,
  type MapEntity,
} from "../types/entity";

const CELL_DEPTH = GAME_TILE_HALF_H; // 0.14 = 셀 1칸 깊이 (build_map CELL_DEPTH 와 동일)
const ORIGIN = 15; // IsoProjectLogic ORIGIN_X/Y

export interface FpRect {
  gx: number;
  gy: number;
  ax: number;
  ay: number;
}

/** 오브젝트의 게임 footprint rect (offset-정렬 — entityFootprintCells 의 bounds = build_map baked 메타와 일치). */
export function footprintRect(e: MapEntity): FpRect {
  const cells = entityFootprintCells(e);
  let gx = Infinity, gy = Infinity, ax = -Infinity, ay = -Infinity;
  for (const [x, y] of cells) {
    if (x < gx) gx = x;
    if (y < gy) gy = y;
    if (x > ax) ax = x;
    if (y > ay) ay = y;
  }
  return { gx, gy, ax, ay };
}

/** 요구서 §5 — 셀 (cx,cy) 가 rect 를 점유한 오브젝트보다 **앞**인가. 안=앞, 남/동=앞, 북/서=뒤. */
export function isFrontOfRect(r: FpRect, cx: number, cy: number): boolean {
  if (cx >= r.gx && cy >= r.gy && cx <= r.ax && cy <= r.ay) return true;
  if (cx > r.ax || cy > r.ay) return true;
  return false;
}

/**
 * 게임 z (작을수록 앞) — sortOffset 을 뺀 base 와 합. build_map 과 동일: z = pos.y − sortOffset×0.14.
 *   pos.y = cellToWorld(gx,gy).y + offsetY(world). 맵 shift 는 모든 오브젝트에 같은 상수라 **쌍 비교에서
 *   상쇄** → ORIGIN 15 로 계산해도 A/B 상대 순서는 정확하다.
 */
export function gameZ(e: MapEntity): number {
  const posY = -((e.gx - ORIGIN) + (e.gy - ORIGIN)) * CELL_DEPTH;
  const offY = -(e.offsetY ?? 0) * PX_TO_WORLD; // export 부호 규약(화면 아래+ → world 위+)
  return posY + offY - (e.sortOffset ?? 0) * CELL_DEPTH;
}

const isMultiCell = (e: MapEntity) => {
  if (e.kind !== "object") return false;
  const [w, h] = footprintWH(e);
  return w > 1 || h > 1;
};

const rectsOverlap = (a: FpRect, b: FpRect) =>
  a.gx <= b.ax && b.gx <= a.ax && a.gy <= b.ay && b.gy <= a.ay;

/** 셀 (cx,cy) 가 rect 점유 안(경계 포함)인가. 작은 오브젝트가 건물 위에 서 있는지 판정. */
const insideRect = (r: FpRect, cx: number, cy: number) =>
  cx >= r.gx && cy >= r.gy && cx <= r.ax && cy <= r.ay;

export interface SortOffsetCycle {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
}
export interface SortOffsetFix {
  id: string;
  name: string;
  from: number;
  to: number;
}
export interface SortOffsetDeep {
  id: string;
  name: string;
  buildingName: string;
  need: number; // 앞에 오려면 필요한 sortOffset (너무 커서 자동 적용 안 함)
}
export interface SortOffsetResult {
  fixes: SortOffsetFix[]; // 적용할 sortOffset 변경. 비어 있으면 이미 정상.
  cycles: SortOffsetCycle[]; // R4 — sortOffset 으로 해결 불가(에셋 분할 필요). 경고만.
  deepInside: SortOffsetDeep[]; // 큰 footprint 깊숙이 박힌 작은 오브젝트 — 자동 sortOffset 이 과해져(새 역전 유발) 미적용, 배치/footprint 검토 권장.
}

// 작은 오브젝트를 건물 앞으로 올릴 때 허용하는 최대 자동 sortOffset. 이보다 크면 그 오브젝트는
//   footprint 깊숙이(=시각상 건물 뒤) 있다는 뜻 — 억지로 올리면 여러 칸 앞 것들까지 덮어 새 역전을
//   만든다. 그 경우 자동 적용 대신 경고(deepInside)로 돌려 사람이 배치/footprint 를 검토한다.
//   화분처럼 앞줄 근처는 2~3이면 충분 → 4는 그걸 포함하고 깊숙한 오탐(8~9)은 배제하는 경계값.
const MAX_AUTO_SORTOFFSET = 4;

/**
 * 겹치는 멀티셀 오브젝트에 필요한 sortOffset 을 계산한다(적용은 호출자/스토어).
 * @param entities 전체 엔티티
 * @param standable (선택) 밟을 수 있는 칸 판정 — 이동불가 칸은 제외해 헛제약/거짓순환을 막는다.
 *   미제공 시 union bbox 전 칸을 본다(보수적 — 방향은 순수 기하라 결과 동일, 순환만 과탐 가능).
 */
export function computeSortOffsets(
  entities: MapEntity[],
  standable?: (gx: number, gy: number) => boolean,
): SortOffsetResult {
  const objects = entities.filter((e) => e.kind === "object");
  const multi = objects.filter(isMultiCell);
  const rect = new Map<string, FpRect>();
  const baseZ = new Map<string, number>(); // sortOffset 제외 base z
  const so = new Map<string, number>(); // 작업본 sortOffset (여기서 올린다)
  for (const e of objects) {
    rect.set(e.id, footprintRect(e));
    baseZ.set(e.id, gameZ({ ...e, sortOffset: 0 }));
    so.set(e.id, e.sortOffset ?? 0);
  }
  const zOf = (id: string) => baseZ.get(id)! - so.get(id)! * CELL_DEPTH;

  const cycles: SortOffsetCycle[] = [];
  const edges: { frontId: string; backId: string }[] = []; // frontId 가 backId 보다 앞(z 더 작아야)

  for (let i = 0; i < multi.length; i++) {
    for (let j = i + 1; j < multi.length; j++) {
      const A = multi[i], B = multi[j];
      const ra = rect.get(A.id)!, rb = rect.get(B.id)!;
      if (!rectsOverlap(ra, rb)) continue;
      let needBFront = false, needAFront = false;
      const gx = Math.min(ra.gx, rb.gx), gy = Math.min(ra.gy, rb.gy);
      const ax = Math.max(ra.ax, rb.ax), ay = Math.max(ra.ay, rb.ay);
      for (let cy = gy; cy <= ay; cy++) {
        for (let cx = gx; cx <= ax; cx++) {
          if (standable && !standable(cx, cy)) continue;
          const fa = isFrontOfRect(ra, cx, cy), fb = isFrontOfRect(rb, cx, cy);
          if (fa && !fb) needBFront = true; // A앞/B뒤 인 칸에서 플레이어가 A 위 → B 는 그 뒤 → z_B<z_A
          if (fb && !fa) needAFront = true;
        }
      }
      if (needAFront && needBFront) {
        cycles.push({ aId: A.id, bId: B.id, aName: A.name ?? A.id, bName: B.name ?? B.id });
      } else if (needBFront) {
        edges.push({ frontId: B.id, backId: A.id });
      } else if (needAFront) {
        edges.push({ frontId: A.id, backId: B.id });
      }
    }
  }

  // 완화: front 의 z 가 back 보다 작아지도록 front 의 sortOffset 을 **최소 정수**만큼 올린다.
  //   DAG 면 수렴한다(순환은 위에서 이미 걸러 edges 에 안 들어옴). cap 은 안전장치.
  const EPS = 1e-6;
  const cap = edges.length * (objects.length + 2) + 4;
  for (let pass = 0; pass < cap; pass++) {
    let changed = false;
    for (const { frontId, backId } of edges) {
      if (zOf(frontId) >= zOf(backId) - EPS) {
        // z_front < z_back:  baseF − soF·D < zBack  →  soF > (baseF − zBack)/D
        const need = (baseZ.get(frontId)! - zOf(backId)) / CELL_DEPTH + EPS;
        const next = Math.floor(need) + 1;
        if (next > so.get(frontId)!) {
          so.set(frontId, next);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // (2) 작은(비-멀티셀) 오브젝트가 멀티셀 건물 footprint **안**에 서 있으면 그 위(앞)로. 멀티셀 건물은
  //   z 가 하나(앞-tip)뿐이라, 그 안의 작은 오브젝트가 건물 앞벽 앞이어도 건물 전체 뒤로 밀린다(오브젝트는
  //   런타임 깊이보정을 안 받음 — 화분이 건물 뒤로 가는 문제). 건물 z 는 위 멀티셀 완화 후 값으로 고정.
  //   ⚠ inside=앞 규칙은 원래 플레이어(툇마루)용이라 장식물엔 과할 수 있다 → 필요한 sortOffset 이
  //     MAX_AUTO_SORTOFFSET 을 넘으면(=footprint 깊숙이=시각상 건물 뒤) 자동 적용 대신 deepInside 경고.
  const deepInside: SortOffsetDeep[] = [];
  for (const o of objects) {
    if (isMultiCell(o)) continue;
    const ro = rect.get(o.id)!; // 1×1 → ax/ay = 그 발셀
    let need = so.get(o.id)!;
    let deepBy: MapEntity | null = null;
    for (const b of multi) {
      if (!insideRect(rect.get(b.id)!, ro.ax, ro.ay)) continue;
      // z_o < z_b:  baseZo − soO·D < zOf(b)  →  soO > (baseZo − zOf(b))/D
      const t = (baseZ.get(o.id)! - zOf(b.id)) / CELL_DEPTH + EPS;
      const soNeeded = Math.floor(t) + 1;
      if (soNeeded > need) { need = soNeeded; deepBy = b; }
    }
    if (need > (so.get(o.id) ?? 0)) {
      if (need <= MAX_AUTO_SORTOFFSET) {
        so.set(o.id, need);
      } else if (deepBy) {
        deepInside.push({ id: o.id, name: o.name ?? o.id, buildingName: deepBy.name ?? deepBy.id, need });
      }
    }
  }

  const fixes: SortOffsetFix[] = [];
  for (const e of objects) {
    const to = so.get(e.id)!;
    const from = e.sortOffset ?? 0;
    if (to === from) continue;
    // 균일 캡: 완화(멀티셀 겹침)가 낸 값도 MAX 초과면 자동 적용 안 함 — 큰 sortOffset 은 여러 칸 앞
    //   것들까지 덮어 새 역전을 만든다(록 클러스터 등). 경고로 돌려 사람이 배치/footprint 를 검토.
    //   deck/rail(1)·화분(2~3) 같은 작은 구조 보정만 적용된다.
    if (to > MAX_AUTO_SORTOFFSET) {
      deepInside.push({ id: e.id, name: e.name ?? e.id, buildingName: "겹침 정렬 과다", need: to });
    } else {
      fixes.push({ id: e.id, name: e.name ?? e.id, from, to });
    }
  }
  return { fixes, cycles, deepInside };
}
