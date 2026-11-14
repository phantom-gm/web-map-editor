import { beforeEach, expect, it } from "vitest";
import { parseGameObjectEdits, removeGameObjectEdit } from "../lib/gameObjects";
import { planGameSelectionTransform } from "../lib/gameSelection";
import { useEditorStore } from "../store/editorStore";
import type { GamePreviewScene } from "../lib/gamePreview";
const state = () => useEditorStore.getState();
const object = {entityId:"room",prototypeId:"room",spriteId:"room",name:"room",ruid:"room",position:[1,2,3] as [number,number,number],sourcePosition:[1,2,3] as [number,number,number],canMove:true,canScale:true,canDelete:true,canDuplicate:true};
const scene = ():GamePreviewScene => ({version:1,baselineId:"scale",mapName:"test",groundOrigin:[0,0],defaultSortingLayer:"Default",warnings:[],constants:{TILE_W:2.56,TILE_H:1.28,ORIGIN_X:15,ORIGIN_Y:15,PPU:100,DEPTH_SCALE:.21875,GROUND_ORDER:-1000},objects:[structuredClone(object)],objectPrototypes:[structuredClone(object)],sprites:[]});
beforeEach(()=>{state().newProject();useEditorStore.setState({mapName:"test",gameSync:{version:1,baselineId:"scale",mapName:"test"},gameObjectEdits:undefined,selectedGameObjectIds:["room"]});});
it("background scale persists, undoes, redoes and resets exactly",()=>{
 const before=state().exportProject(); state().scaleGameObjectVisual("room",1.1,scene()); const saved=state().exportProject();
 expect(saved.gameObjectEdits?.visualScales).toEqual([{entityId:"room",scale:1.1}]);
 state().undo();expect(state().exportProject()).toEqual(before);state().redo();expect(state().exportProject()).toEqual(saved);
 state().loadProject(saved,[]);expect(state().exportProject()).toEqual(saved);
 const current=scene();current.objects![0].visualScale=1.1;state().scaleGameObjectVisual("room",1,current);expect(state().exportProject()).toEqual(before);
});
it("copy carries scale; deletion removes it; stale and protected changes are rejected",()=>{
 state().scaleGameObjectVisual("room",1.1,scene()); const saved=state().exportProject();state().scaleGameObjectVisual("room",1.2,scene());expect(state().exportProject()).toEqual(saved);expect(state().gameSelectionError).toBeTruthy();
 const current=scene();current.objects![0].visualScale=1.1;
 const copy=planGameSelectionTransform(state(),"duplicate",current,[1,0],()=>"copy");expect(copy.gameObjectEdits?.visualScales?.[1]).toEqual({entityId:"copy",scale:1.1});expect(removeGameObjectEdit(copy.gameObjectEdits,"copy")).toEqual(saved.gameObjectEdits);
 current.objects![0].canScale=false;state().scaleGameObjectVisual("room",1.2,current);expect(state().exportProject()).toEqual(saved);
 for(const scales of [null,[{entityId:"room",scale:0}],[{entityId:"room",scale:NaN}],[{entityId:"room",scale:101}],[{entityId:"room",scale:2},{entityId:"room",scale:3}]])expect(()=>parseGameObjectEdits({...saved.gameObjectEdits,visualScales:scales})).toThrow();
});
