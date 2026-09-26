// "액터가 설 수 없는 칸" 의 **단일 재료** — 게임 변환기(convert_map)가 DT_Walk 로 굽는 것(이동불가 칠 + 충돌 오브젝트 footprint)과 1:1.
//   export(entityExport.footprintCells)와 남쪽 침범 판정(southIntrusion.buildStandCtx)이 여기 한 곳을 부른다.
//   두 곳이 각자 계산하면 export 규칙이 바뀔 때 판정만 옛 규칙으로 남아 "에디터 통과 · 빌드 실패" 가 조용히 생긴다(2026-09-26 리뷰 후속 #1).
import { cellKey, type CellKey } from "./cell";
import { entityFootprintCells, type MapEntity } from "../types/entity";

/** 포탈이 놓인 칸 — 오브젝트 충돌에서 제외한다(오브젝트 위에 포탈이 있으면 진입 가능해야 함). */
export function portalCellSet(entities: MapEntity[]): Set<CellKey> {
  const out = new Set<CellKey>();
  for (const e of entities) if (e.kind === "portal") out.add(cellKey(e.gx, e.gy));
  return out;
}

/**
 * 충돌(blocks=true) 오브젝트가 막는 **절대** 셀 — footprint(offset-정렬 `entityFootprintCells`)에서 포탈 칸을 뺀 것.
 * 충돌이 아닌 오브젝트·다른 종류는 빈 배열(오브젝트는 기본 통과 가능 — "충돌" 체크한 것만 막는다).
 */
export function blockingFootprintCells(e: MapEntity, portalCells: ReadonlySet<CellKey>): Array<[number, number]> {
  if (e.kind !== "object" || e.blocks !== true) return [];
  return entityFootprintCells(e).filter(([gx, gy]) => !portalCells.has(cellKey(gx, gy)));
}

/** 이동불가 칠 ∪ 모든 충돌 오브젝트의 blockingFootprintCells = DT_Walk 재료(액터가 설 수 없는 칸). */
export function walkBlockedCells(entities: MapEntity[], blocked: ReadonlySet<CellKey>): Set<CellKey> {
  const out = new Set<CellKey>(blocked);
  const portalCells = portalCellSet(entities);
  for (const e of entities) {
    for (const [gx, gy] of blockingFootprintCells(e, portalCells)) out.add(cellKey(gx, gy));
  }
  return out;
}
