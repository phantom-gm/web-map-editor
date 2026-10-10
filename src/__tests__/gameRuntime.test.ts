import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore, captureEditorSnapshot } from "../store/editorStore";
import { parseGameMonsterEdits, parseGamePortalEdits, parseGameSpawnEdits, parseMonsterPatch, parsePortalPatch, parseGameRuntimeSync, runtimeSourceKey, type MonsterFields, type PortalFields } from "../lib/gameRuntime";
import { gameRuntimeHit, sceneWithRuntimeDraft } from "../lib/gameRuntimePreview";
import { previewWorldToScreen } from "../lib/gamePreview";
import { emptyLayer } from "../types/blueprint";
import { PROJECT_TYPE, type ProjectFile } from "../lib/projectIO";
import type { GamePreviewScene } from "../lib/gamePreview";
const sourceId="22345678-1234-1234-1234-123456789abc";
const addId="32345678-1234-1234-1234-123456789abc";
const monster:MonsterFields={monsterClassId:1,cell:[1,1],count:4,spread:2,respawnMinSec:30,respawnMaxSec:60,firstSpawnSec:0,enabled:true};
const portal:PortalFields={cell:[2,2],destMap:"other",destCell:[1,1],destFacing:"SE",enabled:true};
const state=()=>useEditorStore.getState(),saved=()=>state().exportProject();
const empty=()=>({version:1 as const,updated:[],removed:[],added:[]});
it("hidden runtime badges cannot steal clicks; visible or selected badges remain selectable", () => {
  const s = { ...scene(), sprites: [], monsters: [], spawn: null, traps: [] } as GamePreviewScene;
  const portal = s.portals![0], camera = { x: 0, y: 0, zoom: 1 };
  const [x, y] = previewWorldToScreen(portal.position, s, camera);
  const selected = { kind: "portal" as const, entityId: portal.entityId };
  expect(gameRuntimeHit(x, y - 10, s, new Map(), camera, null, false)).toBeNull();
  expect(gameRuntimeHit(x, y - 10, s, new Map(), camera, null, true)).toEqual(selected);
  expect(gameRuntimeHit(x, y - 10, s, new Map(), camera, null, false, selected)).toEqual(selected);
});
const project=():ProjectFile=>({
  type:PROJECT_TYPE,version:2,map:"fixture",gameSync:{version:1,baselineId:"baseline",mapName:"fixture"},
  size:[8,8],groundOrigin:[0,0],ground:[],blocked:[[4,4]],palette:[],
  entities:[{id:"old",kind:"monster",gx:0,gy:0,npcClassId:9}],staticLayer:emptyLayer(),attributeBase:emptyLayer(),
  gameNpcEdits:{version:1,updated:[{entityId:"npc",flipX:true}],removed:[],added:[]},
  gameObjectEdits:{version:1,moved:[{entityId:"house",position:[3,4]}],removed:[],added:[]},
});
function scene():GamePreviewScene {
  const s=state(),m=s.gameMonsterEdits,p=s.gamePortalEdits;
  const monsters=[{...monster,entityId:"m1",spawnId:"m1",name:"곰",ruid:"bear",bodyScale:1.2,position:[0,18,3] as [number,number,number],sourceCell:[1,1] as [number,number],source:{...monster},canEdit:true}]
    .filter(row=>!m?.removed.includes(row.entityId)).map(row=>({...row,...m?.updated.find(e=>e.entityId===row.entityId)}));
  const portals=[{...portal,entityId:"p1",portalId:"p1",position:[0,17,3] as [number,number,number],sourceCell:[2,2] as [number,number],source:{...portal},canEdit:true}]
    .filter(row=>!p?.removed.includes(row.entityId)).map(row=>({...row,...p?.updated.find(e=>e.entityId===row.entityId)}));
  for(const row of m?.added??[])monsters.push({...row,spawnId:row.entityId,name:"곰",ruid:"bear",bodyScale:1.2,position:[0,0,0],sourceCell:row.cell,source:monster,canEdit:true});
  for(const row of p?.added??[])portals.push({...row,portalId:row.entityId,position:[0,0,0],sourceCell:row.cell,source:portal,canEdit:true});
  const bounds={minX:0,minY:0,maxX:7,maxY:7};
  return {version:1,baselineId:"baseline",mapName:"fixture",groundOrigin:[0,0],
    constants:{TILE_W:2.56,TILE_H:1.28,ORIGIN_X:15,ORIGIN_Y:15,PPU:100,DEPTH_SCALE:.21875,GROUND_ORDER:0},
    defaultSortingLayer:"Default",sprites:[],warnings:[],monsters,portals,
    spawn:{cell:s.gameSpawnEdits?.cell??[3,3],sourceCell:[3,3],position:[0,15,3],bounds,canEdit:true},
    monsterCatalog:[{monsterClassId:1,name:"곰",ruid:"bear",bodyScale:1.2,canAdd:true}],
    mapDestinations:[{mapName:"fixture",bounds,spawnCell:[3,3],canTarget:true,blocked:[[4,4]]},{mapName:"other",bounds,spawnCell:[1,1],canTarget:true,blocked:[[5,5]]}],
    runtimeEdits:{monsters:m??null,portals:p??null,spawn:s.gameSpawnEdits??null},
    runtimeSource:{sourceId:s.gameRuntimeSync?.sourceId??null,stale:false,changedFiles:[],refreshAvailable:true}};
}
beforeEach(()=>{state().newProject();useEditorStore.setState({palette:[]});state().loadProject(project(),[]);});

