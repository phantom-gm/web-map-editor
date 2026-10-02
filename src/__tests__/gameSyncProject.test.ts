import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../store/editorStore";
import { PROJECT_TYPE, PROJECT_VERSION, parseGameSync, type GameSyncMetadata, type ProjectFileInput } from "../lib/projectIO";
import { toStoredTile, type PaletteTile } from "../lib/palette";
import { emptyLayer } from "../types/blueprint";
import { parseBlueprint } from "../lib/blueprintIO";
import type { MapEntity } from "../types/entity";

const link: GameSyncMetadata = { version: 1, baselineId: "baseline_0123-abcd", mapName: "ferendel" };
const tile = (name: string, ruid: string, px: [number, number] = [64, 32]): PaletteTile => ({
  name, ruid, px, hash: null, category: "foothold", regStatus: "registered", url: "", img: null,
});
const grass = tile("grass", "r-grass");
const road = tile("road", "r-road");
const tiles = [grass, road];

function project(extra: Partial<ProjectFileInput> = {}): ProjectFileInput {
  return {
    type: PROJECT_TYPE, version: PROJECT_VERSION, map: "ferendel", size: [60, 60],
    groundOrigin: [15, -2], ground: [[0, 0, 0], [3, 4, 1], [59, 59, 0]], blocked: [[5, 6]],
    palette: tiles.map(toStoredTile), staticLayer: emptyLayer(), attributeBase: emptyLayer(),
    entities: [], ...extra,
  };
}
const saved = () => JSON.parse(JSON.stringify(useEditorStore.getState().exportProject())) as ProjectFileInput;

beforeEach(() => {
  useEditorStore.getState().newProject();
  useEditorStore.setState({ palette: [] });
});

