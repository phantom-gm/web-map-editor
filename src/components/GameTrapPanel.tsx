import {useState} from "react";
import {useEditorStore} from "../store/editorStore";
import {useGamePreviewStore} from "../store/gamePreviewStore";
import {useWorkspaceSession} from "../lib/gameWorkspace";
import {activateEditorTool} from "../lib/editorCommands";
import {runtimeSourceKey,parseGameRuntimeSync,type TrapFields} from "../lib/gameRuntime";
import {previewWorldToScreen,type GamePreviewScene} from "../lib/gamePreview";
import type {ProjectFile} from "../lib/projectIO";
import {NumberField} from "./NumberField";

function focus(scene:GamePreviewScene,cell:number[],maxCell:number[]){const st=useEditorStore.getState(),rect=document.querySelector(".canvas-wrap")?.getBoundingClientRect();if(!rect)return;const x=(cell[0]+maxCell[0])/2,y=(cell[1]+maxCell[1])/2,c=scene.constants;const p=previewWorldToScreen([(x-y)*c.TILE_W/2,-(x+y-c.ORIGIN_X-c.ORIGIN_Y)*c.TILE_H/2],scene,st.camera);st.setCamera({...st.camera,x:st.camera.x+rect.width/2-p[0],y:st.camera.y+rect.height/2-p[1]});}
export function GameTrapLibrary(){
 const view=useGamePreviewStore(),st=useEditorStore(),loading=useWorkspaceSession(s=>s.loading),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[effect,setEffect]=useState(1011);
 const scene=view.scene?.baselineId===st.gameSync?.baselineId?view.scene:null,ready=!!scene&&view.status==="ready"&&!loading&&!view.comparisonEnabled&&!busy,editable=ready&&scene?.trapEditingSupported&&!scene.runtimeSource?.stale;
 const effects=(scene?.trapCatalog??[]).filter(e=>e.canAdd),chosen=effects.some(e=>e.abnormalityId===effect)?effect:effects[0]?.abnormalityId;
 async function refresh(){const current=useEditorStore.getState();if(!current.gameSync)return;if((current.gameMonsterEdits||current.gamePortalEdits||current.gameSpawnEdits||current.gameTrapEdits)&&!window.confirm("몬스터·포탈·시작점·함정 편집을 지우고 최신 배치 원본을 읽습니다. 다른 작업은 유지하며 Ctrl+Z로 되돌릴 수 있습니다. 계속할까요?"))return;const baselineId=current.gameSync.baselineId,key=runtimeSourceKey(current);setBusy(true);setError(null);try{const r=await fetch("/api/game-sync",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"refresh-runtime",project:current.exportProject()})});const d=await r.json() as {project?:ProjectFile;error?:string};if(!r.ok||d.project?.gameSync?.baselineId!==baselineId)throw Error(d.error||"함정 원본을 읽지 못했습니다.");const sync=parseGameRuntimeSync(d.project.gameRuntimeSync);if(sync&&useEditorStore.getState().replaceGameRuntimeSource(sync,baselineId,key))view.setRuntimePlacement(null);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 return <section className="game-runtime-library" aria-label="함정 영역 목록">
  <div className="palette-head"><strong>함정 영역</strong><button onClick={()=>activateEditorTool("brush")}>바닥 소재</button></div>
  <p className="object-help">색칠된 닫힌 사각형 안에 들어선 플레이어에게 상태이상을 부여합니다. 겹친 영역은 목록의 첫 함정이 적용됩니다.</p>
  {(error||st.gameRuntimeError)&&<p className="selection-error" role="alert">{error||st.gameRuntimeError}</p>}
  {scene?.trapEditingReasons?.map((r,i)=><p className="object-help" key={i}>{r}</p>)}
  {scene?.runtimeSource?.stale&&<p className="selection-error">배치 원본이 바뀌었습니다. 최신 원본을 다시 읽어 주세요.</p>}
  <label className="ei-row"><span>새 함정 효과</span><select aria-label="새 함정 상태이상" disabled={!editable} value={chosen??""} onChange={e=>setEffect(Number(e.target.value))}>{effects.map(a=><option key={a.abnormalityId} value={a.abnormalityId}>{a.name} ({a.abnormalityId}){a.isComa?" · 코마":""}</option>)}</select></label>
  <button disabled={!editable||!chosen} onClick={()=>{view.setRuntimePlacement({kind:"trap",abnormalityId:chosen!});st.clearGameSelection();st.setTool("trap");}}>맵에 함정 놓기</button>
  {view.runtimePlacement?.kind==="trap"&&<p className="object-placement">시작 칸 클릭 → 오른쪽 속성에서 끝 칸 지정. <button onClick={()=>{view.setRuntimePlacement(null);st.setTool("cursor");}}>취소 (Esc)</button></p>}
  <div className="game-object-list">{scene?.traps?.map((t,i)=><button key={t.entityId} disabled={!ready} className={"game-object-item"+(st.selectedGameRuntime?.kind==="trap"&&st.selectedGameRuntime.entityId===t.entityId?" selected":"")} onClick={()=>{view.setRuntimePlacement(null);st.setTool("cursor");st.selectGameRuntime({kind:"trap",entityId:t.entityId});focus(scene,t.cell,t.maxCell);}}><span>{i+1}. {t.name}<small>{t.trapId}</small><small>({t.cell.join(", ")}) ~ ({t.maxCell.join(", ")})</small></span></button>)}</div>
  {ready&&!scene?.traps?.length&&<p className="object-help">이 맵에는 함정이 없습니다.</p>}
  <p className="object-help">코마는 HP 0·25초 뒤 사망으로 이어집니다. 해제 후 같은 칸에서는 재발동하지 않으며 다른 칸으로 이동하면 다시 판정합니다.</p>
  <button disabled={!ready} onClick={()=>void refresh()}>{busy?"불러오는 중…":"배치 원본 다시 읽기"}</button>
 </section>;
}
export function GameTrapInspector({scene,entityId}:{scene:GamePreviewScene;entityId:string}){
 const st=useEditorStore(),view=useGamePreviewStore(),loading=useWorkspaceSession(s=>s.loading),item=scene.traps?.find(t=>t.entityId===entityId);if(!item)return null;
 const locked=loading||view.status!=="ready"||view.comparisonEnabled||!item.canEdit||!!scene.runtimeSource?.stale;
 const update=(patch:Partial<TrapFields>)=>useEditorStore.getState().updateGameTrap(entityId,patch,scene);
 const move=(x:number,y:number)=>update({cell:[item.cell[0]+x,item.cell[1]+y],maxCell:[item.maxCell[0]+x,item.maxCell[1]+y]});
 const effect=scene.trapCatalog?.find(a=>a.abnormalityId===item.abnormalityId);
 return <section className="entity-inspector" aria-label="함정 속성">
  <div className="ei-head"><strong>함정 · {item.name}</strong><button aria-label="함정 선택 해제" onClick={()=>st.selectGameRuntime(null)}>✕</button></div>
  {st.gameRuntimeError&&<p className="selection-error" role="alert">{st.gameRuntimeError}</p>}
  <small>{item.trapId}</small>
  {(["cell","maxCell"] as const).map((key,i)=><div className="ei-grid2" key={key}>{([0,1] as const).map(axis=><label className="ei-row" key={axis}><span>{i?"끝":"시작"} {axis?"Y":"X"}</span><NumberField value={item[key][axis]} min={0} max={st.size[axis]-1} disabled={locked} onCommit={n=>{const value:[number,number]=[...item[key]];value[axis]=n;update({[key]:value});}}/></label>)}</div>)}
  <p className="object-help">경계 포함 {(item.maxCell[0]-item.cell[0]+1)*(item.maxCell[1]-item.cell[1]+1)}칸 · 이동불가 영역과 별개입니다.</p>
  <label className="ei-row"><span>상태이상</span><select aria-label="함정 상태이상" value={item.abnormalityId} disabled={locked} onChange={e=>update({abnormalityId:Number(e.target.value)})}>{scene.trapCatalog?.filter(a=>a.canAdd||a.abnormalityId===item.abnormalityId).map(a=><option value={a.abnormalityId} key={a.abnormalityId}>{a.name} ({a.abnormalityId})</option>)}</select></label>
  {effect&&<p className="object-help">{effect.durationMs/1000}초{effect.isComa?" · 코마 → 사망/기존 부활 처리":""}</p>}
  <div className="object-nudge">{[[-1,0,"↖"],[0,-1,"↗"],[0,1,"↙"],[1,0,"↘"]].map(([x,y,label])=><button key={label} disabled={locked} onClick={()=>move(Number(x),Number(y))}>{label}</button>)}</div>
  <button onClick={()=>focus(scene,item.cell,item.maxCell)}>영역 가운데 보기</button>
  <button disabled={locked} onClick={()=>st.addGameTrap({cell:[...item.cell],maxCell:[...item.maxCell],abnormalityId:item.abnormalityId},scene)}>함정 복제</button>
  <button className="ei-delete" disabled={locked} onClick={()=>st.removeGameTrap(entityId,scene)}>함정 삭제 (Del)</button>
  <p className="object-help">드래그·방향키로 영역 이동 · Ctrl+Z 실행취소. 작업 저장 후 후보 맵 굽기로 게임용 CSV를 출력합니다.</p>
 </section>;
}
