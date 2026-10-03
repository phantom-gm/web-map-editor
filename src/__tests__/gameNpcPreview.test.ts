import { afterEach, describe, expect, it, vi } from "vitest";
import { drawGameNpcLabels, gameNpcHitCandidates, sceneWithNpcDraft } from "../lib/gameNpcPreview";
import { previewSpriteGeometry, previewWorldToScreen, type GamePreviewScene, type GamePreviewSprite, type GamePreviewImages } from "../lib/gamePreview";
import type { GameNpcDescriptor } from "../lib/gameNpc";
const npc=(id:string,position:[number,number,number]=[1.28,16,3.5]):GameNpcDescriptor=>({
  entityId:id,spawnId:id,npcClassId:101,name:"엘드릭",cell:[3,2],sourceCell:[3,2],sourceFlipX:false,sourceDialogId:"",
  position,ruid:id,bodyScale:1.2,flipX:false,dialogId:"",enabled:true,canEdit:true,
});
const sprite=(id:string,extra:Partial<GamePreviewSprite>={}):GamePreviewSprite=>({
  id,npcEntityId:id,name:id,path:"/maps/fixture/"+id,ruid:id,kind:"other",position:[1.28,16,3.5],
  scale:[1.2,1.2],quaternion:[0,0,0,1],rotationDeg:0,flipX:false,flipY:false,sortingLayer:null,orderInLayer:10,sourceOrder:0,...extra,
});
const scene=(sprites:GamePreviewSprite[]):GamePreviewScene=>({
  version:1,mapName:"fixture",baselineId:"baseline",groundOrigin:[0,0],
  constants:{TILE_W:2.56,TILE_H:1.28,ORIGIN_X:15,ORIGIN_Y:15,PPU:100,DEPTH_SCALE:0.21875,GROUND_ORDER:-1000},
  defaultSortingLayer:"Default",sprites,npcs:sprites.filter(s=>s.npcEntityId).map(s=>npc(s.npcEntityId!,s.position)),warnings:[],
});
const camera={x:200,y:500,zoom:1.3};
const asset={width:100,height:200,pivot:[0.5,0] as [number,number],pixelsPerUnit:100};
interface PixelImage { naturalWidth:number;naturalHeight:number;alphaAt:(x:number,y:number)=>number }
let sampled:{image:PixelImage;x:number;y:number}|null=null;
const pixelContext={
  clearRect:()=>{sampled=null;},
  drawImage:(image:PixelImage,x:number,y:number)=>{sampled={image,x,y};},
  getImageData:()=>({data:new Uint8ClampedArray([0,0,0,sampled?sampled.image.alphaAt(sampled.x,sampled.y):0])}),
};
const images=(sprites:GamePreviewSprite[],alphas:Record<string,(x:number,y:number)=>number>={}):GamePreviewImages=>{
  vi.stubGlobal("document",{createElement:()=>({getContext:()=>pixelContext})});
  return new Map(sprites.map(s=>[s.ruid,{asset,image:{naturalWidth:100,naturalHeight:200,alphaAt:alphas[s.id]??(()=>255)} as unknown as HTMLImageElement}]));
};
const point=(item:GamePreviewSprite,current:GamePreviewScene,px=50,py=100):[number,number]=>{
  const [a,b,c,d,tx,ty]=previewSpriteGeometry(item,asset,current,camera).matrix;return [a*px+c*py+tx,b*px+d*py+ty];
};
afterEach(()=>vi.unstubAllGlobals());
describe("NPC preview editing geometry",()=>{
  it("moves only selected NPC sprite/descriptor by iso cells and depth, retaining source data",()=>{
    const current=scene([sprite("npc"),sprite("other")]), before=structuredClone(current);
    const moved=sceneWithNpcDraft(current,"npc",[5,1]);
    expect(current).toEqual(before);
    expect(moved.npcs![0].cell).toEqual([5,1]);
    expect(moved.npcs![0].sourceCell).toEqual([3,2]);
    expect(moved.sprites[0].position[0]).toBeCloseTo(1.28+3*1.28);
    expect(moved.sprites[0].position[1]).toBeCloseTo(16-0.64);
    expect(moved.sprites[0].position[2]).toBeCloseTo(3.5-0.64*0.21875);
    expect(moved.sprites[0].scale).toEqual([1.2,1.2]);
    expect(moved.sprites[1]).toBe(current.sprites[1]);
    expect(sceneWithNpcDraft(current,"missing",[1,1])).toBe(current);
  });
  it("hits the displayed image with negative BodyScale X and native pivot",()=>{
    const item=sprite("npc",{scale:[-1.2,1.2]}),current=scene([item]);
    expect(gameNpcHitCandidates(...point(item,current,80,150),current,images([item]),camera).map(n=>n.entityId)).toEqual(["npc"]);
  });
  it("ignores transparent corners and does not select an NPC behind an opaque building",()=>{
    const item=sprite("npc"),building=sprite("building",{npcEntityId:undefined,kind:"object",orderInLayer:20});
    const current=scene([item,building]),center=point(item,current);
    expect(gameNpcHitCandidates(...center,current,images([item,building]),camera)).toEqual([]);
    expect(gameNpcHitCandidates(...center,current,images([item,building],{building:()=>0}),camera).map(n=>n.entityId)).toEqual(["npc"]);
    expect(gameNpcHitCandidates(...center,scene([item]),images([item],{npc:()=>0}),camera)).toEqual([]);
  });
  it("uses draw order for overlapping NPCs and skips disabled sprites",()=>{
    const back=sprite("back"),front=sprite("front",{sourceOrder:1}),current=scene([back,front]);
    expect(gameNpcHitCandidates(...point(front,current),current,images([back,front]),camera)[0].entityId).toBe("front");
    current.npcs![1].enabled=false;front.color=[1,1,1,0];
    expect(gameNpcHitCandidates(...point(back,current),current,images([back,front]),camera)[0].entityId).toBe("back");
  });
  it("places upright names 3.03 world units above roots without multiplying BodyScale",()=>{
    const current=scene([sprite("npc",{scale:[-1.2,1.2]})]);
    const labels:Array<[string,number,number]>=[];
    const ctx={save(){},restore(){},strokeText(){},fillText:(name:string,x:number,y:number)=>labels.push([name,x,y])} as unknown as CanvasRenderingContext2D;
    drawGameNpcLabels(ctx,current,camera);
    const expected=previewWorldToScreen([1.28,19.03],current,camera);
    expect(labels).toEqual([["엘드릭",...expected]]);
    current.npcs![0].enabled=false;drawGameNpcLabels(ctx,current,camera);expect(labels).toHaveLength(1);
  });
});
