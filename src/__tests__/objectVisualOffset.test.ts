import { beforeEach, expect, it } from "vitest";
import { parseGameObjectEdits, setGameObjectVisualOffset, removeGameObjectEdit } from "../lib/gameObjects";
import { currentGameObjects, planGameSelectionTransform } from "../lib/gameSelection";
import { useEditorStore } from "../store/editorStore";
import { previewSpriteGeometry, type GamePreviewScene, type GamePreviewSprite } from "../lib/gamePreview";
import { previewSpritePixelAt, sceneWithGameObjectGroupDraft } from "../lib/gameObjectPreview";
import { cellKey } from "../lib/cell";

const state = () => useEditorStore.getState();
const object = {entityId:"tree",prototypeId:"tree",spriteId:"tree",name:"tree",ruid:"tree",
  position:[1.23,2.34,5] as [number,number,number],sourcePosition:[1.23,2.34,5] as [number,number,number],
  canMove:true,canDelete:true,canDuplicate:true,
  sortInfo:{order:0,footprint:[2,3,1,1] as [number,number,number,number],bounds:[7,5] as [number,number],padX:0}};
const sprite: GamePreviewSprite = {id:"tree",objectEntityId:"tree",name:"tree",path:"/maps/test/tree",ruid:"tree",kind:"object",
  position:object.position,scale:[-2,0.7],quaternion:[0,0,0,1],rotationDeg:37,flipX:true,flipY:true,sortingLayer:null,orderInLayer:0,sourceOrder:0};
const scene = (): GamePreviewScene => ({version:1,baselineId:"offset",mapName:"test",groundOrigin:[0,0],defaultSortingLayer:"Default",warnings:[],
  constants:{TILE_W:2.56,TILE_H:1.28,ORIGIN_X:15,ORIGIN_Y:15,PPU:100,DEPTH_SCALE:.21875,GROUND_ORDER:-1000},
  objects:[structuredClone(object)],objectPrototypes:[structuredClone(object)],sprites:[structuredClone(sprite)]});
beforeEach(()=>{state().newProject();useEditorStore.setState({mapName:"test",gameSync:{version:1,baselineId:"offset",mapName:"test"},gameObjectEdits:undefined,
  selectedGameObjectIds:["tree"],blocked:new Set([cellKey(2,3)])});});