describe("gameSync project contract", () => {
  it("연결 맵은 첫 바닥 소재를 기본 선택하고 일반/빈 맵은 0을 유지한다", () => {
    useEditorStore.getState().loadProject(project({ gameSync: link, ground: [[2, 3, 1]] }), tiles);
    expect(useEditorStore.getState().activeIdx).toBe(1);
    useEditorStore.getState().loadProject(project({ ground: [[2, 3, 1]] }), tiles);
    expect(useEditorStore.getState().activeIdx).toBe(0);
    useEditorStore.getState().loadProject(project({ gameSync: link, ground: [] }), tiles);
    expect(useEditorStore.getState().activeIdx).toBe(0);
  });
  it("version 2 프로젝트에 선택적으로 저장하고 두 번 열고 저장해도 동일하다", () => {
    const input = project({ gameSync: link });
    useEditorStore.getState().loadProject(input, tiles);
    const first = saved();
    expect(first.version).toBe(2);
    expect(first.gameSync).toEqual(link);
    expect(first.ground).toEqual(input.ground);
    expect(first.groundOrigin).toEqual([15, -2]);
    expect(first.blocked).toEqual(input.blocked);
    useEditorStore.getState().loadProject(first, tiles);
    expect(saved()).toEqual(first);
  });

  it("연결된 오브젝트의 저장된 파생값과 legacy 필드를 자동 수정하지 않는다", () => {
    const object: MapEntity = {
      id: "manual-tree", kind: "object", gx: 2, gy: 3, name: "tree", ruid: "r-tree",
      tilesW: 1, tilesH: 1, offsetY: 15, offset: [0, -0.087], scaleMul: 0.25,
      scale: 0.17, depthW: 4, depthH: 4,
    };
    const legacyPortal = {
      id: "portal", kind: "portal", gx: 5, gy: 5, targetMap: "old-map", targetX: 7, targetY: 8,
    } as unknown as MapEntity;
    const input = project({ gameSync: link, entities: [object, legacyPortal] });
    useEditorStore.getState().loadProject(input, tiles);
    expect(saved().entities).toEqual(input.entities);
    expect(useEditorStore.getState().loadDrift).toEqual([]);
    expect(saved().entities[0]).not.toHaveProperty("baseW");
    useEditorStore.getState().updateEntity(object.id, { offsetY: 9 });
    expect(saved().entities[0].offsetY).toBe(9); // core가 지원 밖 변경을 볼 수 있어야 한다.
    expect(saved().entities[0].offset).toEqual([0, -0.087]);
  });

  it("바닥 변경과 undo/redo가 연결 정보를 유지한다", () => {
    useEditorStore.getState().loadProject(project({ gameSync: link }), tiles);
    const before = saved().ground;
    useEditorStore.setState({ activeIdx: 1 });
    useEditorStore.getState().fillRect(10, 10, 13, 13);
    const painted = saved().ground;
    expect(painted).toHaveLength(before.length + 16);
    expect(saved().gameSync).toEqual(link);
    useEditorStore.getState().undo();
    expect(saved().ground).toEqual(before);
    expect(saved().gameSync).toEqual(link);
    useEditorStore.getState().redo();
    expect(saved().ground).toEqual(painted);
    expect(saved().gameSync).toEqual(link);
  });

  it("일반 프로젝트 열기와 새 프로젝트에서 이전 연결이 남지 않는다", () => {
    useEditorStore.getState().loadProject(project({ gameSync: link }), tiles);
    useEditorStore.getState().loadProject(project({ map: "other" }), tiles);
    expect(saved()).not.toHaveProperty("gameSync");
    useEditorStore.getState().loadProject(project({ gameSync: link }), tiles);
    useEditorStore.getState().newProject();
    expect(saved()).not.toHaveProperty("gameSync");
  });

  it("legacy blueprint를 가져오면 이전 프로젝트 연결을 초기화한다", () => {
    useEditorStore.getState().loadProject(project({ gameSync: link }), tiles);
    useEditorStore.getState().importBlueprint(parseBlueprint({
      map: "legacy", layers: {
        GroundTileMap: { size: [2, 2], origin: [0, 0], palette: ["grass"], cells: [[0, 0, 0]] },
      },
    }));
    expect(saved()).not.toHaveProperty("gameSync");
    expect(saved().map).toBe("legacy");
  });

  it("없는 연결은 허용하되 잘못된 버전/경로/맵 이름은 상태 변경 전에 거부한다", () => {
    expect(parseGameSync(undefined)).toBeUndefined();
    for (const invalid of [
      null, [], { ...link, version: 2 }, { ...link, baselineId: "../outside" },
      { ...link, baselineId: "" }, { ...link, mapName: " " },
    ]) expect(() => parseGameSync(invalid)).toThrow();
    useEditorStore.getState().loadProject(project({ gameSync: link }), tiles);
    const before = saved();
    expect(() => useEditorStore.getState().loadProject(
      project({ map: "wrong", gameSync: link }), tiles,
    )).toThrow("맵 이름");
    expect(saved()).toEqual(before);
  });

  it("기존 v1/v2 일반 프로젝트의 마이그레이션 동작은 유지한다", () => {
    const legacy: MapEntity = { id: "old", kind: "object", gx: 1, gy: 1, tilesW: 3, tilesH: 2 };
    for (const version of [1, 2]) {
      useEditorStore.getState().loadProject(project({ version, entities: [legacy] }), tiles);
      expect(saved().version).toBe(2);
      expect(saved()).not.toHaveProperty("gameSync");
      expect(saved().entities[0].baseW).toBe(3);
    }
  });
});

