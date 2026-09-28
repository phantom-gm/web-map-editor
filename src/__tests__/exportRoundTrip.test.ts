import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../store/editorStore";
import { exportEntities, exportOffset, objectExportScale } from "../lib/entityExport";
import { buildBlueprint, parseBlueprint } from "../lib/blueprintIO";
import { emptyLayer } from "../types/blueprint";
import { PROJECT_TYPE, PROJECT_VERSION, type ProjectFileInput } from "../lib/projectIO";
import type { MapEntity } from "../types/entity";

// 재저장이 게임 데이터를 조용히 바꾸지 않는다 — sortPadX 요청서 R1 과 같은 축의 회귀 가드.
//   게임이 읽는 파일(legend_of_light/map/<맵>.json)은 에디터 프로젝트 파일 그 자체라, 무변경 불러오기→저장이 한 글자라도 바꾸면
//   다음 빌드가 그 차이를 게임에 굽는다.

// 실데이터에서 옮긴 오브젝트들(2026-09-28 ferendel.json) — 파생 필드가 저작 필드와 정확히 맞는 상태.
const INN: MapEntity = {
  id: "0d2a1f5c-3aad-4a7c-b7a6-0cd1c067dad1", kind: "object", gx: 14, gy: 9, name: "페른델여관",
  ruid: "5eddc2fff6834a85bfafcdef6f8f25e5", tilesW: 9, tilesH: 3, baseW: 11.765625, baseH: 12.546875, scaleMul: 0.7,
  offsetY: 2, offsetX: -20, scale: 0.612, offset: [-0.175, -0.017], depthW: 9, depthH: 3, sortPadX: 2, spriteW: 8.236, spriteH: 8.783,
};
const TREE: MapEntity = {
  id: "tree", kind: "object", gx: 0, gy: 5, name: "침엽수_A", ruid: "r-tree", tilesW: 1, tilesH: 1, baseW: 6.296875, baseH: 11.25,
  scaleMul: 0.25, offsetY: 10, scale: 0.219, offset: [0, -0.087], depthW: 1, depthH: 1, spriteW: 1.574, spriteH: 2.813,
};
const ROTATED_WALL: MapEntity = {
  id: "wall", kind: "object", gx: 5, gy: 5, name: "담장", ruid: "r-wall", tilesW: 2, tilesH: 1, baseW: 2, baseH: 1,
  blocks: true, rotationDeg: 12, rotation: 12, footprintCells: [[0, 0], [-1, 0]], depthW: 2, depthH: 1, spriteW: 2, spriteH: 1,
};

function project(entities: MapEntity[]): ProjectFileInput {
  return {
    type: PROJECT_TYPE, version: PROJECT_VERSION, map: "rt", size: [30, 30], groundOrigin: [0, 0],
    ground: [], blocked: [], palette: [], staticLayer: emptyLayer(), attributeBase: emptyLayer(), entities,
  };
}
// 파일에 실제로 써지는 모양으로 비교한다(JSON 은 undefined 키를 떨군다 — 저작 필드를 지우면 파일에서 사라지는 것이 계약이다).
const exported = (): MapEntity[] => JSON.parse(JSON.stringify(useEditorStore.getState().exportProject())).entities;
const byId = (id: string) => exported().find((e) => e.id === id)!;

describe("무변경 왕복 — 불러오기 → 저장이 엔티티를 한 글자도 바꾸지 않는다", () => {
  beforeEach(() => {
    useEditorStore.getState().newProject();
    useEditorStore.setState({ palette: [] });
  });

  it("여관(sortPadX 2)·나무(offset .5 경계)·회전 충돌 담장이 그대로 나온다", () => {
    useEditorStore.getState().loadProject(project([INN, TREE, ROTATED_WALL]), []);
    expect(exported()).toEqual([INN, TREE, ROTATED_WALL]);
  });

  it("sortPadX 는 blueprint export/import 에서도 살아남는다", () => {
    const bp = buildBlueprint({
      mapName: "rt", size: [30, 30], groundOrigin: [3, 4], paletteNames: [], ground: new Map(), blocked: new Set(),
      staticLayer: emptyLayer(), attributeBase: emptyLayer(), entities: [INN],
    });
    const back = parseBlueprint(JSON.parse(JSON.stringify(bp)));
    expect(back.entities[0].sortPadX).toBe(2);
    expect([back.entities[0].gx, back.entities[0].gy]).toEqual([14, 9]);
  });

  it("두 번 내보내도 같다(멱등)", () => {
    const once = exportEntities([INN, TREE, ROTATED_WALL], []);
    expect(exportEntities(once, [])).toEqual(once);
  });
});

describe("파생 필드는 저작 상태를 따른다 — 0 으로 되돌리면 지운다", () => {
  beforeEach(() => {
    useEditorStore.getState().newProject();
    useEditorStore.setState({ palette: [] });
    useEditorStore.getState().loadProject(project([INN, TREE, ROTATED_WALL]), []);
  });

  it("offsetX·Y 를 0 으로 되돌리면 옛 offset 이 남지 않는다(게임은 offset 을 읽는다)", () => {
    useEditorStore.getState().updateEntity(TREE.id, { offsetY: undefined });
    expect(byId(TREE.id)).not.toHaveProperty("offset");
  });

  it("기울기를 0 으로 되돌리면 옛 rotation 이 남지 않는다", () => {
    useEditorStore.getState().updateEntity(ROTATED_WALL.id, { rotationDeg: undefined });
    expect(byId(ROTATED_WALL.id)).not.toHaveProperty("rotation");
  });

  it("충돌을 끄면 옛 footprintCells 가 남지 않는다", () => {
    useEditorStore.getState().updateEntity(ROTATED_WALL.id, { blocks: undefined });
    expect(byId(ROTATED_WALL.id)).not.toHaveProperty("footprintCells");
  });

  it("sortPadX 는 저작 필드라 export 가 계산하지 않는다 — 바꾼 값이 그대로, 지우면 사라진다", () => {
    useEditorStore.getState().updateEntity(INN.id, { sortPadX: 1.5 });
    expect(byId(INN.id).sortPadX).toBe(1.5);
    useEditorStore.getState().updateEntity(INN.id, { sortPadX: undefined });
    expect(byId(INN.id)).not.toHaveProperty("sortPadX");
  });
});

describe("exportOffset — 정확 산술(1px = 8.75 천분의 일 world)", () => {
  it("저장된 게임 데이터의 값을 그대로 재현한다(.5 경계 포함)", () => {
    expect(exportOffset(0, 10)).toEqual([0, -0.087]); // −87.5 → −87 (Math.round 는 +∞ 쪽)
    expect(exportOffset(0, 11)).toEqual([0, -0.096]);
    expect(exportOffset(0, 15)).toEqual([0, -0.131]);
    expect(exportOffset(0, 17)).toEqual([0, -0.149]);
    expect(exportOffset(-20, 2)).toEqual([-0.175, -0.017]);
    expect(exportOffset(2, 0)).toEqual([0.018, 0]);
  });
  it("둘 다 0(또는 미설정)이면 null", () => {
    expect(exportOffset(undefined, undefined)).toBeNull();
    expect(exportOffset(0, 0)).toBeNull();
  });
});

describe("objectExportScale", () => {
  it("여관 — 네이티브 753px · 배율 0.7 → 0.612(저장값과 같다)", () => {
    expect(objectExportScale(INN, 753)).toBe(0.612);
  });
  it("이미지가 없으면 null(export 는 마지막 값을 둔다)", () => {
    expect(objectExportScale(INN, 0)).toBeNull();
  });
});
