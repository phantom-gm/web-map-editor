import { activateEditorTool } from "../lib/editorCommands";
import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import { useWorkspaceSession } from "../lib/gameWorkspace";
import { parseGameRuntimeSync, runtimeSourceKey, type RuntimeKind, type RuntimeSelection, type PortalFields, type GameMonsterDescriptor, type GamePortalDescriptor } from "../lib/gameRuntime";
import { runtimeDescriptor } from "../lib/gameRuntimePreview";
import { previewWorldToScreen, type GamePreviewScene } from "../lib/gamePreview";
import type { ProjectFile } from "../lib/projectIO";
import { NumberField } from "./NumberField";
import {GameTrapLibrary,GameTrapInspector} from "./GameTrapPanel";

const names = {monster:"몬스터 스포너",portal:"포털",spawn:"시작점",trap:"함정"};
export function openRuntimePanel(kind:RuntimeKind):void {
  useGamePreviewStore.getState().setRuntimePanel(kind);
  useEditorStore.getState().clearGameSelection();useEditorStore.getState().setTool("cursor");
}
function focusRuntime(selection:RuntimeSelection,scene:GamePreviewScene):void {
  const item=runtimeDescriptor(scene,selection),rect=document.querySelector(".canvas-wrap")?.getBoundingClientRect(),st=useEditorStore.getState();
  if(!item||!rect)return;
  const [x,y]=previewWorldToScreen(item.position,scene,st.camera);
  st.setCamera({...st.camera,x:st.camera.x+rect.width/2-x,y:st.camera.y+rect.height/2-y});
}
function PortalTarget({fields,onChange,scene,disabled=false}:{fields:Omit<PortalFields,"cell">;onChange:(patch:Partial<PortalFields>)=>void;scene:GamePreviewScene;disabled?:boolean}) {
  return <>
    <label className="ei-row"><span>도착 맵</span><select aria-label="포털 도착 맵" disabled={disabled} value={fields.destMap} onChange={e=>{
      const target=scene.mapDestinations?.find(m=>m.mapName===e.target.value);
      onChange({destMap:e.target.value,...(target?{destCell:target.spawnCell}:{})});
    }}><option value="" disabled>도착 맵 선택</option>{scene.mapDestinations?.map(m=><option key={m.mapName} value={m.mapName} disabled={!m.canTarget}>{m.name||m.mapName}</option>)}</select></label>
    <div className="ei-grid2">
      <label className="ei-row"><span>도착 X</span><NumberField value={fields.destCell[0]} min={0} disabled={disabled} onCommit={x=>onChange({destCell:[x,fields.destCell[1]]})}/></label>
      <label className="ei-row"><span>도착 Y</span><NumberField value={fields.destCell[1]} min={0} disabled={disabled} onCommit={y=>onChange({destCell:[fields.destCell[0],y]})}/></label>
    </div>
    <label className="ei-row"><span>도착 방향</span><select aria-label="포털 도착 방향" disabled={disabled} value={fields.destFacing} onChange={e=>onChange({destFacing:e.target.value as PortalFields["destFacing"]})}>
      <option value="SE">남동 ↘</option><option value="SW">남서 ↙</option><option value="NE">북동 ↗</option><option value="NW">북서 ↖</option>
    </select></label>
  </>;
}
export function GameRuntimeLibrary({kind}:{kind:RuntimeKind}) {return kind==="trap"?<GameTrapLibrary/>:<ActorRuntimeLibrary kind={kind}/>;}
function ActorRuntimeLibrary({kind}:{kind:Exclude<RuntimeKind,"trap">}) {
  const [search,setSearch]=useState(""),[adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [portalFields,setPortalFields]=useState<Omit<PortalFields,"cell">>({destMap:"",destCell:[0,0],destFacing:"SE",enabled:true});
  const request=useRef<AbortController|null>(null);useEffect(()=>()=>request.current?.abort(),[]);
  const view=useGamePreviewStore(),link=useEditorStore(s=>s.gameSync),selection=useEditorStore(s=>s.selectedGameRuntime);
  const storeError=useEditorStore(s=>s.gameRuntimeError),loading=useWorkspaceSession(s=>s.loading);
  const scene=view.scene?.baselineId===link?.baselineId?view.scene:null;
  const ready=!!scene&&view.status==="ready"&&!loading&&!busy&&!view.comparisonEnabled;
  const editable=ready&&!scene?.runtimeSource?.stale;
  const query=search.toLocaleLowerCase().trim();
  const monsters=(scene?.monsters??[]).filter(m=>(m.name+" "+m.spawnId).toLocaleLowerCase().includes(query));
  const portals=(scene?.portals??[]).filter(p=>(p.portalId+" "+p.destMap).toLocaleLowerCase().includes(query));
  const classes=(scene?.monsterCatalog??[]).filter(m=>(m.name+" "+m.monsterClassId).toLocaleLowerCase().includes(query));
  async function refreshSource(){
    const st=useEditorStore.getState();if(!st.gameSync)return;
    if((st.gameMonsterEdits||st.gamePortalEdits||st.gameSpawnEdits||st.gameTrapEdits)&&!window.confirm("몬스터·포털·시작점·함정 수정 사항을 지우고 최신 원본을 불러옵니다. NPC와 다른 작업은 유지하고 Ctrl+Z로 되돌릴 수 있습니다. 계속할까요?"))return;
    request.current?.abort();const controller=new AbortController();request.current=controller;
    const baselineId=st.gameSync.baselineId,expected=runtimeSourceKey(st);setBusy(true);setError(null);
    try{
      const response=await fetch("/api/game-sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"refresh-runtime",project:st.exportProject()}),signal:controller.signal});
      const data=await response.json() as {project?:ProjectFile;error?:string};
      if(controller.signal.aborted)return;
      if(!response.ok||data.project?.gameSync?.baselineId!==baselineId)throw new Error(data.error||"배치 원본을 읽지 못했습니다.");
      const sync=parseGameRuntimeSync(data.project.gameRuntimeSync);if(!sync)throw new Error("배치 원본 연결이 없습니다.");
      if(useEditorStore.getState().replaceGameRuntimeSource(sync,baselineId,expected)){view.setRuntimePlacement(null);useEditorStore.getState().setTool("cursor");}
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  const choose=(selected:RuntimeSelection)=>{if(!scene)return;view.setRuntimePlacement(null);useEditorStore.getState().setTool("cursor");useEditorStore.getState().selectGameRuntime(selected);focusRuntime(selected,scene);};
  return <section className="game-runtime-library" aria-label={names[kind]+" 목록"}>
    <div className="palette-head"><strong>{names[kind]}</strong><button onClick={()=>activateEditorTool("brush")}>바닥 소재</button></div>
    <div className="object-tabs">{(["monster","portal","spawn","trap"] as const).map(k=><button key={k} aria-pressed={k===kind} onClick={()=>openRuntimePanel(k)}>{names[k]}</button>)}</div>
    {kind!=="spawn"&&<div className="object-tabs"><button aria-pressed={!adding} onClick={()=>setAdding(false)}>현재 배치</button><button aria-pressed={adding} onClick={()=>setAdding(true)}>{names[kind]} 추가</button></div>}
    {kind!=="spawn"&&<input className="object-search" aria-label={names[kind]+" 검색"} value={search} placeholder="이름·번호·맵 검색" onChange={e=>setSearch(e.target.value)}/>}
    <p className="object-help">{kind==="monster"?"그림은 스포너 기준 위치입니다. 실제 몬스터는 수량·범위와 이동 가능 칸에 따라 등장하며 고정 위치가 아닙니다.":kind==="portal"?"포털은 한 방향 연결입니다. 반대편 포털은 따로 편집합니다.":"맵별 기본 시작 위치입니다. 이동·재지정만 가능하며 삭제하지 않습니다."}</p>
    {scene?.runtimeSource?.stale&&<p className="selection-error" role="alert">게임 배치 원본이 바뀌었습니다. 아래에서 원본을 다시 불러오세요.</p>}
    {(error||storeError)&&<p className="selection-error" role="alert">{error||storeError}</p>}
    {view.runtimePlacement&&<p className="object-placement">놓을 칸을 클릭하세요. <button onClick={()=>{view.setRuntimePlacement(null);useEditorStore.getState().setTool("cursor");}}>취소 (Esc)</button></p>}
    <div className="game-object-list game-runtime-list">
      {kind==="monster"&&(adding?classes.map(m=><button className="game-object-item" key={m.monsterClassId} disabled={!editable||!m.canAdd} onClick={()=>{view.setRuntimePlacement({kind:"monster",monsterClassId:m.monsterClassId});useEditorStore.getState().clearGameSelection();useEditorStore.getState().setTool("monster");}}>
        {view.images.get(m.ruid)?.image.src&&<img src={view.images.get(m.ruid)!.image.src} alt=""/>}<span>{m.name}<small>종류 {m.monsterClassId} · {m.bodyScale}배</small></span>
      </button>):monsters.map(m=><button className={"game-object-item"+(selection?.kind==="monster"&&selection.entityId===m.entityId?" selected":"")} key={m.entityId} disabled={!ready} onClick={()=>choose({kind:"monster",entityId:m.entityId})}>
        {view.images.get(m.ruid)?.image.src&&<img src={view.images.get(m.ruid)!.image.src} alt=""/>}<span>{m.name} ×{m.count}<small>칸 {m.cell.join(", ")} · 범위 {m.spread}{m.enabled?"":" · 비활성"}</small></span>
      </button>))}
      {kind==="portal"&&scene&&(adding?<div className="runtime-add-form"><PortalTarget fields={portalFields} scene={scene} disabled={!editable} onChange={patch=>setPortalFields(s=>({...s,...patch}))}/><button disabled={!editable||!portalFields.destMap} onClick={()=>{view.setRuntimePlacement({kind:"portal",fields:portalFields});useEditorStore.getState().clearGameSelection();useEditorStore.getState().setTool("portal");}}>이 설정으로 포털 배치</button></div>:portals.map(p=><button className={"game-object-item"+(selection?.kind==="portal"&&selection.entityId===p.entityId?" selected":"")} key={p.entityId} disabled={!ready} onClick={()=>choose({kind:"portal",entityId:p.entityId})}><span>{p.portalId}<small>{p.cell.join(", ")} → {p.destMap} ({p.destCell.join(", ")}){p.enabled?"":" · 비활성"}</small></span></button>))}
      {kind==="spawn"&&scene?.spawn&&<><button className="game-object-item" disabled={!ready} onClick={()=>choose({kind:"spawn",entityId:scene.mapName})}><span>시작점 {scene.spawn.cell.join(", ")}<small>현재 위치 선택·보기</small></span></button><button disabled={!editable||!scene.spawn.canEdit} onClick={()=>{view.setRuntimePlacement({kind:"spawn"});useEditorStore.getState().clearGameSelection();useEditorStore.getState().setTool("spawn");}}>맵에서 시작점 지정</button></>}
      {kind==="spawn"&&ready&&!scene?.spawn&&<p className="object-help">시작점 원본이 없는 맵입니다.</p>}
    </div>
    <div className="npc-source-actions"><button disabled={!ready||!scene?.runtimeSource?.refreshAvailable} onClick={()=>void refreshSource()}>{busy?"불러오는 중…":"배치·함정 원본 다시 읽기"}</button><small>몬스터·포털·시작점·함정 원본을 함께 갱신합니다. 게임 파일은 바뀌지 않습니다.</small></div>
  </section>;
}
export function GameRuntimeInspector(){
  const selection=useEditorStore(s=>s.selectedGameRuntime),link=useEditorStore(s=>s.gameSync),view=useGamePreviewStore();
  const scene=view.scene?.baselineId===link?.baselineId?view.scene:null;
  if(!selection||!scene||view.comparisonEnabled||!runtimeDescriptor(scene,selection))return null;
  if(selection.kind==="trap")return <GameTrapInspector scene={scene} entityId={selection.entityId}/>;
  return <RuntimeProperties key={selection.kind+selection.entityId} selection={{...selection,kind:selection.kind}} scene={scene}/>;
}
function RuntimeProperties({selection,scene}:{selection:RuntimeSelection & {kind:Exclude<RuntimeKind,"trap">};scene:GamePreviewScene}){
  const view=useGamePreviewStore(),loading=useWorkspaceSession(s=>s.loading),error=useEditorStore(s=>s.gameRuntimeError),item=runtimeDescriptor(scene,selection)!;
  const locked=loading||view.status!=="ready"||view.comparisonEnabled||!item.canEdit||!!scene.runtimeSource?.stale;
  const update=(patch:Partial<PortalFields>&Partial<Pick<GameMonsterDescriptor,"monsterClassId"|"count"|"spread"|"respawnMinSec"|"respawnMaxSec"|"firstSpawnSec">>)=>{
    const st=useEditorStore.getState();
    return selection.kind==="monster"?st.updateGameMonster(selection.entityId,patch,scene):selection.kind==="portal"?st.updateGamePortal(selection.entityId,patch,scene):patch.cell?st.setGameSpawn(patch.cell,scene):false;
  };
  const move=(dx:number,dy:number)=>update({cell:[item.cell[0]+dx,item.cell[1]+dy]});
  const monster=selection.kind==="monster"?item as GameMonsterDescriptor:null,portal=selection.kind==="portal"?item as GamePortalDescriptor:null;
  return <section className="entity-inspector game-runtime-inspector" aria-label={names[selection.kind]+" 속성"}>
    <div className="ei-head"><strong>{monster?.name||names[selection.kind]}</strong><button className="ei-close" aria-label="배치 선택 해제" onClick={()=>useEditorStore.getState().selectGameRuntime(null)}>✕</button></div>
    {error&&<p className="selection-error" role="alert">{error}</p>}{item.reason&&<p className="object-help">{item.reason}</p>}
    <div className="ei-grid2"><label className="ei-row"><span>X 칸</span><NumberField value={item.cell[0]} min={0} disabled={locked} onCommit={x=>update({cell:[x,item.cell[1]]})}/></label><label className="ei-row"><span>Y 칸</span><NumberField value={item.cell[1]} min={0} disabled={locked} onCommit={y=>update({cell:[item.cell[0],y]})}/></label></div>
    <div className="object-nudge">{[[-1,0,"↖"],[0,-1,"↗"],[0,1,"↙"],[1,0,"↘"]].map(([x,y,label])=><button key={label} disabled={locked} onClick={()=>move(Number(x),Number(y))}>{label}</button>)}</div>
    {monster&&<><label className="ei-row"><span>몬스터 종류</span><select disabled={locked} value={monster.monsterClassId} onChange={e=>update({monsterClassId:Number(e.target.value)})}>{scene.monsterCatalog?.map(c=><option key={c.monsterClassId} value={c.monsterClassId} disabled={!c.canAdd}>{c.monsterClassId} — {c.name}</option>)}</select></label>
      {([["count","동시 수량",1,200],["spread","분산 범위(칸)",0,undefined],["respawnMinSec","최소 리젠(초)",0,31536000],["respawnMaxSec","최대 리젠(초)",0,31536000],["firstSpawnSec","첫 등장 지연(초)",0,31536000]] as const).map(([key,label,min,max])=><label className="ei-row" key={key}><span>{label}</span><NumberField value={monster[key]} min={min} max={max} float={key.endsWith("Sec")} disabled={locked} onCommit={n=>update({[key]:n})}/></label>)}
      <p className="object-help">최소 0: 리젠 없음. 최대 0 또는 최소보다 작으면 최소 시간으로 고정됩니다. 실게임 전체 수량 상한과 위치 분산은 게임에서 확인합니다.</p></>}
    {portal&&<PortalTarget fields={portal} scene={scene} disabled={locked} onChange={update}/>}
    {(monster||portal)&&<label className="ei-row"><span>활성</span><input type="checkbox" checked={(monster||portal)!.enabled} disabled={locked} onChange={e=>update({enabled:e.target.checked})}/></label>}
    <button onClick={()=>focusRuntime(selection,scene)}>선택 위치 보기</button>
    {selection.kind!=="spawn"&&<button className="ei-delete" disabled={locked} onClick={()=>{const st=useEditorStore.getState();if(selection.kind==="monster")st.removeGameMonster(selection.entityId,scene);else st.removeGamePortal(selection.entityId,scene);}}>{names[selection.kind]} 삭제 (Del)</button>}
    <p className="object-help">방향키: 한 칸 이동 · Esc: 선택 해제 · Ctrl+Z: 실행취소. 실제 게임 원본은 수정하지 않습니다.</p>
  </section>;
}
