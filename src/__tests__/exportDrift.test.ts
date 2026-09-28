import { describe, it, expect, beforeEach } from "vitest";
import { exportDrift, pendingDrift, driftMessage } from "../lib/exportDrift";
import { useEditorStore } from "../store/editorStore";
import { emptyLayer } from "../types/blueprint";
import { PROJECT_TYPE, PROJECT_VERSION } from "../lib/projectIO";
import type { PaletteTile } from "../lib/palette";
import type { MapEntity } from "../types/entity";

// 에디터 밖에서 고친 파생값 — 실데이터(2026-09-28)의 세 모양을 그대로 옮겼다.
//   판매대: depthW 4(게임 커밋 7af4b946) · 지면 점유 1×1 / 침엽수: offset 10px 값 · Y 이동 15 / 침엽수: scale 배율 0.2 값 · 배율 0.25
const COUNTER: MapEntity = {
  id: "counter", kind: "object", gx: 3, gy: 4, name: "실내_판매대_4x1_SE", ruid: "r-counter", tilesW: 1, tilesH: 1,
  baseW: 4, baseH: 2, depthW: 4, depthH: 1, spriteW: 4, spriteH: 2,
};
const TREE_OFFSET: MapEntity = {
  id: "tree-off", kind: "object", gx: 32, gy: 21, name: "침엽수_B", ruid: "r-tree", tilesW: 1, tilesH: 1,
  baseW: 6.203125, baseH: 11.25, scaleMul: 0.25, offsetY: 15, offset: [0, -0.087], depthW: 1, depthH: 1, spriteW: 1.551, spriteH: 2.813,
};
const TREE_SCALE: MapEntity = { ...TREE_OFFSET, id: "tree-scale", gx: 28, gy: 22, offsetY: 10, scale: 0.175 };
const CONSISTENT: MapEntity = {
  id: "inn", kind: "object", gx: 14, gy: 9, name: "페른델여관", ruid: "r-inn", tilesW: 9, tilesH: 3, baseW: 11.765625, baseH: 12.546875,
  scaleMul: 0.7, offsetY: 2, offsetX: -20, scale: 0.612, offset: [-0.175, -0.017], depthW: 9, depthH: 3, sortPadX: 2, spriteW: 8.236, spriteH: 8.783,
};
// 팔레트 이미지 흉내 — 프로젝트 파일에 저장된 네이티브 px 로(에디터가 scale 을 다시 계산하는 조건).
const tile = (ruid: string, w: number): PaletteTile =>
  ({ name: ruid, category: "object", ruid, img: { naturalWidth: w, naturalHeight: w } }) as unknown as PaletteTile;
const PALETTE = [tile("r-tree", 397), tile("r-inn", 753)];

describe("exportDrift — 저장이 바꾸게 될 파생값", () => {
  it("저작값과 맞는 오브젝트는 없음", () => {
    expect(exportDrift([CONSISTENT], PALETTE)).toEqual([]);
  });

  it("depthW 손수정 — 유지하려면 지면 점유 W 를 4 로", () => {
    const [d] = exportDrift([COUNTER], []);
    expect(d).toMatchObject({ id: "counter", field: "depthW", stored: 4, next: 1 });
    expect(d.keep).toContain("W 를 4 로");
  });

  it("offset 손수정 — 유지하려면 Y 이동을 10px 로", () => {
    const [d] = exportDrift([TREE_OFFSET], []);
    expect(d).toMatchObject({ field: "offset", stored: [0, -0.087], next: [0, -0.131] });
    expect(d.keep).toContain("(0, 10)px");
  });

  it("scale 손수정은 이미지가 있을 때만 잡는다 — 유지하려면 배율 0.2", () => {
    expect(exportDrift([TREE_SCALE], []).filter((d) => d.field === "scale")).toEqual([]); // 이미지 없음 → export 가 마지막 값을 둔다
    const d = exportDrift([TREE_SCALE], PALETTE).find((x) => x.field === "scale")!;
    expect(d).toMatchObject({ stored: 0.175, next: 0.219 });
    expect(d.keep).toContain("배율을 0.2 로");
  });

  it("파일에 없던 필드(옛 파일 이관)는 손수정이 아니다", () => {
    const legacy: MapEntity = { id: "old", kind: "object", gx: 1, gy: 1, ruid: "r", tilesW: 4, tilesH: 3 };
    expect(exportDrift([legacy], [])).toEqual([]);
  });

  it("오브젝트가 아닌 엔티티(npc scale 등)는 보지 않는다 — 런타임이 스폰 배율을 적용하지 않는다", () => {
    const npc: MapEntity = { id: "npc", kind: "npc", gx: 4, gy: 3, npcClassId: 1, scale: 0.19140625, ruid: "r-tree" };
    expect(exportDrift([npc], PALETTE)).toEqual([]);
  });
});

