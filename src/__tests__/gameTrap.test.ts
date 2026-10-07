import {describe,it,expect} from "vitest";
import {parseGameTrapEdits,parseRuntimeProject,runtimeEditsKey,updateRuntimeEdit,removeRuntimeEdit} from "../lib/gameRuntime";
import {gameRuntimeHit,sceneWithRuntimeDraft,trapPolygon} from "../lib/gameRuntimePreview";
import type {GamePreviewScene} from "../lib/gamePreview";
import {useEditorStore} from "../store/editorStore";
import {emptyLayer} from "../types/blueprint";
const id="12345678-1234-4321-abcd-123456789012";
describe("game traps",()=>{
 it("retains traps through project serialization and edit keys",()=>{const edits={version:1,updated:[{entityId:"valley_coma",maxCell:[22,8]}],removed:[],added:[]};const p=parseRuntimeProject({gameTrapEdits:edits as never});expect(JSON.parse(JSON.stringify(p)).gameTrapEdits).toEqual(edits);expect(runtimeEditsKey(p)).not.toBe(runtimeEditsKey({}));});
 it("validates patch fields, duplicates and added effect requirements",()=>{expect(()=>parseGameTrapEdits({version:1,updated:[{entityId:"T",cell:[.5,1]}],removed:[],added:[]})).toThrow();expect(()=>parseGameTrapEdits({version:1,updated:[{entityId:"T",abnormalityId:1011}],removed:["T"],added:[]})).toThrow();expect(()=>parseGameTrapEdits({version:1,updated:[],removed:[],added:[{entityId:id,cell:[1,1],maxCell:[2,2]}]})).toThrow();});
 it("updates and removes new traps without leaving a CSV deletion",()=>{const e={version:1 as const,updated:[],removed:[],added:[{entityId:id,cell:[1,1] as [number,number],maxCell:[2,2] as [number,number],abnormalityId:1011}]};expect(updateRuntimeEdit(e,id,{maxCell:[3,3]}).added[0].maxCell).toEqual([3,3]);expect(removeRuntimeEdit(e,id)).toBeUndefined();});
 const scene={baselineId:id,mapName:"test",constants:{TILE_W:2.56,TILE_H:1.28,ORIGIN_X:15,ORIGIN_Y:15,PPU:100,DEPTH_SCALE:.21875,GROUND_ORDER:-1000},groundOrigin:[0,0],sprites:[],traps:[{entityId:"T",trapId:"T",name:"코마",cell:[2,3],maxCell:[4,6],abnormalityId:1011,position:[-1.28,16,3.5],sourceCell:[2,3],source:null,canEdit:true}]} as GamePreviewScene;
 it("selects inclusive cells and translates the complete rectangle",()=>{const camera={x:0,y:0,zoom:1},poly=trapPolygon([2,3],[4,6],scene,camera),center=[poly.reduce((s,p)=>s+p[0],0)/4,poly.reduce((s,p)=>s+p[1],0)/4];expect(gameRuntimeHit(center[0],center[1],scene,new Map(),camera,"trap")).toEqual({kind:"trap",entityId:"T"});expect(gameRuntimeHit(99999,99999,scene,new Map(),camera,"trap")).toBeNull();const moved=sceneWithRuntimeDraft(scene,{kind:"trap",entityId:"T"},[3,5]);expect(moved.traps![0].maxCell).toEqual([5,8]);expect(scene.traps![0].maxCell).toEqual([4,6]);});
 it("stores range edits, rejects stale echoes and restores history without altering other map data",()=>{
  const state=()=>useEditorStore.getState();state().newProject();state().loadProject({type:"web-map-editor-project",version:2,map:"test",size:[20,20],groundOrigin:[0,0],ground:[],blocked:[[1,1]],palette:[],staticLayer:emptyLayer(),attributeBase:emptyLayer(),entities:[],gameSync:{version:1,baselineId:id,mapName:"test"}},[]);
  const base={...scene,monsters:[],portals:[],trapEditingSupported:true,trapCatalog:[{abnormalityId:1011,name:"코마",durationMs:25000,canAdd:true,isComa:true}],runtimeSource:{sourceId:null,stale:false,changedFiles:[],refreshAvailable:true},runtimeEdits:{monsters:null,portals:null,spawn:null,traps:null}};
  expect(state().updateGameTrap("T",{maxCell:[5,7]},base)).toBe(true);expect(state().exportProject().gameTrapEdits?.updated[0].maxCell).toEqual([5,7]);
  expect(state().updateGameTrap("T",{maxCell:[6,7]},base)).toBe(false);expect(state().exportProject().blocked).toEqual([[1,1]]);
  state().undo();expect(state().gameTrapEdits).toBeUndefined();state().redo();expect(state().gameTrapEdits?.updated[0].maxCell).toEqual([5,7]);state().newProject();
 });
});
