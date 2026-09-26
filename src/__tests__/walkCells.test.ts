import { describe, it, expect } from "vitest";
import { blockingFootprintCells, portalCellSet, walkBlockedCells } from "../lib/walkCells";
import { exportEntities } from "../lib/entityExport";
import { buildStandCtx } from "../lib/southIntrusion";
import { cellKey } from "../lib/cell";
import type { MapEntity } from "../types/entity";

// DT_Walk 재료의 단일 출처 — export 의 footprintCells 와 남쪽 침범 판정의 "설 수 없는 칸" 이 같은 함수에서 나온다.
//   둘이 갈리면 "에디터 통과 · 빌드 실패" 가 조용히 생긴다(리뷰 후속 #1). 이 테스트가 그 동치를 잠근다.
const wall: MapEntity = { id: "wall", kind: "object", gx: 5, gy: 5, name: "담장", ruid: "r", tilesW: 2, tilesH: 2, blocks: true };
const tree: MapEntity = { id: "tree", kind: "object", gx: 8, gy: 8, name: "나무", ruid: "r", tilesW: 2, tilesH: 2 }; // 통과 가능
const portal: MapEntity = { id: "p", kind: "portal", gx: 4, gy: 5, destMap: "m", destCell: [0, 0] }; // 담장 footprint 안
const ents = [wall, tree, portal];

describe("walkCells", () => {
  it("portalCellSet — 포탈이 놓인 칸", () => {
    expect([...portalCellSet(ents)]).toEqual([cellKey(4, 5)]);
  });

  it("blockingFootprintCells — 충돌 오브젝트만, 포탈 칸은 뺀다", () => {
    const cells = blockingFootprintCells(wall, portalCellSet(ents));
    expect(cells).toHaveLength(3); // 2×2 = 4 에서 포탈 칸 (4,5) 제외
    expect(cells.some(([x, y]) => x === 4 && y === 5)).toBe(false);
    expect(blockingFootprintCells(tree, new Set())).toEqual([]);
    expect(blockingFootprintCells(portal, new Set())).toEqual([]);
  });

  it("walkBlockedCells = 이동불가 칠 ∪ 충돌 footprint(포탈 제외)", () => {
    const blocked = new Set([cellKey(0, 0)]);
    const walk = walkBlockedCells(ents, blocked);
    expect(walk.has(cellKey(0, 0))).toBe(true);
    expect(walk.has(cellKey(5, 5))).toBe(true);
    expect(walk.has(cellKey(4, 5))).toBe(false); // 포탈 칸
    expect(walk.has(cellKey(8, 8))).toBe(false); // 통과 가능 나무
    expect(walk.size).toBe(1 + 3);
  });

  it("동치: export footprintCells(앵커 상대) 를 절대 셀로 되돌리면 walkBlockedCells 와 같다 · 판정 컨텍스트도 같다", () => {
    const exported = exportEntities(ents, []); // 팔레트 없음 → scale 만 빠지고 footprintCells 는 그대로
    const fromExport = new Set<string>();
    for (const e of exported) for (const [dx, dy] of e.footprintCells ?? []) fromExport.add(cellKey(e.gx + dx, e.gy + dy));
    const walk = walkBlockedCells(ents, new Set());
    expect([...fromExport].sort()).toEqual([...walk].sort());
    expect([...buildStandCtx(ents, new Set()).cannotStand].sort()).toEqual([...walk].sort());
  });
});
