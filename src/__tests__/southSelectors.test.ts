import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../store/editorStore";
import { selectSouthCounts, selectStandCtx } from "../store/southSelectors";
import { cellKey } from "../lib/cell";
import type { MapEntity } from "../types/entity";

// 버전 memo selector — 같은 (entitiesVer, blockedVer) 면 같은 객체(재렌더 없음), 엔티티·이동불가가 바뀌면 새 값.
const lamp = (id: string, gx: number, offsetY: number): MapEntity => ({ id, kind: "object", gx, gy: 5, ruid: "r", tilesW: 1, tilesH: 1, offsetY });

describe("southSelectors", () => {
  beforeEach(() => {
    useEditorStore.getState().newProject();
  });

  it("같은 상태면 같은 객체를 돌려준다(참조 안정)", () => {
    const s = useEditorStore.getState();
    expect(selectStandCtx(s)).toBe(selectStandCtx(s));
    expect(selectSouthCounts(s)).toBe(selectSouthCounts(s));
  });

  it("엔티티가 바뀌면(entitiesVer) 집계가 새로 나온다", () => {
    useEditorStore.setState((s) => ({ entities: [lamp("a", 3, 17), lamp("b", 6, 14), lamp("c", 9, 11)], entitiesVer: s.entitiesVer + 1 }));
    const c1 = selectSouthCounts(useEditorStore.getState());
    expect(c1).toEqual({ block: 1, watch: 1 });
    useEditorStore.getState().updateEntity("a", { offsetY: 11 });
    const c2 = selectSouthCounts(useEditorStore.getState());
    expect(c2).not.toBe(c1);
    expect(c2).toEqual({ block: 0, watch: 1 });
  });

  it("이동불가 칠이 바뀌면(blockedVer) 컨텍스트가 새로 나온다 — blocked 는 제자리 변이라 참조는 그대로다", () => {
    useEditorStore.setState((s) => ({ entities: [lamp("a", 3, 20)], entitiesVer: s.entitiesVer + 1 }));
    const before = selectStandCtx(useEditorStore.getState());
    expect(selectSouthCounts(useEditorStore.getState())).toEqual({ block: 1, watch: 0 });
    useEditorStore.getState().setBlockedAt(4, 5, true); // (gx+1, gy)
    useEditorStore.getState().setBlockedAt(3, 6, true); // (gx, gy+1)
    const after = selectStandCtx(useEditorStore.getState());
    expect(after).not.toBe(before);
    expect(after.cannotStand.has(cellKey(4, 5))).toBe(true);
    expect(selectSouthCounts(useEditorStore.getState())).toEqual({ block: 0, watch: 0 }); // 설 수 있는 이웃이 없다
  });
});
