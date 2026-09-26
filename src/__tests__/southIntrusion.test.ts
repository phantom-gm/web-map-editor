import { describe, it, expect } from "vitest";
import {
  buildStandCtx,
  judgeSouth,
  southIssues,
  southMessage,
  isSouthCandidate,
  SAFE_OFFSET_Y_PX,
  SOUTH_CELL_PX,
  RECOMMENDED_OFFSET_Y_PX,
} from "../lib/southIntrusion";
import { cellKey } from "../lib/cell";
import type { MapEntity } from "../types/entity";

// 게임 depth_check 검사 (10) 미러 — 요청서 §1 표(≤13 통과 · 14~15 관찰 · ≥16 위반)를 그대로 잠근다.
const obj = (gx: number, gy: number, offsetY?: number, extra: Partial<MapEntity> = {}): MapEntity => ({
  id: `o${gx}_${gy}_${offsetY ?? 0}`,
  kind: "object",
  gx,
  gy,
  name: "가로등_A",
  ruid: "r",
  tilesW: 1,
  tilesH: 1,
  offsetY,
  ...extra,
});
const free = buildStandCtx([], new Set());

describe("judgeSouth — 임계값(요청서 §1 표)", () => {
  it("상수: 셀 한 칸 깊이 16px · 안전 상한 13px · 권장 11px", () => {
    expect(SOUTH_CELL_PX).toBe(16);
    expect(SAFE_OFFSET_Y_PX).toBe(13);
    expect(RECOMMENDED_OFFSET_Y_PX).toBeLessThanOrEqual(SAFE_OFFSET_Y_PX);
  });
  it("offsetY 0·11·13 은 통과(null)", () => {
    for (const y of [undefined, 0, 11, 13]) expect(judgeSouth(obj(5, 5, y), free)).toBeNull();
  });
  it("14·15 는 관찰(watch) — 여유 2·1px", () => {
    expect(judgeSouth(obj(5, 5, 14), free)).toMatchObject({ level: "watch", clearancePx: 2 });
    expect(judgeSouth(obj(5, 5, 15), free)).toMatchObject({ level: "watch", clearancePx: 1 });
  });
  it("16 이상은 차단(block) — 동률(여유 0)도 위반, 게임 SOUTH_CLEARANCE(0.5px) 이하 전부", () => {
    expect(judgeSouth(obj(5, 5, 16), free)).toMatchObject({ level: "block", clearancePx: 0 });
    expect(judgeSouth(obj(5, 5, 15.5), free)).toMatchObject({ level: "block" });
    expect(judgeSouth(obj(5, 5, 17), free)).toMatchObject({ level: "block", clearancePx: -1 });
    expect(judgeSouth(obj(5, 5, 26), free)?.level).toBe("block");
  });
  it("위로 올린(음수) offset 은 항상 통과", () => {
    expect(judgeSouth(obj(5, 5, -20), free)).toBeNull();
  });
});

describe("judgeSouth — 대상 여부", () => {
  it("오브젝트가 아니거나 above/below 레이어거나 멀티셀이면 대상이 아니다", () => {
    expect(isSouthCandidate({ id: "n", kind: "npc", gx: 1, gy: 1, offsetY: 30 })).toBe(false);
    expect(judgeSouth(obj(1, 1, 30, { layer: "above" }), free)).toBeNull();
    expect(judgeSouth(obj(1, 1, 30, { layer: "below" }), free)).toBeNull();
    expect(judgeSouth(obj(1, 1, 30, { tilesW: 2 }), free)).toBeNull();
    expect(judgeSouth(obj(1, 1, 30, { tilesH: 2 }), free)).toBeNull();
  });
  it("layer 미설정(auto) 1×1 오브젝트는 대상이다", () => {
    expect(isSouthCandidate(obj(1, 1, 0))).toBe(true);
  });
});

describe("judgeSouth — 남쪽 이웃이 설 수 있는가(DT_Walk 미러)", () => {
  it("이웃 두 칸(gx+1,gy)·(gx,gy+1)이 모두 이동불가면 대상 아님(물속 바위)", () => {
    const ctx = buildStandCtx([], new Set([cellKey(6, 5), cellKey(5, 6)]));
    expect(judgeSouth(obj(5, 5, 20), ctx)).toBeNull();
  });
  it("한 칸만 설 수 있어도 판정한다 — 설 수 있는 칸을 neighbor 로 돌려준다", () => {
    const ctx = buildStandCtx([], new Set([cellKey(6, 5)]));
    expect(judgeSouth(obj(5, 5, 20), ctx)).toMatchObject({ level: "block", neighbor: [5, 6] });
  });
  it("충돌(blocks=true) 오브젝트의 footprint 는 설 수 없는 칸이다(포탈이 놓인 칸은 제외)", () => {
    const wall = obj(6, 5, 0, { id: "wall", blocks: true, tilesW: 1, tilesH: 1 });
    const rock = obj(5, 6, 0, { id: "rock", blocks: true });
    const portal: MapEntity = { id: "p", kind: "portal", gx: 5, gy: 6, destMap: "m", destCell: [0, 0] };
    // 둘 다 막히면 대상 아님
    expect(judgeSouth(obj(5, 5, 20), buildStandCtx([wall, rock], new Set()))).toBeNull();
    // 포탈이 (5,6) 에 있으면 그 칸의 charge 는 통과 가능 → 다시 판정 대상
    expect(judgeSouth(obj(5, 5, 20), buildStandCtx([wall, rock, portal], new Set()))?.neighbor).toEqual([5, 6]);
  });
  it("맵 밖 이웃도 설 수 있다고 본다 — 게임 게이트와 같은 관대함(맵 SE 끝 벽 모서리가 동결 목록에 있는 이유)", () => {
    expect(judgeSouth(obj(59, 59, 20), free)?.level).toBe("block");
  });
});

describe("southIssues / southMessage", () => {
  it("맵 전체에서 경고·차단만 id 로 모은다", () => {
    const ents = [obj(1, 1, 11), obj(2, 2, 14), obj(3, 3, 17), obj(4, 4, 17, { layer: "above" })];
    const m = southIssues(ents, new Set());
    expect([...m.keys()].sort()).toEqual([ents[1].id, ents[2].id].sort());
    expect(m.get(ents[1].id)?.level).toBe("watch");
    expect(m.get(ents[2].id)?.level).toBe("block");
  });
  it("문구에 위치·현재값·처방(13px 이하, 권장 11px)이 들어간다", () => {
    const e = obj(30, 13, 17);
    const msg = southMessage(e, judgeSouth(e, free)!);
    expect(msg).toContain("object(30,13)");
    expect(msg).toContain("17px");
    expect(msg).toContain("13px 이하");
    expect(msg).toContain("11px");
    expect(msg).toContain("depth_check");
  });
});
