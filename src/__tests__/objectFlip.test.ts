import { beforeEach, expect, it } from "vitest";
import { parseGameObjectEdits, setGameObjectFlip, removeGameObjectEdit } from "../lib/gameObjects";
import { currentGameObjects, planGameSelectionTransform } from "../lib/gameSelection";
import { useEditorStore } from "../store/editorStore";
import { previewSpriteGeometry, type GamePreviewScene, type GamePreviewSprite } from "../lib/gamePreview";
import { previewSpritePixelAt } from "../lib/gameObjectPreview";
const state=()=>useEditorStore.getState();
const object={entityId:"tree",prototypeId:"tree",spriteId:"tree",name:"tree",ruid:"tree",position:[1,2,3] as [number,number,number],sourcePosition:[1,2,3] as [number,number,number],flipX:true,canMove:true,canDelete:true,canDuplicate:true};
const scene=():GamePreviewScene=>({version:1,baselineId:"flip",mapName:"test",groundOrigin:[0,0],defaultSortingLayer:"Default",warnings:[],constants:{TILE_W:2.56,TILE_H:1.28,ORIGIN_X:15,ORIGIN_Y:15,PPU:100,DEPTH_SCALE:.21875,GROUND_ORDER:-1000},objects:[structuredClone(object)],objectPrototypes:[structuredClone(object)],sprites:[]});
beforeEach(()=>{state().newProject();useEditorStore.setState({mapName:"test",gameSync:{version:1,baselineId:"flip",mapName:"test"},gameObjectEdits:undefined,selectedGameObjectIds:["tree"]});});
it("absolute false flips save/reload and undo/redo; toggling back restores prototype without touching other fields",()=>{
 const before=state().exportProject();state().flipGameObject("tree",scene());const saved=state().exportProject();
 expect(saved).toEqual({...before,gameObjectEdits:{version:1,moved:[],removed:[],added:[],flips:[{entityId:"tree",flipX:false}]}});
 state().undo();expect(state().exportProject()).toEqual(before);state().redo();expect(state().exportProject()).toEqual(saved);
 state().loadProject(saved,[]);expect(state().exportProject()).toEqual(saved);
 const current=scene();current.objects![0].flipX=false;state().flipGameObject("tree",current);expect(state().exportProject()).toEqual(before);
});
it("rejects stale/protected scenes and malformed boolean overrides atomically",()=>{
 const before=state().exportProject(), s=scene();s.objects![0].canMove=false;s.objectPrototypes![0].canMove=false;
 state().flipGameObject("tree",s);expect(state().exportProject()).toEqual(before);expect(state().gameSelectionError).toBeTruthy();
 state().flipGameObject("tree",scene());const saved=state().exportProject();state().flipGameObject("tree",scene());expect(state().exportProject()).toEqual(saved);expect(()=>currentGameObjects(state(),scene())).toThrow();
 for(const flips of [null,[{entityId:"tree",flipX:1}],[{entityId:"tree",flipX:true,z:1}],[{entityId:"tree",flipX:true},{entityId:"tree",flipX:false}]])expect(()=>parseGameObjectEdits({...saved.gameObjectEdits,flips})).toThrow();
 expect(()=>parseGameObjectEdits({...saved.gameObjectEdits,removed:["tree"]})).toThrow();
});
it("copies inherit the current orientation and offset and deleting a copy clears its override",()=>{
 const edits=setGameObjectFlip(undefined,"tree",false)!;edits.visualOffsets=[{entityId:"tree",offset:[.2,.3]}];useEditorStore.setState({gameObjectEdits:edits});const s=scene();s.objects![0].flipX=false;s.objects![0].visualOffset=[.2,.3];s.objects![0].position[2]+=.3*.21875;
 const copy=planGameSelectionTransform(state(),"duplicate",s,[1,0],()=>"copy");expect(copy.gameObjectEdits?.flips).toEqual([{entityId:"tree",flipX:false},{entityId:"copy",flipX:false}]);expect(copy.gameObjectEdits?.visualOffsets?.[1].offset).toEqual([.2,.3]);expect(removeGameObjectEdit(copy.gameObjectEdits,"copy")).toEqual(edits);
});
it("noncentral pivots mirror around the renderer anchor with matching hit tests, negative scale and rotation",()=>{
 const s=scene(), asset={width:790,height:695,pivot:[.3,.12] as [number,number],pixelsPerUnit:100};
 const sprite:GamePreviewSprite={id:"tree",name:"tree",path:"/maps/test/tree",ruid:"tree",kind:"object",position:[1,2,3],scale:[-.4,.4],quaternion:[0,0,0,1],rotationDeg:32,flipX:false,flipY:false,sortingLayer:null,orderInLayer:0,sourceOrder:0,visualOffset:[.2,.3]};
 for(const camera of [{x:12,y:34,zoom:.5},{x:12,y:34,zoom:3}])for(const flipX of [false,true]){const current={...sprite,flipX};const g=previewSpriteGeometry(current,asset,s,camera);const[a,b,c,d,x,y]=g.matrix;const hit=previewSpritePixelAt(current,asset,s,camera,a*123+c*456+x,b*123+d*456+y)!;expect(hit[0]).toBeCloseTo(123);expect(hit[1]).toBeCloseTo(456);expect(g.anchor).toEqual(previewSpriteGeometry(sprite,asset,s,camera).anchor);}
});