it("stores only visual XY, round-trips, undoes/redoes and resets without changing cells, ground or authoring entities",()=>{
  const before=state().exportProject();
  state().offsetGameObjectVisual("tree",[.03,.1],scene());
  const saved=state().exportProject();
  expect(saved.gameObjectEdits?.visualOffsets).toEqual([{entityId:"tree",offset:[.03,.1]}]);
  expect(saved).toEqual({...before,gameObjectEdits:{version:1,moved:[],removed:[],added:[],visualOffsets:[{entityId:"tree",offset:[.03,.1]}]}});
  state().undo();expect(state().exportProject()).toEqual(before);
  state().redo();expect(state().exportProject()).toEqual(saved);
  state().loadProject(saved,[]);expect(state().exportProject()).toEqual(saved);
  // Server z follows the drawn Y (game objectDepthZ), so the offset's Y shift moves z too.
  const current=scene();current.objects![0].visualOffset=[.03,.1];current.objects![0].position[2]+=.1*.21875;
  state().offsetGameObjectVisual("tree",[0,0],current);expect(state().exportProject()).toEqual(before);
});
it("rejects stale scenes, protected objects and invalid offsets atomically",()=>{
  const before=state().exportProject();
  const protectedScene=scene();protectedScene.objects![0].canMove=false;protectedScene.objectPrototypes![0].canMove=false;
  state().offsetGameObjectVisual("tree",[0,.1],protectedScene);
  expect(state().exportProject()).toEqual(before);expect(state().gameSelectionError).toBeTruthy();
  for (const offset of [[NaN,0],[0,Infinity],[41,0]]) {
    state().offsetGameObjectVisual("tree",offset as [number,number],scene());
    expect(state().exportProject()).toEqual(before);
  }
  state().offsetGameObjectVisual("tree",[0,.1],scene());
  const saved=state().exportProject();
  state().offsetGameObjectVisual("tree",[0,.2],scene());
  expect(state().exportProject()).toEqual(saved);expect(state().gameSelectionError).toMatch(/미리보기/);
  expect(()=>currentGameObjects(state(),scene())).toThrow();
});
it("validates offsets on load and removes/reset zero overlays without leaving stale rows",()=>{
  const edits=setGameObjectVisualOffset(undefined,"tree",[.1,.2])!;
  const value=JSON.parse(JSON.stringify(edits)); const parsed=parseGameObjectEdits(value)!;
  value.visualOffsets[0].offset[0]=9;expect(parsed.visualOffsets![0].offset[0]).toBe(.1);
  for(const rows of [null,[{entityId:"tree",offset:[0,.1],z:2}],[{entityId:"tree",offset:[0]}],
    [{entityId:"tree",offset:[0,.1]},{entityId:"tree",offset:[0,.2]}]]) {
    expect(()=>parseGameObjectEdits({...edits,visualOffsets:rows})).toThrow();
  }
  expect(()=>parseGameObjectEdits({...edits,removed:["tree"]})).toThrow();
  expect(setGameObjectVisualOffset(edits,"tree",[0,0])).toBeUndefined();
  expect(removeGameObjectEdit(edits,"tree")?.visualOffsets).toEqual([]);
});
it("cell moves preserve offset; copies inherit it; deleting a copy removes its offset",()=>{
  const edits=setGameObjectVisualOffset(undefined,"tree",[.08,.12]);
  useEditorStore.setState({gameObjectEdits:edits});
  const s=scene();s.objects![0].visualOffset=[.08,.12];s.objects![0].position[2]+=.12*.21875;
  const moved=planGameSelectionTransform(state(),"move",s,[1,0],()=>"copy");
  expect(moved.gameObjectEdits?.moved[0].position).toEqual([2.51,1.7]);
  expect(moved.gameObjectEdits?.visualOffsets).toEqual(edits?.visualOffsets);
  expect(moved.blocked).toBe(state().blocked);
  const copy=planGameSelectionTransform(state(),"duplicate",s,[1,0],()=>"copy");
  expect(copy.gameObjectEdits?.visualOffsets?.find(row=>row.entityId==="copy")?.offset).toEqual([.08,.12]);
  expect(removeGameObjectEdit(copy.gameObjectEdits,"copy")).toEqual(edits);
});
it("rendered pixels/hits shift independently from the logical anchor across zoom, flips, rotation and drag",()=>{
  const asset={width:600,height:900,pivot:[.3,.12] as [number,number],pixelsPerUnit:80};
  const offset:[number,number]=[.25,.4];
  const s=scene(), shifted={...sprite,visualOffset:offset};
  for(const camera of [{x:15,y:-37,zoom:.25},{x:500,y:250,zoom:3}]) {
    const plain=previewSpriteGeometry(sprite,asset,s,camera),fine=previewSpriteGeometry(shifted,asset,s,camera);
    const baked=previewSpriteGeometry({...sprite,position:[sprite.position[0]+offset[0],sprite.position[1]+offset[1],sprite.position[2]]},asset,s,camera);
    expect(fine.anchor).toEqual(plain.anchor);expect(fine.matrix).toEqual(baked.matrix);expect(fine.bounds).toEqual(baked.bounds);
    const [a,b,c,d,x,y]=fine.matrix;const pixel=previewSpritePixelAt(shifted,asset,s,camera,a*123+c*456+x,b*123+d*456+y)!;
    expect(pixel[0]).toBeCloseTo(123);expect(pixel[1]).toBeCloseTo(456);
  }
  s.sprites=[shifted];s.objects![0].visualOffset=offset;
  const draft=sceneWithGameObjectGroupDraft(s,["tree"],[1,0]);
  expect(draft.sprites[0].visualOffset).toEqual(offset);
  expect(draft.sprites[0].position[2]).toBeCloseTo(5-.64*.21875);
  expect(draft.objects![0].sortInfo).toEqual(object.sortInfo);
});