describe("runtime schema contracts",()=>{
  it("keeps absent and empty sparse overlays absent",()=>{
    expect(parseGameMonsterEdits(undefined)).toBeUndefined();expect(parseGamePortalEdits(empty())).toBeUndefined();
    expect(parseGameSpawnEdits(undefined)).toBeUndefined();expect(parseGameRuntimeSync(undefined)).toBeUndefined();
  });
  it("rejects malformed source pointers and non-schema fields",()=>{
    expect(parseGameRuntimeSync({version:1,sourceId})).toEqual({version:1,sourceId});
    expect(()=>parseGameRuntimeSync({version:1,sourceId:"../escape"})).toThrow();
    expect(()=>parseMonsterPatch({flipX:true})).toThrow();
    expect(()=>parsePortalPatch({ruid:"override"})).toThrow();
    expect(()=>parseGameSpawnEdits({version:1,cell:[2,2],remove:true})).toThrow();
  });
  it("validates integer cells, class/count/radius and runtime timing limits",()=>{
    for(const patch of [{cell:[1.5,1]},{cell:[-1,1]},{monsterClassId:0},{count:0},{count:201},{spread:2.5},{firstSpawnSec:NaN},{respawnMinSec:-1},{respawnMaxSec:31536001}])expect(()=>parseMonsterPatch(patch)).toThrow();
    expect(parseMonsterPatch({respawnMinSec:30,respawnMaxSec:0})).toEqual({respawnMinSec:30,respawnMaxSec:0});
    expect(parseMonsterPatch({respawnMinSec:30,respawnMaxSec:10})).toEqual({respawnMinSec:30,respawnMaxSec:10});
    expect(()=>parsePortalPatch({destFacing:"N"})).toThrow();expect(()=>parsePortalPatch({destMap:"../other"})).toThrow();
  });
  it("rejects ID conflicts and partial additions; copies cell arrays",()=>{
    const input={...empty(),added:[{entityId:addId,...monster}]};
    const result=parseGameMonsterEdits(input)!;input.added[0].cell=[6,6];expect(result.added[0].cell).toEqual([1,1]);
    expect(()=>parseGameMonsterEdits({...empty(),added:[{entityId:addId,cell:[1,1]}]})).toThrow();
    expect(()=>parseGamePortalEdits({...empty(),updated:[{entityId:"p1",enabled:false}],removed:["p1"]})).toThrow();
  });
});
describe("runtime atomic editing and persistence",()=>{
  it("edits all three independently and undoes chronological actions without changing other work",()=>{
    const before=saved();
    expect(state().updateGameMonster("m1",{cell:[2,1],count:8,respawnMinSec:40,firstSpawnSec:2},scene())).toBe(true);
    const afterMonster=saved();
    expect(state().updateGamePortal("p1",{cell:[3,2],destFacing:"NW"},scene())).toBe(true);const afterPortal=saved();
    expect(state().setGameSpawn([6,6],scene())).toBe(true);const after=saved();
    expect(state().undoStack).toHaveLength(3);
    expect(after.entities).toEqual(before.entities);expect(after.gameNpcEdits).toEqual(before.gameNpcEdits);expect(after.gameObjectEdits).toEqual(before.gameObjectEdits);expect(after.blocked).toEqual(before.blocked);
    state().markSaved();state().undo();expect(saved()).toEqual(afterPortal);expect(state().dirty).toBe(true);
    state().undo();expect(saved()).toEqual(afterMonster);state().undo();expect(saved()).toEqual(before);
    state().redo();state().redo();state().redo();expect(saved()).toEqual(after);
    state().loadProject(JSON.parse(JSON.stringify(after)),[]);expect(saved()).toEqual(after);expect(state().selectedGameRuntime).toBeNull();
  });
  it("moves and removes additions without leaving tombstones",()=>{
    const id=state().addGameMonster(1,[4,3],scene())!;expect(id).toMatch(/^[a-f0-9-]{36}$/);
    expect(state().updateGameMonster(id,{cell:[4,5],count:2},scene())).toBe(true);
    expect(saved().gameMonsterEdits?.updated).toEqual([]);
    expect(state().removeGameMonster(id,scene())).toBe(true);expect(saved().gameMonsterEdits).toBeUndefined();
    const pid=state().addGamePortal({...portal,cell:[6,1]},scene())!;expect(pid).toMatch(/^[a-f0-9-]{36}$/);
    expect(state().updateGamePortal(pid,{cell:[6,2]},scene())).toBe(true);
    expect(state().removeGamePortal(pid,scene())).toBe(true);expect(saved().gamePortalEdits).toBeUndefined();
  });
  it("allows monster anchor overlap/blocked and object-floor startpoints without ground cells",()=>{
    expect(state().addGameMonster(1,[1,1],scene())).toBeTruthy();
    expect(state().updateGameMonster("m1",{cell:[4,4]},scene())).toBe(true);
    expect(state().ground.size).toBe(0);expect(state().setGameSpawn([6,6],scene())).toBe(true);
  });
  it("rejects invalid class/spread/count, blocked/OOB start, duplicate portal and blocked destinations atomically",()=>{
    const before=saved();
    expect(state().addGameMonster(999,[2,2],scene())).toBeNull();
    for(const patch of [{count:201},{spread:9},{cell:[8,8] as [number,number]}])expect(state().updateGameMonster("m1",patch,scene())).toBe(false);
    expect(state().setGameSpawn([4,4],scene())).toBe(false);expect(state().setGameSpawn([8,3],scene())).toBe(false);
    expect(state().addGamePortal({...portal},scene())).toBeNull();
    expect(state().updateGamePortal("p1",{cell:[4,4]},scene())).toBe(false);
    expect(state().updateGamePortal("p1",{destCell:[5,5]},scene())).toBe(false);
    expect(state().updateGamePortal("p1",{destMap:"fixture",destCell:[4,4]},scene())).toBe(false);
    expect(saved()).toEqual(before);expect(state().undoStack).toHaveLength(0);expect(state().dirty).toBe(false);
  });
  it("checks spawn and active monster availability against NPC cells before committing",()=>{
    const current=scene();
    current.npcs=[{entityId:"npc",spawnId:"npc",npcClassId:1,name:"NPC",cell:[6,6],sourceCell:[6,6],position:[0,0,0],ruid:"npc",bodyScale:1,flipX:false,dialogId:"",enabled:true,sourceFlipX:false,sourceDialogId:"",canEdit:true}];
    current.npcEdits=state().gameNpcEdits??null;
    const before=saved();
    expect(state().setGameSpawn([6,6],current)).toBe(false);
    expect(state().addGameMonster(1,[6,6],current)).toBeNull();
    expect(state().addGameMonster(1,[4,4],current)).toBeNull();
    expect(saved()).toEqual(before);expect(state().undoStack).toHaveLength(0);
  });
  it("allows disabled portal storage on blocked cells but rejects enabling it there",()=>{
    expect(state().updateGamePortal("p1",{enabled:false,cell:[4,4],destCell:[5,5]},scene())).toBe(true);
    const before=saved();expect(state().updateGamePortal("p1",{enabled:true},scene())).toBe(false);
    expect(saved()).toEqual(before);expect(state().undoStack).toHaveLength(1);
  });
  it("keeps identical original values as no-op even when original placement is exceptional",()=>{
    const exceptional=scene();exceptional.portals![0].cell=[4,4];exceptional.portals![0].destCell=[5,5];
    expect(state().updateGamePortal("p1",{cell:[4,4],destCell:[5,5]},exceptional)).toBe(true);
    expect(state().dirty).toBe(false);expect(state().undoStack).toHaveLength(0);
  });
  it("has no dirty/history for identical values and collapses restored startpoint",()=>{
    expect(state().updateGameMonster("m1",{cell:[1,1],count:4},scene())).toBe(true);
    expect(state().updateGamePortal("p1",{cell:[2,2],destFacing:"SE"},scene())).toBe(true);
    expect(state().setGameSpawn([3,3],scene())).toBe(true);
    expect(state().dirty).toBe(false);expect(state().undoStack).toHaveLength(0);
    state().setGameSpawn([6,6],scene());state().setGameSpawn([3,3],scene());expect(state().gameSpawnEdits).toBeUndefined();
  });
  it("rejects stale scene across domains and after changed source or baseline",()=>{
    const stale=scene();state().updateGameMonster("m1",{count:5},stale);const before=saved();
    expect(state().setGameSpawn([6,6],stale)).toBe(false);
    const drift=scene();drift.runtimeSource!.stale=true;expect(state().removeGamePortal("p1",drift)).toBe(false);
    const other=scene();other.baselineId="other";expect(state().removeGameMonster("m1",other)).toBe(false);
    const source=scene();source.runtimeSource!.sourceId=sourceId;expect(state().setGameSpawn([6,6],source)).toBe(false);
    expect(saved()).toEqual(before);expect(state().undoStack).toHaveLength(1);
  });
  it("rejects capability restrictions without partial state",()=>{
    const locked=scene(),before=saved();locked.monsters![0].canEdit=false;locked.portals![0].canEdit=false;locked.spawn!.canEdit=false;
    expect(state().removeGameMonster("m1",locked)).toBe(false);expect(state().removeGamePortal("p1",locked)).toBe(false);expect(state().setGameSpawn([6,6],locked)).toBe(false);expect(saved()).toEqual(before);
  });
  it("refresh is one undo for the source plus all three overlays and preserves NPC/object/floor work",()=>{
    state().updateGameMonster("m1",{count:7},scene());state().updateGamePortal("p1",{destFacing:"NW"},scene());state().setGameSpawn([6,6],scene());
    const before=saved(),length=state().undoStack.length;
    expect(state().replaceGameRuntimeSource({version:1,sourceId},"baseline",runtimeSourceKey(state()))).toBe(true);
    expect(state().undoStack).toHaveLength(length+1);expect(state().gameRuntimeSync?.sourceId).toBe(sourceId);
    expect(state().gameMonsterEdits).toBeUndefined();expect(state().gamePortalEdits).toBeUndefined();expect(state().gameSpawnEdits).toBeUndefined();
    expect(saved().gameNpcEdits).toEqual(before.gameNpcEdits);state().undo();expect(saved()).toEqual(before);
  });
  it("rejects late source refresh, malformed project load, and metadata without linked source",()=>{
    const key=runtimeSourceKey(state());state().updateGameMonster("m1",{count:8},scene());const before=saved();
    expect(state().replaceGameRuntimeSource({version:1,sourceId},"baseline",key)).toBe(false);
    expect(()=>state().loadProject({...project(),gameRuntimeSync:{version:1,sourceId:"bad"}},[])).toThrow();
    expect(()=>state().loadProject({...project(),gameSync:undefined,gameNpcEdits:undefined,gameObjectEdits:undefined,gameMonsterEdits:before.gameMonsterEdits},[])).toThrow();
    expect(saved()).toEqual(before);
  });
  it("selection is session-only and mutually exclusive; new and legacy loads clear metadata",()=>{
    const before=saved();state().selectGameRuntime({kind:"monster",entityId:"m1"});expect(state().dirty).toBe(false);expect(saved()).toEqual(before);
    state().selectGameNpc("npc");expect(state().selectedGameRuntime).toBeNull();state().selectGameRuntime({kind:"spawn",entityId:"fixture"});expect(state().selectedGameNpcId).toBeNull();
    state().selectGameObjects(["house"]);expect(state().selectedGameRuntime).toBeNull();
    state().updateGameMonster("m1",{count:8},scene());state().newProject();expect(state().gameMonsterEdits).toBeUndefined();expect(state().gameRuntimeSync).toBeUndefined();expect(state().selectedGameRuntime).toBeNull();
  });
  it("preserves runtime edits in other tools' undo snapshots",()=>{
    state().updateGameMonster("m1",{count:8},scene());const before=saved();
    const snap=captureEditorSnapshot(state());state().setBlockedAt(6,6,true);state().commitStroke(snap);state().undo();expect(saved()).toEqual(before);
  });
});
describe("runtime drag geometry",()=>{
  it("changes only the selected spawn or actor by iso cell delta and native depth",()=>{
    const original=scene(),draft=sceneWithRuntimeDraft(original,{kind:"monster",entityId:"m1"},[3,2]);
    expect(original.monsters![0].cell).toEqual([1,1]);expect(draft.monsters![0].cell).toEqual([3,2]);
    expect(draft.monsters![0].position[0]).toBeCloseTo(1.28);expect(draft.monsters![0].position[1]).toBeCloseTo(18-1.92);
    expect(draft.monsters![0].position[2]).toBeCloseTo(3-1.92*.21875);
    expect(draft.portals).toBe(original.portals);expect(draft.spawn).toBe(original.spawn);
    const spawn=sceneWithRuntimeDraft(original,{kind:"spawn",entityId:"fixture"},[4,4]);
    expect(spawn.spawn!.cell).toEqual([4,4]);expect(spawn.monsters).toBe(original.monsters);
  });
});