describe("project palette authority", () => {
  it("동명이더라도 프로젝트 RUID/치수가 권위이며 이전 라이브러리는 별도로 남는다", () => {
    const stale = tile("grass", "r-other", [256, 128]);
    const personal = tile("personal", "r-personal");
    useEditorStore.setState({ palette: [stale, personal] });
    const input = project({ gameSync: link });
    useEditorStore.getState().loadProject(input, tiles);
    expect(saved().ground).toEqual(input.ground); // 프로젝트 index 유지
    expect(saved().palette.slice(0, 2)).toEqual(input.palette);
    expect(saved().palette.slice(2).map(t => t.ruid)).toEqual(["r-other", "r-personal"]);
    expect(useEditorStore.getState().palette[0].ruid).toBe("r-grass");
  });

  it("같은 이름/RUID여도 치수가 다르면 프로젝트 값을 우선하고 이전 항목도 보존한다", () => {
    useEditorStore.setState({ palette: [tile("grass", "r-grass", [128, 64])] });
    useEditorStore.getState().loadProject(project(), tiles);
    expect(saved().palette[0].px).toEqual([64, 32]);
    expect(saved().palette[2].px).toEqual([128, 64]);
  });

  it("동일 팔레트 재열기에서 라이브러리가 중복 증가하지 않는다", () => {
    const personal = tile("personal", "r-personal");
    useEditorStore.setState({ palette: [personal, grass] });
    for (let i = 0; i < 3; i++) useEditorStore.getState().loadProject(project(), tiles);
    expect(saved().palette.map(t => t.ruid)).toEqual(["r-grass", "r-road", "r-personal"]);
    expect(saved().ground).toEqual(project().ground);
  });

  it("서로 다른 맵을 연속 열어도 각 맵의 셀은 해당 프로젝트의 소재를 참조한다", () => {
    useEditorStore.getState().loadProject(project(), tiles);
    const secondTiles = [tile("grass", "r-snow", [96, 48])];
    const second = project({ map: "snow", palette: secondTiles.map(toStoredTile), ground: [[9, 8, 0]] });
    useEditorStore.getState().loadProject(second, secondTiles);
    expect(saved().ground).toEqual([[9, 8, 0]]);
    expect(saved().palette[0].ruid).toBe("r-snow");
    expect(saved().palette.map(t => t.ruid)).toContain("r-grass");
    useEditorStore.getState().loadProject(project(), tiles);
    expect(saved().ground).toEqual(project().ground);
    expect(saved().palette[0].ruid).toBe("r-grass");
    expect(saved().palette.map(t => t.ruid)).toContain("r-snow");
  });

  it("60x60 논리셀을 무변경 재저장해도 셀 수와 좌표/소재가 그대로다", () => {
    const ground = Array.from({ length: 3600 }, (_, n) => [n % 60, Math.floor(n / 60), n % 2] as [number, number, number]);
    useEditorStore.getState().loadProject(project({ gameSync: link, ground }), tiles);
    expect(saved().ground).toEqual(ground);
    expect(saved().ground).toHaveLength(3600);
    expect(JSON.stringify(saved())).not.toContain("data:image");
  });
});

describe("linked ground-only erasing", () => {
  it("eraser removes the floor but preserves collision cells and objects", () => {
    const object: MapEntity = { id: "tree", kind: "object", gx: 5, gy: 6 };
    useEditorStore.getState().loadProject(project({ gameSync: link, ground: [[5, 6, 0]], entities: [object] }), tiles);
    useEditorStore.getState().setTool("eraser");
    useEditorStore.getState().applyTool(5, 6);
    expect(saved().ground).toEqual([]);
    expect(saved().blocked).toEqual([[5, 6]]);
    expect(saved().entities).toEqual([object]);
    useEditorStore.getState().setBlockedAt(5, 6, false); // explicit collision editing is separate from the ground eraser
    expect(saved().blocked).toEqual([]);
  });
  it("clear floor and undo preserve all protected fields", () => {
    const object: MapEntity = { id: "tree", kind: "object", gx: 5, gy: 6 };
    useEditorStore.getState().loadProject(project({ gameSync: link, entities: [object] }), tiles);
    const before = saved();
    useEditorStore.getState().clearAll();
    expect(saved()).toEqual({ ...before, ground: [] });
    useEditorStore.getState().undo();
    expect(saved()).toEqual(before);
  });
});
it("linked paint, save, undo and redo own their dirty state without an App subscription", () => {
  useEditorStore.getState().loadProject(project({ gameSync: link }), tiles);
  useEditorStore.getState().markSaved();
  expect(useEditorStore.getState().dirty).toBe(false);
  useEditorStore.getState().fillRect(10, 10, 10, 10);
  expect(useEditorStore.getState().dirty).toBe(true);
  useEditorStore.getState().markSaved();
  expect(useEditorStore.getState().dirty).toBe(false);
  useEditorStore.getState().undo();
  expect(useEditorStore.getState().dirty).toBe(true);
  useEditorStore.getState().markSaved();
  useEditorStore.getState().redo();
  expect(useEditorStore.getState().dirty).toBe(true);
});