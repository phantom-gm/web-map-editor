import { beforeEach, describe, expect, it } from "vitest";
import { addGameNpcEdit, npcEditsKey, parseGameNpcEdits, parseGameNpcPatch, parseGameNpcSync,
  removeGameNpcEdit, updateGameNpcEdit, type GameNpcDescriptor, type GameNpcEdits } from "../lib/gameNpc";
import { captureEditorSnapshot, useEditorStore } from "../store/editorStore";
import { emptyLayer } from "../types/blueprint";
import { PROJECT_TYPE, type ProjectFileInput } from "../lib/projectIO";
import type { GamePreviewScene } from "../lib/gamePreview";
import { parseBlueprint } from "../lib/blueprintIO";
const id = "12345678-1234-1234-1234-123456789abc";
const sourceId = "22345678-1234-1234-1234-123456789abc";
const emptyEdits = (): GameNpcEdits => ({version:1,updated:[],removed:[],added:[]});
const addition = () => ({entityId:id,npcClassId:101,cell:[4,4] as [number,number],flipX:false,dialogId:""});
const project = (): ProjectFileInput => ({
  type:PROJECT_TYPE,version:2,map:"fixture",gameSync:{version:1,mapName:"fixture",baselineId:"baseline"},
  size:[8,8],groundOrigin:[0,0],ground:[[0,0,0]],blocked:[[4,4]],palette:[],
  staticLayer:emptyLayer(),attributeBase:emptyLayer(),
  entities:[{id:"legacy",kind:"npc",gx:1,gy:2,npcClassId:101,dialogId:"legacy-preserved"}],
  gameObjectEdits:{version:1,moved:[{entityId:"house",position:[3,4]}],removed:[],added:[]},
});
const npc = (entityId = "fixture_Npc_1", cell:[number,number] = [1,2]):GameNpcDescriptor => ({
  entityId,spawnId:entityId,npcClassId:101,name:"엘드릭",cell,sourceCell:[...cell],
  sourceFlipX:false,sourceDialogId:"base",position:[-1.28,17.28,3.78],
  ruid:"idle",bodyScale:1.2,flipX:false,dialogId:"base",enabled:true,canEdit:true,
});
const state = () => useEditorStore.getState();
const saved = () => state().exportProject();
function scene():GamePreviewScene {
  const edits=state().gameNpcEdits;
  const current=[npc(),npc("fixture_Npc_2",[3,3])].filter(n=>!edits?.removed.includes(n.entityId))
    .map(n=>({...n,...edits?.updated.find(e=>e.entityId===n.entityId)}));
  for(const item of edits?.added??[]) current.push({...npc(item.entityId,item.cell),...item,sourceCell:null,sourceFlipX:null,sourceDialogId:null});
  return {version:1,baselineId:"baseline",mapName:"fixture",groundOrigin:[0,0],
    constants:{TILE_W:2.56,TILE_H:1.28,ORIGIN_X:15,ORIGIN_Y:15,PPU:100,DEPTH_SCALE:0.21875,GROUND_ORDER:0},
    defaultSortingLayer:"Default",sprites:[],warnings:[],npcs:current,
    npcCatalog:[{npcClassId:101,name:"엘드릭",ruid:"idle",bodyScale:1.2,canAdd:true}],
    npcEdits:parseGameNpcEdits(edits)??null,
    npcSource:{sourceId:state().gameNpcSync?.sourceId??null,stale:false,changedFiles:[],refreshAvailable:true}};
}
beforeEach(()=>{state().newProject();useEditorStore.setState({palette:[]});state().loadProject(project(),[]);});

