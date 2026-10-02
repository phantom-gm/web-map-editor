import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { useEditorStore } from "../store/editorStore";
import type { PaletteTile } from "../lib/palette";
import type { ProjectFile, ProjectFileInput } from "../lib/projectIO";
import { previewSpriteGeometry, type GamePreviewScene } from "../lib/gamePreview";
import { cellToScreen } from "../lib/grid";

type Counts = { groundCells: number; groundEntities: number; bySize: Record<string, number> };
type SyncReport = {
  counts: Counts; preservedEntities: number; groundEditingSupported: boolean;
  exactMapBytes?: boolean; unchanged?: boolean; sourceFilesUnchanged: boolean;
  datasetsExact?: boolean; gameApplied?: boolean; runtimeVerified?: boolean;
};
interface Core {
  previewEditedProject(project: ProjectFile, options: { gameRoot: string; baselineRoot: string }): GamePreviewScene;
  createSyncProject(options: { gameRoot: string; mapName: string; baselineRoot: string }): {
    project: ProjectFileInput; report: SyncReport; baselineDir: string;
  };
  exportEditedProject(project: ProjectFile, options: { gameRoot: string; baselineRoot: string; outputRoot: string }): {
    report: SyncReport; mapPath: string;
  };
}
const core = createRequire(import.meta.url)("../../scripts/game-sync/core.cjs") as Core;
const gameRoot = process.env.MSW_GAME_SYNC_TEST_ROOT;
const mapNames = ["ferendel", "velos", "ferenforest3"];
// 로컬 실게임 읽기 전용 통합 검증은 명시적으로 켠다. CI/다른 PC에서는 skip 이유가 이름에 표시된다.
const enabled = !!gameRoot && mapNames.every(name => existsSync(join(gameRoot, "map", name + ".map")));
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const memoryTiles = (p: ProjectFileInput): PaletteTile[] => p.palette.map(t => ({
  name: t.name, ruid: t.ruid, px: t.px, category: t.category, regStatus: t.regStatus,
  hash: t.hash ?? null, img: null, url: "",
}));

describe.skipIf(!enabled)("actual game → editor store → candidate (opt in: MSW_GAME_SYNC_TEST_ROOT)", () => {
  let runRoot: string;
  let tempParent: string;
  beforeAll(() => {
    tempParent = realpathSync(tmpdir());
    runRoot = mkdtempSync(join(tempParent, "web-map-editor-store-sync-"));
  });
  afterAll(() => {
    // 재귀 삭제의 절대 대상이 이 테스트가 만든 OS 임시 폴더인지 먼저 검증한다.
    if (!runRoot) return;
    if (dirname(runRoot) !== tempParent || !basename(runRoot).startsWith("web-map-editor-store-sync-")) {
      throw new Error("Unsafe test cleanup path");
    }
    rmSync(runRoot, { recursive: true, force: true });
  });

  for (const mapName of mapNames) {
    it(mapName + ": 무변경 저장은 실맵 바이트/엔티티 수/데이터를 그대로 출력한다", () => {
      const options = {
        gameRoot: gameRoot!, baselineRoot: join(runRoot, "baselines"), outputRoot: join(runRoot, "candidates"),
      };
      const sourceMap = join(gameRoot!, "map", mapName + ".map");
      const sourceProject = join(gameRoot!, "map", mapName + ".json");
      const beforeMap = hash(sourceMap);
      const beforeProject = existsSync(sourceProject) ? hash(sourceProject) : null;
      const synced = core.createSyncProject({ ...options, mapName });
      const incoming = memoryTiles(synced.project);
      useEditorStore.getState().newProject();
      const first = incoming[0];
      // 기존 개인 라이브러리 + 동일 이름의 오래된 RUID/치수가 있어도 원본 프로젝트가 권위다.
      useEditorStore.setState({ palette: [
        { name: "personal-library", ruid: "private-unused", px: [64, 32], img: null, url: "", category: "foothold" },
        ...(first ? [{ ...first, ruid: "stale-ruid", px: [8192, 4096] as [number, number] }] : []),
      ] });
      useEditorStore.getState().loadProject(synced.project, incoming);
      const exported = JSON.parse(JSON.stringify(useEditorStore.getState().exportProject())) as ProjectFile;
      expect(exported.gameSync).toEqual(synced.project.gameSync);
      expect(exported.entities).toEqual(synced.project.entities);
      expect(exported.ground).toEqual(synced.project.ground);
      expect(exported.palette.slice(0, incoming.length).map(t => t.ruid)).toEqual(synced.project.palette.map(t => t.ruid));
      expect(exported.palette.slice(incoming.length).map(t => t.ruid)).toContain("private-unused");

      const scene = core.previewEditedProject(exported, options);
      expect(scene.baselineId).toBe(exported.gameSync?.baselineId);
      expect(scene.constants.TILE_W).toBe(2.56);
      const groundSprites = scene.sprites.filter(sprite => sprite.kind === "ground" && sprite.ground);
      expect(groundSprites).toHaveLength(synced.report.counts.groundEntities);
      for (const sprite of groundSprites) {
        const block = sprite.ground!;
        const cam = { x: 13, y: 29, zoom: 1.5 };
        const geometry = previewSpriteGeometry(sprite, {
          width: block.size * 256, height: block.size * 128, pivot: [0.5, 0.5], pixelsPerUnit: 100,
        }, scene, cam);
        const expected = cellToScreen(block.gx + (block.size - 1) / 2, block.gy + (block.size - 1) / 2, cam);
        expect(geometry.anchor[0]).toBeCloseTo(expected[0], 7);
        expect(geometry.anchor[1]).toBeCloseTo(expected[1], 7);
        expect(geometry.bounds[2] - geometry.bounds[0]).toBeCloseTo(block.size * 64 * cam.zoom, 7);
      }
      const candidate = core.exportEditedProject(exported, options);
      expect(candidate.report.unchanged).toBe(true);
      expect(candidate.report.exactMapBytes).toBe(true);
      expect(candidate.report.counts).toEqual(synced.report.counts);
      expect(candidate.report.sourceFilesUnchanged).toBe(true);
      expect(candidate.report.datasetsExact).toBe(true);
      expect(candidate.report.gameApplied).toBe(false);
      expect(candidate.report.runtimeVerified).toBe(false);
      expect(hash(candidate.mapPath)).toBe(beforeMap);
      expect(hash(sourceMap)).toBe(beforeMap);
      if (beforeProject) expect(hash(sourceProject)).toBe(beforeProject);
      console.log("[store-sync-roundtrip]", JSON.stringify({
        mapName, ...candidate.report.counts, entities: synced.report.preservedEntities,
        exactMapBytes: candidate.report.exactMapBytes, originalGameUnchanged: true,
      }));

      // 저장 산출물을 재열어도 gameSync UUID와 ground-only 계약이 변하지 않는다.
      useEditorStore.getState().loadProject(exported, memoryTiles(exported));
      const reopened = JSON.parse(JSON.stringify(useEditorStore.getState().exportProject())) as ProjectFile;
      expect(reopened).toEqual(exported);
      useEditorStore.setState({ entities: [
        ...useEditorStore.getState().entities,
        { id: "unsupported-extra", kind: "object", gx: 0, gy: 0, ruid: "test", name: "unsupported" },
      ] });
      expect(() => core.exportEditedProject(useEditorStore.getState().exportProject(), options)).toThrow("바닥만 지원");
    }, 60_000);
  }
});