describe("pendingDrift — 저장 직전, 아직 바뀌게 될 것만", () => {
  const loaded = exportDrift([COUNTER, TREE_OFFSET, CONSISTENT], PALETTE);

  it("그대로면 열 때의 목록 그대로", () => {
    expect(pendingDrift(loaded, [COUNTER, TREE_OFFSET, CONSISTENT], PALETTE).map((d) => d.id)).toEqual(["counter", "tree-off"]);
  });

  it("저작값을 게임 값에 맞추면 빠진다", () => {
    const fixed = [{ ...COUNTER, tilesW: 4 }, { ...TREE_OFFSET, offsetY: 10 }, CONSISTENT];
    expect(pendingDrift(loaded, fixed, PALETTE)).toEqual([]);
  });

  it("열 때 없던 차이(사용자가 에디터에서 직접 바꾼 값)는 경고하지 않는다", () => {
    const edited = [COUNTER, TREE_OFFSET, { ...CONSISTENT, offsetY: 5 }];
    expect(pendingDrift(loaded, edited, PALETTE).map((d) => d.id)).toEqual(["counter", "tree-off"]);
  });

  it("다른 값으로 바꾼 채 저장하면 바뀔 값을 새로 보여 준다", () => {
    const [d] = pendingDrift(loaded, [COUNTER, { ...TREE_OFFSET, offsetY: 12 }, CONSISTENT], PALETTE).filter((x) => x.id === "tree-off");
    expect(d.next).toEqual([0, -0.105]);
  });

  it("확인창 문구 — 게임 값 → 저장 값 · 유지 방법", () => {
    const msg = driftMessage(loaded);
    expect(msg).toContain("에디터 밖에서 고친 값 2건");
    expect(msg).toContain('object(3,4) "실내_판매대_4x1_SE": depthW 4 → 1');
    expect(msg).toContain("유지하려면");
  });
});

describe("스토어 — 열 때 기억하고, 저장·새 프로젝트에서 잊는다", () => {
  beforeEach(() => {
    useEditorStore.getState().newProject();
    useEditorStore.setState({ palette: [] });
  });
  const project = (entities: MapEntity[]) => ({
    type: PROJECT_TYPE, version: PROJECT_VERSION, map: "m", size: [40, 40] as [number, number], groundOrigin: [0, 0] as [number, number],
    ground: [], blocked: [], palette: [], staticLayer: emptyLayer(), attributeBase: emptyLayer(), entities,
  });

  it("loadProject 가 loadDrift 를 채우고 markSaved·newProject 가 비운다", () => {
    useEditorStore.getState().loadProject(project([COUNTER, CONSISTENT]), []);
    expect(useEditorStore.getState().loadDrift.map((d) => `${d.id}.${d.field}`)).toEqual(["counter.depthW"]);
    useEditorStore.getState().markSaved();
    expect(useEditorStore.getState().loadDrift).toEqual([]);
    useEditorStore.getState().loadProject(project([COUNTER]), []);
    useEditorStore.getState().newProject();
    expect(useEditorStore.getState().loadDrift).toEqual([]);
  });
});