describe("NPC overlay validation",()=>{
  it("keeps old projects and empty overlays unchanged",()=>{
    expect(parseGameNpcEdits(undefined)).toBeUndefined();
    expect(parseGameNpcEdits(emptyEdits())).toBeUndefined();
    expect(saved()).not.toHaveProperty("gameNpcEdits");
    expect(saved()).not.toHaveProperty("gameNpcSync");
  });
  it("copies input cells and does not mutate earlier overlays",()=>{
    const input=addition(), first=addGameNpcEdit(undefined,input);
    input.cell[0]=7;
    expect(first.added[0].cell).toEqual([4,4]);
    const second=updateGameNpcEdit(first,id,{cell:[5,4],flipX:true})!;
    expect(first.added[0].flipX).toBe(false);
    expect(second.updated).toEqual([]);
    expect(second.added[0].cell).toEqual([5,4]);
  });
  it("removes an addition without a tombstone; original removal clears its patch",()=>{
    expect(removeGameNpcEdit(addGameNpcEdit(undefined,addition()),id)).toBeUndefined();
    const changed=updateGameNpcEdit(undefined,"source",{cell:[1,1]});
    const removed=removeGameNpcEdit(changed,"source")!;
    expect(removed).toEqual({...emptyEdits(),removed:["source"]});
    expect(removeGameNpcEdit(removed,"source")).toBe(removed);
    expect(()=>updateGameNpcEdit(removed,"source",{flipX:true})).toThrow();
  });
  it("rejects malformed, conflicting and unsupported edits",()=>{
    const invalid:unknown[]=[null,{}, {...emptyEdits(),version:2},{...emptyEdits(),extra:1},
      {...emptyEdits(),updated:[{entityId:"source",cell:[NaN,1]}]},
      {...emptyEdits(),updated:[{entityId:"source",cell:[1.5,1]}]},
      {...emptyEdits(),updated:[{entityId:"source",cell:[-1,1]}]},
      {...emptyEdits(),updated:[{entityId:"../source",flipX:true}]},
      {...emptyEdits(),updated:[{entityId:"source",flipX:true}],removed:["source"]},
      {...emptyEdits(),added:[{...addition(),entityId:"not-uuid"}]},
      {...emptyEdits(),added:[{...addition(),npcClassId:0}]},
      {...emptyEdits(),added:[{...addition(),bodyScale:3}]},
      {...emptyEdits(),updated:[{entityId:"source",bodyScale:3}]}];
    for(const item of invalid)expect(()=>parseGameNpcEdits(item)).toThrow();
  });
  it("matches backend dialogue ID rules before dirtying the editor",()=>{
    for(const dialogId of ['review,"quoted"',"한글","a b","a\nb","x".repeat(129)]) {
      expect(()=>parseGameNpcPatch({dialogId})).toThrow();
      expect(state().updateGameNpc("fixture_Npc_1",{dialogId},scene())).toBe(false);
      expect(state().dirty).toBe(false);
      expect(state().undoStack).toHaveLength(0);
    }
    expect(parseGameNpcPatch({dialogId:"quest_intro-101"})).toEqual({dialogId:"quest_intro-101"});
    expect(parseGameNpcPatch({dialogId:""})).toEqual({dialogId:""});
  });
  it("validates source snapshot pointers",()=>{
    expect(parseGameNpcSync({version:1,sourceId})).toEqual({version:1,sourceId});
    for(const value of [null,{version:2,sourceId},{version:1,sourceId:"../source"}])expect(()=>parseGameNpcSync(value)).toThrow();
  });
});
describe("NPC edit/store persistence",()=>{
  it("updates cell, flip and dialogue atomically and preserves all other work",()=>{
    const before=saved();
    expect(state().updateGameNpc("fixture_Npc_1",{cell:[2,2],flipX:true,dialogId:"intro"},scene())).toBe(true);
    const after=saved();
    expect(after).toEqual({...before,gameNpcEdits:{...emptyEdits(),updated:[{entityId:"fixture_Npc_1",cell:[2,2],flipX:true,dialogId:"intro"}]}});
    expect(state().undoStack).toHaveLength(1);
    state().markSaved();state().undo();expect(saved()).toEqual(before);expect(state().dirty).toBe(true);
    state().redo();expect(saved()).toEqual(after);
  });
  it("adding from a class works on blocked cells and IDs survive save/reload/undo",()=>{
    const baseline=saved(), added=state().addGameNpc(101,[4,4],scene())!;
    expect(added).toMatch(/^[a-f0-9-]{36}$/);
    expect(state().selectedGameNpcId).toBe(added);
    expect(saved().blocked).toEqual(baseline.blocked);
    const output=saved();
    state().loadProject(output,[]);expect(saved()).toEqual(output);expect(state().selectedGameNpcId).toBeNull();
    expect(state().updateGameNpc(added,{cell:[5,4],flipX:true,dialogId:"new"},scene())).toBe(true);
    expect(saved().gameNpcEdits?.updated).toEqual([]);
    expect(state().removeGameNpc(added,scene())).toBe(true);
    expect(saved()).not.toHaveProperty("gameNpcEdits");
    state().undo();expect(saved().gameNpcEdits?.added[0]).toMatchObject({entityId:added,cell:[5,4],flipX:true});
  });
  it("identical updates make no dirty flag or undo item",()=>{
    const before=saved();
    expect(state().updateGameNpc("fixture_Npc_1",{cell:[1,2],flipX:false,dialogId:"base"},scene())).toBe(true);
    expect(saved()).toEqual(before);expect(state().dirty).toBe(false);expect(state().undoStack).toHaveLength(0);
  });
  it("rejects occupied, out-of-bounds, missing-class and protected operations without partial state",()=>{
    const before=saved();
    expect(state().updateGameNpc("fixture_Npc_1",{cell:[3,3],flipX:true},scene())).toBe(false);
    expect(state().updateGameNpc("fixture_Npc_1",{cell:[8,2]},scene())).toBe(false);
    expect(state().addGameNpc(101,[3,3],scene())).toBeNull();
    expect(state().addGameNpc(999,[4,5],scene())).toBeNull();
    const protectedScene=scene();protectedScene.npcs![0].canEdit=false;
    expect(state().removeGameNpc("fixture_Npc_1",protectedScene)).toBe(false);
    expect(saved()).toEqual(before);expect(state().undoStack).toHaveLength(0);expect(state().dirty).toBe(false);
  });
  it("rejects stale previews after rapid edits, project changes, source drift and source refresh",()=>{
    const previous=scene();
    state().updateGameNpc("fixture_Npc_1",{flipX:true},previous);const before=saved();
    expect(state().removeGameNpc("fixture_Npc_1",previous)).toBe(false);
    const foreign=scene();foreign.baselineId="other";
    expect(state().updateGameNpc("fixture_Npc_1",{cell:[4,5]},foreign)).toBe(false);
    const drift=scene();drift.npcSource!.stale=true;
    expect(state().updateGameNpc("fixture_Npc_1",{cell:[4,5]},drift)).toBe(false);
    const oldSource=scene();oldSource.npcSource!.sourceId=sourceId;
    expect(state().removeGameNpc("fixture_Npc_1",oldSource)).toBe(false);
    expect(saved()).toEqual(before);expect(state().undoStack).toHaveLength(1);
  });
  it("refreshes only the NPC source and restores pointer plus edits with one undo",()=>{
    state().updateGameNpc("fixture_Npc_1",{flipX:true},scene());
    const before=saved(), key=JSON.stringify([state().gameNpcSync??null,npcEditsKey(state().gameNpcEdits)]);
    expect(state().replaceGameNpcSource({version:1,sourceId},"baseline",key)).toBe(true);
    const after=saved();
    expect(after).toEqual({...before,gameNpcSync:{version:1,sourceId},gameNpcEdits:undefined});
    expect(Object.keys(after)).not.toContain("gameNpcEdits");
    state().undo();expect(saved()).toEqual(before);state().redo();expect(saved()).toEqual(after);
    state().loadProject(after,[]);expect(saved()).toEqual(after);
  });
  it("does not install a late source response over newer NPC work",()=>{
    const key=JSON.stringify([null,npcEditsKey(undefined)]);
    state().updateGameNpc("fixture_Npc_1",{flipX:true},scene());const before=saved();
    expect(state().replaceGameNpcSource({version:1,sourceId},"baseline",key)).toBe(false);
    expect(saved()).toEqual(before);
  });
  it("validates loaded NPC metadata before replacing current state",()=>{
    state().updateGameNpc("fixture_Npc_1",{flipX:true},scene());const before=saved();
    expect(()=>state().loadProject({...project(),gameSync:undefined,gameNpcEdits:before.gameNpcEdits},[])).toThrow();
    expect(()=>state().loadProject({...project(),gameNpcSync:{version:1,sourceId:"bad"}},[])).toThrow();
    expect(saved()).toEqual(before);
  });
  it("selection never dirties and is mutually exclusive with object/cell selection",()=>{
    state().selectGameObject("house");state().selectGameNpc("fixture_Npc_1");
    expect(state().selectedGameObjectIds).toEqual([]);expect(state().selectedBlockedCells).toEqual([]);
    state().selectBlockedCells(["4,4"]);expect(state().selectedGameNpcId).toBeNull();
    state().selectGameNpc("fixture_Npc_1");state().selectGameObjects(["house"]);expect(state().selectedGameNpcId).toBeNull();
    expect(state().dirty).toBe(false);expect(state().undoStack).toHaveLength(0);
    state().selectGameNpc("fixture_Npc_1");state().addGameObject("house",[5,5]);expect(state().selectedGameNpcId).toBeNull();
  });
  it("keeps NPC edits in ordinary ground stroke history",()=>{
    state().updateGameNpc("fixture_Npc_1",{flipX:true},scene());const before=saved();
    const snap=captureEditorSnapshot(state());state().setTool("brush");state().applyTool(5,5);state().commitStroke(snap);
    state().undo();expect(saved()).toEqual(before);
  });
  it("clears NPC overlays/source/selection on legacy load, blueprint import and new project",()=>{
    const withNpcs={...project(),gameNpcSync:{version:1 as const,sourceId},gameNpcEdits:{...emptyEdits(),removed:["fixture_Npc_1"]}};
    for(const reset of [
      ()=>state().loadProject({...project(),gameSync:undefined,gameObjectEdits:undefined},[]),
      ()=>state().importBlueprint(parseBlueprint({map:"plain",layers:{GroundTileMap:{size:[2,2],origin:[0,0],palette:[],cells:[]}}})),
      ()=>state().newProject(),
    ]) {
      state().loadProject(withNpcs,[]);state().selectGameNpc("fixture_Npc_2");reset();
      expect(state().gameNpcEdits).toBeUndefined();expect(state().gameNpcSync).toBeUndefined();
      expect(state().selectedGameNpcId).toBeNull();expect(state().gameNpcError).toBeNull();
    }
  });
});
