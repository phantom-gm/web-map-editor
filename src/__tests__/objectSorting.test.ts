import { beforeEach, expect, it } from "vitest";
import { parseGameObjectEdits, setGameObjectSorting } from "../lib/gameObjects";
import { currentGameObjects, planGameSelectionTransform } from "../lib/gameSelection";
import { useEditorStore } from "../store/editorStore";
import type { GamePreviewScene } from "../lib/gamePreview";
import type { ObjectSortSetting } from "../lib/objectSorting.cjs";
import { sceneWithObjectDraft } from "../lib/gameObjectPreview";

const floor: ObjectSortSetting = {mode:"floor",offset:[-1,0],size:[3,2],bounds:[7,5],padX:0};
const objects = ["table", "prop"].map((id,i) => ({entityId:id,prototypeId:id,spriteId:id,name:id,ruid:id,
  position:[i, i, i] as [number,number,number],sourcePosition:[i,i,i] as [number,number,number],canMove:true,canDelete:true,canDuplicate:true,
  sortInfo:{order:0,footprint:[0,0,1,1] as [number,number,number,number],bounds:[7,5] as [number,number],padX:0}}));
const scene = (): GamePreviewScene => ({version:1,baselineId:"sorting",mapName:"test",groundOrigin:[0,0],defaultSortingLayer:"Default",warnings:[],
  constants:{TILE_W:2.56,TILE_H:1.28,ORIGIN_X:15,ORIGIN_Y:15,PPU:100,DEPTH_SCALE:.21875,GROUND_ORDER:-1000},
  objects:structuredClone(objects),objectPrototypes:structuredClone(objects),sprites:[]});
const state=()=>useEditorStore.getState();
beforeEach(()=>{state().newProject();useEditorStore.setState({gameSync:{version:1,baselineId:"sorting",mapName:"test"},gameObjectEdits:undefined});});
it("serializes sorting alone, restores original by clearing it, and rejects corrupt bounds and self support",()=>{
  const saved=setGameObjectSorting(undefined,"table",floor)!;
  expect(parseGameObjectEdits(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  expect(setGameObjectSorting(saved,"table")).toBeUndefined();
  for(const setting of [{...floor,size:[0,2]},{...floor,bounds:[NaN,5]},{mode:"surface",supportId:"table"}])
    expect(()=>setGameObjectSorting(undefined,"table",setting as ObjectSortSetting)).toThrow();
});
it("sorting uses one undo step and survives redo and project serialization",()=>{
  state().sortGameObject("table",floor,scene());
  expect(state().exportProject().gameObjectEdits?.sorting?.[0].setting).toEqual(floor);
  state().undo();expect(state().gameObjectEdits).toBeUndefined();
  state().redo();expect(state().gameObjectEdits?.sorting?.[0].setting).toEqual(floor);
});
function linked() {
  const s=scene();
  let edits=setGameObjectSorting(undefined,"table",floor);
  const surface: ObjectSortSetting={mode:"surface",supportId:"table"};
  edits=setGameObjectSorting(edits,"prop",surface);
  s.objects![0].sortSetting=floor;s.objects![1].sortSetting=surface;s.objects![1].position[2]=-.0001;
  useEditorStore.setState({gameObjectEdits:edits,selectedGameObjectIds:["table","prop"]});
  return s;
}
it("copies linked furniture with its support remapped, and deletes both atomically",()=>{
  const s=linked();let n=0;
  const plan=planGameSelectionTransform(state(),"duplicate",s,[1,0],()=>"copy-"+(n++));
  expect(plan.gameObjectEdits?.sorting?.find(row=>row.entityId==="copy-1")?.setting).toEqual({mode:"surface",supportId:"copy-0"});
  const deleted=planGameSelectionTransform(state(),"delete",s,[0,0],()=>"");
  expect(deleted.gameObjectEdits?.sorting).toEqual([]);
});
it("rejects deleting a support alone and refuses stale selection after a sorting change",()=>{
  const s=linked();useEditorStore.setState({selectedGameObjectIds:["table"]});
  expect(()=>planGameSelectionTransform(state(),"delete",s,[0,0],()=>"")).toThrow(/소품/);
  expect(()=>currentGameObjects(state(),scene())).toThrow(/미리보기/);
  const before=state().gameObjectEdits;
  state().removeGameObject("table");
  expect(state().gameObjectEdits).toBe(before);expect(state().gameSelectionError).toMatch(/소품/);
  state().sortGameObject("table",{mode:"wall"},s);
  expect(state().gameObjectEdits).toBe(before);expect(state().gameSelectionError).toMatch(/소품/);
});
it("dragging a support updates the linked visual depth without moving the prop position",()=>{
  const s=linked();
  s.sprites=s.objects!.map(o=>({id:o.entityId,objectEntityId:o.entityId,path:o.entityId,name:o.name,ruid:o.ruid,kind:"object",position:o.position,scale:[1,1],quaternion:[0,0,0,1],rotationDeg:0,flipX:false,flipY:false,sortingLayer:null,orderInLayer:0,sourceOrder:0}));
  const draft=sceneWithObjectDraft(s,"table",[0,2]);
  expect(draft.sprites[1].position).toEqual([1,1,2*.21875-.0001]);
  expect(s.objects![1].position[2]).toBe(-.0001);
});
