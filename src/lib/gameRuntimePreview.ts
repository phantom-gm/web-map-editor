import { previewSpritePixelAt } from "./gameObjectPreview";
import { previewWorldToScreen, sortPreviewSprites, type GamePreviewImages, type GamePreviewScene } from "./gamePreview";
import type { Camera } from "./grid";
import type { RuntimeSelection, RuntimeCell, RuntimeKind } from "./gameRuntime";
export function runtimeDescriptor(scene: GamePreviewScene, selected: RuntimeSelection) {
  return selected.kind === "spawn" ? scene.spawn : selected.kind === "monster"
    ? scene.monsters?.find(m=>m.entityId===selected.entityId) : scene.portals?.find(p=>p.entityId===selected.entityId);
}
export function sceneWithRuntimeDraft(scene: GamePreviewScene, selected: RuntimeSelection, cell: RuntimeCell): GamePreviewScene {
  const item=runtimeDescriptor(scene,selected); if(!item)return scene;
  const dx=cell[0]-item.cell[0],dy=cell[1]-item.cell[1],x=(dx-dy)*scene.constants.TILE_W/2,y=-(dx+dy)*scene.constants.TILE_H/2;
  const position:[number,number,number]=[item.position[0]+x,item.position[1]+y,item.position[2]+y*scene.constants.DEPTH_SCALE];
  const sprites=scene.sprites.map(s=>(selected.kind==="monster"?s.monsterEntityId:selected.kind==="portal"?s.portalEntityId:undefined)===selected.entityId?{...s,position}:s);
  if(selected.kind==="monster")return {...scene,sprites,monsters:scene.monsters?.map(m=>m.entityId===selected.entityId?{...m,cell,position}:m)};
  if(selected.kind==="portal")return {...scene,sprites,portals:scene.portals?.map(p=>p.entityId===selected.entityId?{...p,cell,position}:p)};
  return {...scene,spawn:scene.spawn?{...scene.spawn,cell,position}:null};
}
function entries(scene: GamePreviewScene) {
  return [
    ...(scene.monsters??[]).map(m=>({selection:{kind:"monster" as const,entityId:m.entityId},item:m,label:m.name+" ×"+m.count,color:"#ff9b87"})),
    ...(scene.portals??[]).map(p=>({selection:{kind:"portal" as const,entityId:p.entityId},item:p,label:"포털 → "+p.destMap,color:"#d5a2ff"})),
    ...(scene.spawn?[{selection:{kind:"spawn" as const,entityId:scene.mapName},item:scene.spawn,label:"시작점",color:"#88edbc"}]:[]),
  ];
}
export function gameRuntimeHit(x:number,y:number,scene:GamePreviewScene,images:GamePreviewImages,camera:Camera,preferred:RuntimeKind|null):RuntimeSelection|null {
  const list=entries(scene).filter(e=>!preferred||e.selection.kind===preferred);
  // Editor anchor badges stay selectable even if the actual sprite is hidden or disabled.
  for(const entry of [...list].reverse()) {
    const [cx,cy]=previewWorldToScreen(entry.item.position,scene,camera);
    if(Math.hypot(x-cx,y-(cy-10))<=12)return entry.selection;
  }
  for(const sprite of sortPreviewSprites(scene).reverse()){
    const selection=sprite.monsterEntityId?{kind:"monster" as const,entityId:sprite.monsterEntityId}:sprite.portalEntityId?{kind:"portal" as const,entityId:sprite.portalEntityId}:null;
    const image=images.get(sprite.ruid);if(!image||(sprite.color?.[3]??1)<=0)continue;
    const pixel=previewSpritePixelAt(sprite,image.asset,scene,camera,x,y);if(!pixel)continue;
    const canvas=document.createElement("canvas");canvas.width=1;canvas.height=1;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)continue;
    try{
      ctx.drawImage(image.image,Math.floor(pixel[0]*image.image.naturalWidth/image.asset.width),Math.floor(pixel[1]*image.image.naturalHeight/image.asset.height),1,1,0,0,1,1);
      if(ctx.getImageData(0,0,1,1).data[3]<=16)continue;
      return selection&&(!preferred||selection.kind===preferred)?selection:null;
    }catch{/* Lists and badges are still selectable when alpha cannot be resolved. */}
  }
  return null;
}
export function drawGameRuntime(ctx:CanvasRenderingContext2D,scene:GamePreviewScene,camera:Camera,selected:RuntimeSelection|null,labels:boolean):void {
  ctx.save();ctx.font="600 11px sans-serif";ctx.textAlign="center";ctx.textBaseline="bottom";
  for(const entry of entries(scene)){
    const isSelected=selected?.kind===entry.selection.kind&&selected.entityId===entry.selection.entityId;
    if(!labels&&!isSelected)continue;
    const [x,y]=previewWorldToScreen(entry.item.position,scene,camera);
    ctx.fillStyle="rgba(15,20,30,.85)";ctx.strokeStyle=isSelected?"#fff":entry.color;ctx.lineWidth=isSelected?3:1.5;
    ctx.beginPath();ctx.arc(x,y-10,9,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle=entry.color;ctx.fillText(entry.selection.kind==="monster"?"M":entry.selection.kind==="portal"?"P":"S",x,y-3);
    ctx.lineWidth=3;ctx.strokeStyle="#101318";ctx.strokeText(entry.label,x,y-24);ctx.fillText(entry.label,x,y-24);
    if("enabled" in entry.item&&!entry.item.enabled){ctx.fillText("(비활성)",x,y-38);}
    if(isSelected&&entry.selection.kind==="monster"){
      const m=scene.monsters!.find(m=>m.entityId===entry.selection.entityId)!;
      const r=m.spread,c=scene.constants;
      const offsets=[[-r,-r],[r,-r],[r,r],[-r,r]];
      ctx.strokeStyle="#ff9b87";ctx.fillStyle="rgba(255,155,135,.1)";ctx.setLineDash([5,4]);ctx.beginPath();
      offsets.forEach(([dx,dy],i)=>{const [sx,sy]=previewWorldToScreen([m.position[0]+(dx-dy)*c.TILE_W/2,m.position[1]-(dx+dy)*c.TILE_H/2],scene,camera);if(i)ctx.lineTo(sx,sy);else ctx.moveTo(sx,sy);});
      ctx.closePath();ctx.fill();ctx.stroke();ctx.setLineDash([]);
    }
  }
  ctx.restore();
}
