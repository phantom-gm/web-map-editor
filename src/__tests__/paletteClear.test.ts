import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../store/editorStore";
import type { PaletteTile } from "../lib/palette";

// 팔레트 초기화(clearPalette): 팔레트를 비우면 palette idx 를 참조하는 ground 도 함께 비운다.
//   오브젝트/포탈 등 엔티티는 ruid 참조라 팔레트와 독립 → 유지되어야 한다.
const tile = (name: string): PaletteTile =>
  ({ name, category: "tile", img: null, ruid: null, regStatus: undefined } as unknown as PaletteTile);

describe("clearPalette", () => {
  beforeEach(() => {
    useEditorStore.getState().newProject();
  });

  it("팔레트와 ground 를 비우고 activeIdx 를 0 으로 리셋한다", () => {
    useEditorStore.setState({
      palette: [tile("a"), tile("b")],
      activeIdx: 1,
      ground: new Map([["3,3", 0], ["4,4", 1]]),
    });
    useEditorStore.getState().clearPalette();
    const s = useEditorStore.getState();
    expect(s.palette).toEqual([]);
    expect(s.ground.size).toBe(0);
    expect(s.activeIdx).toBe(0);
  });

  it("배치된 오브젝트/포탈 엔티티는 유지한다 (ruid 참조라 팔레트와 독립)", () => {
    useEditorStore.setState({
      palette: [tile("a")],
      ground: new Map([["0,0", 0]]),
      entities: [
        { id: "obj1", kind: "object", gx: 5, gy: 5, ruid: "r-obj" },
        { id: "p1", kind: "portal", gx: 2, gy: 2, destMap: "m", destCell: [1, 1] },
      ],
    });
    useEditorStore.getState().clearPalette();
    const ents = useEditorStore.getState().entities;
    expect(ents.map((e) => e.id).sort()).toEqual(["obj1", "p1"]);
  });

  it("undo/redo 스택을 비운다", () => {
    useEditorStore.setState({
      palette: [tile("a")],
      ground: new Map([["0,0", 0]]),
      undoStack: [{} as never],
      redoStack: [{} as never],
    });
    useEditorStore.getState().clearPalette();
    const s = useEditorStore.getState();
    expect(s.undoStack).toEqual([]);
    expect(s.redoStack).toEqual([]);
  });

  it("이미 비어 있으면 groundVer 를 올리지 않는다 (no-op)", () => {
    const before = useEditorStore.getState().groundVer;
    useEditorStore.getState().clearPalette();
    expect(useEditorStore.getState().groundVer).toBe(before);
  });
});
