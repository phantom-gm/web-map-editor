import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { GameNpcEdits } from "../lib/gameNpc";

const requireCjs = createRequire(import.meta.url);
type Files = Record<string, { relative: string; bytes: Buffer }>;
interface Profile { supported: boolean; dialogGroups: string[]; dialogGroupsAvailable: boolean }
interface NpcModule {
  analyzeNpcs(files: Files, mapName: string): Profile;
  inspectNpcs(project: { size: number[]; blocked: number[][]; ground: number[][]; gameNpcEdits?: GameNpcEdits }, profile: Profile, constants: Record<string, number>): {
    edited: number; descriptors: { entityId: string; dialogId: string; cell: number[] }[];
  };
  sourceDrift(profile: Profile, files: Files): string[];
}
const npc = requireCjs("../../scripts/game-sync/npcs.cjs") as NpcModule;
const constants = { ORIGIN_X: 15, ORIGIN_Y: 15, TILE_W: 2.56, TILE_H: 1.28, DEPTH_SCALE: .21875 };
const addedId = "c761e2c4-8147-4ae9-9525-12bb39ed308f";
function source(dialog = "historical_missing", quest: string | null = "SequenceGroupID,SequenceOrder,Text\r\n30020,1,Hello\r\n30020,2,Next\r\n10100,1,Welcome\r\n") {
  const csv: Record<string, string> = {
    DT_NpcSpawn: "NpcSpawnID,MapName,NpcClassID,CellX,CellY,Enabled,Scale,FlipX,DialogID\r\nN1,fixture,101,1,1,True,1,False," + dialog + "\r\n",
    DT_NpcClass: "NpcClassID,NpcName,NpcAppearanceID,BodyScale\r\n101,NAME,9101,1.2\r\n",
    DT_NpcAppearance: "NpcAppearanceID,Action,BaseDir,Ruid\r\n9101,Idle,SE," + "1".repeat(32) + "\r\n",
    ...(quest === null ? {} : { DT_QuestSequence: quest }),
  };
  return Object.fromEntries(Object.entries(csv).map(([key, text]) => [key, { relative: "tables/" + key + ".csv", bytes: Buffer.from(text) }]));
}
const patch = (dialogId: string): GameNpcEdits => ({ version: 1, updated: [{ entityId: "N1", dialogId }], added: [], removed: [] });
const project = (gameNpcEdits?: GameNpcEdits) => ({ size: [8,8], ground: [], blocked: [], gameNpcEdits });

describe("NPC dialogue groups from the immutable quest source", () => {
  it("deduplicates actual group IDs and accepts a known changed group or empty default", () => {
    const profile = npc.analyzeNpcs(source(), "fixture");
    expect(profile.supported).toBe(true); expect(profile.dialogGroupsAvailable).toBe(true);
    expect(profile.dialogGroups).toEqual(["10100", "30020"]);
    for (const id of ["30020", ""]) expect(npc.inspectNpcs(project(patch(id)), profile, constants).descriptors[0].dialogId).toBe(id);
  });
  it("rejects unknown newly assigned groups on both updates and additions", () => {
    const profile = npc.analyzeNpcs(source(), "fixture");
    expect(() => npc.inspectNpcs(project(patch("unknown_new")), profile, constants)).toThrow(/목록에 없는/);
    const addition: GameNpcEdits = { version: 1, updated: [], removed: [], added: [{ entityId: addedId, npcClassId: 101, cell: [2,2], flipX: false, dialogId: "unknown_new" }] };
    expect(() => npc.inspectNpcs(project(addition), profile, constants)).toThrow(/목록에 없는/);
    addition.added[0].dialogId = "10100";
    expect(npc.inspectNpcs(project(addition), profile, constants).descriptors.find(n => n.entityId === addedId)?.dialogId).toBe("10100");
  });
  it("preserves an unregistered original group during no-op, explicit unchanged patch and unrelated movement", () => {
    const profile = npc.analyzeNpcs(source("old legacy!"), "fixture");
    expect(npc.inspectNpcs(project(), profile, constants).edited).toBe(0);
    expect(npc.inspectNpcs(project(patch("old legacy!")), profile, constants).edited).toBe(0);
    const moved = patch("old legacy!"); moved.updated[0].cell = [2,3];
    expect(npc.inspectNpcs(project(moved), profile, constants).descriptors[0]).toMatchObject({ dialogId: "old legacy!", cell: [2,3] });
  });
  it.each([null, "WrongColumn\nvalue\n"])("missing or malformed optional catalog keeps old NPCs usable: %s", quest => {
    const profile = npc.analyzeNpcs(source("legacy", quest), "fixture");
    expect(profile.supported).toBe(true); expect(profile.dialogGroupsAvailable).toBe(false);
    expect(npc.inspectNpcs(project(patch("legacy")), profile, constants).edited).toBe(0);
    expect(npc.inspectNpcs(project(patch("")), profile, constants).descriptors[0].dialogId).toBe("");
    expect(() => npc.inspectNpcs(project(patch("30020")), profile, constants)).toThrow(/목록을 읽을 수 없습니다/);
  });
  it("flags a current source group deletion for candidate and review stale checks", () => {
    const baseline = source("30020"), profile = npc.analyzeNpcs(baseline, "fixture");
    const current = { ...baseline, DT_QuestSequence: { ...baseline.DT_QuestSequence, bytes: Buffer.from("SequenceGroupID,SequenceOrder,Text\r\n10100,1,Welcome\r\n") } };
    expect(npc.sourceDrift(profile, baseline)).toEqual([]);
    expect(npc.sourceDrift(profile, current)).toEqual(["tables/DT_QuestSequence.csv"]);
  });
});
