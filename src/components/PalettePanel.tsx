import { GameRuntimeLibrary } from "./GameRuntimePanel";
import { GameComparisonSidebar } from "./GameComparisonPanel";
import { GameNpcLibrary, openNpcPanel } from "./GameNpcPanel";
import { GameObjectLibrary } from "./GameObjectPanel";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { DEFAULT_CATEGORY, tilesFromResources, type PaletteTile } from "../lib/palette";
import { isEntityKind } from "../types/entity";
import { fetchSpriteAssets, resolveTiles } from "../lib/apiClient";
import { buildCatalogFromCsv, catalogFromEntries } from "../lib/npcClass";
import { ResourceBrowser, resourceCategoryName } from "./ResourceBrowser";
import { isServerResourceImage, markServerResourceImage } from "../lib/serverResourceImage";
import "./ResourceLibrary.css";

const isServerTile = (tile:PaletteTile) => !!tile.ruid && /^[a-f0-9]{32}$/i.test(tile.ruid);
export function PalettePanel() {
  const gameSync=useEditorStore(s=>s.gameSync),documentNonce=useEditorStore(s=>s.documentNonce);
  const runtimePanel=useGamePreviewStore(s=>s.runtimePanel),showNpcs=useGamePreviewStore(s=>s.showNpcs),showObjects=useGamePreviewStore(s=>s.showObjects);
  const preview=useGamePreviewStore(),comparisonEnabled=preview.comparisonEnabled;
  const groundBrushRuids=preview.scene?.baselineId===gameSync?.baselineId?preview.scene?.groundBrushRuids:undefined;
  const palette=useEditorStore(s=>s.palette),activeIdx=useEditorStore(s=>s.activeIdx),activeTool=useEditorStore(s=>s.activeTool);
  const [search,setSearch]=useState(""),[category,setCategory]=useState("all"),[browseOpen,setBrowseOpen]=useState(false);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState<"resolve"|"select"|null>(null),[loadingIndex,setLoadingIndex]=useState<number|null>(null);
  const [failedThumbs,setFailedThumbs]=useState<Set<string>>(new Set());
  const [failedIndex,setFailedIndex]=useState<number|null>(null);
  const regRef=useRef<HTMLInputElement>(null),npcRef=useRef<HTMLInputElement>(null);
  const request=useRef<AbortController|null>(null),generation=useRef(0);
  const verified=useRef(new Map<string,PaletteTile>());
  useEffect(()=>()=>{generation.current+=1;request.current?.abort();},[]);
  const ready=!gameSync||(preview.status!=="error"&&preview.scene?.baselineId===gameSync.baselineId&&preview.scene.report?.groundEditingSupported===true);
  const query=search.trim().toLocaleLowerCase();
  const eligible=useMemo(()=>palette.flatMap((tile,index)=>{
    if(gameSync&&(!tile.ruid||!groundBrushRuids?.includes(tile.ruid)))return [];
    return [{tile,index}];
  }),[palette,gameSync,groundBrushRuids]);
  const categories=useMemo(()=>[...new Set(eligible.map(({tile})=>tile.category||DEFAULT_CATEGORY))],[eligible]);
  const effectiveCategory=categories.includes(category)?category:"all";
  const visible=eligible.filter(({tile})=>(effectiveCategory==="all"||effectiveCategory===(tile.category||DEFAULT_CATEGORY))&&
    (!query||(tile.name+" "+(tile.ruid??"")+" "+resourceCategoryName(tile.category||DEFAULT_CATEGORY)).toLocaleLowerCase().includes(query)));
  const selected=palette[activeIdx],brushActive=activeTool==="brush"||isEntityKind(activeTool);
  const unresolved=palette.filter(tile=>!isServerTile(tile)).length;

  async function chooseTile(index:number){
    const tile=useEditorStore.getState().palette[index];
    if(!tile||!isServerTile(tile)||!ready)return;
    const token=++generation.current;request.current?.abort();const controller=new AbortController();request.current=controller;
    const before=useEditorStore.getState(),identity=[before.mapName,before.gameSync?.baselineId,before.documentNonce].join(":");
    before.setTool("cursor");setBusy("select");setLoadingIndex(index);setFailedIndex(null);setError("");setNotice("");
    try{
      let resolved=isServerResourceImage(tile)?tile:verified.current.get(tile.ruid!);
      if(resolved&&!isServerResourceImage(resolved))resolved=undefined;
      if(!resolved){
        const data=await fetchSpriteAssets([tile.ruid!],controller.signal),url=data.images[tile.ruid!];
        if(!url)throw new Error("MSW 서버에서 “"+tile.name+"” 이미지를 확인하지 못했습니다. 다시 선택해 재시도하세요.");
        [resolved]=await tilesFromResources([{ruid:tile.ruid!,name:tile.name,subcategory:tile.category,imageUrl:url}]);
        if(!resolved.img)throw new Error("서버 이미지를 열지 못했습니다. 다시 선택해 재시도하세요.");
        markServerResourceImage(resolved);
        verified.current.set(tile.ruid!,resolved);
      }
      if(token!==generation.current||controller.signal.aborted)return;
      const current=useEditorStore.getState();
      if([current.mapName,current.gameSync?.baselineId,current.documentNonce].join(":")!==identity||current.palette[index]?.ruid!==tile.ruid)return;
      const view=useGamePreviewStore.getState();
      // A late image response must not replace a tool or selection made while loading.
      if(current.activeTool!=="cursor"||current.selectedEntityId!==before.selectedEntityId||
        current.selectedGameNpcId!==before.selectedGameNpcId||current.selectedGameRuntime!==before.selectedGameRuntime||
        current.selectedGameObjectIds!==before.selectedGameObjectIds||current.selectedBlockedCells!==before.selectedBlockedCells||
        (current.gameSync&&(view.comparisonEnabled||view.showNpcs||view.showObjects||view.runtimePanel||view.status==="error")))return;
      const old=current.palette[index];
      // Only hydrate the selected server image. Existing indices and authored dimensions stay intact.
      if(old.url!==resolved.url||old.img!==resolved.img){
        const next=current.palette.map((item,i)=>i===index?{...item,url:resolved!.url,img:resolved!.img}:item);
        useEditorStore.setState({palette:next});
      }
      useEditorStore.getState().clearGameSelection();useEditorStore.getState().setActiveIdx(index);
      if(gameSync)useEditorStore.getState().setTool("brush");
    }catch(failure){if(token===generation.current&&!controller.signal.aborted){setFailedIndex(index);setError(failure instanceof Error?failure.message:String(failure));}}
    finally{if(token===generation.current){setBusy(null);setLoadingIndex(null);}}
  }
  async function resolveLegacy(){
    const current=useEditorStore.getState(),targets=current.palette.filter(tile=>!isServerTile(tile));
    if(!targets.length)return;
    const token=++generation.current;request.current?.abort();setBusy("resolve");setFailedIndex(null);setError("");setNotice("");
    try{
      const results=await resolveTiles(targets.map(tile=>({name:tile.name,hash:tile.hash})));
      if(token!==generation.current||useEditorStore.getState().documentNonce!==current.documentNonce)return;
      useEditorStore.getState().applyResolutions(results);
      const count=results.filter(result=>result.ruid).length;
      setNotice(count+"개를 서버 리소스와 연결했습니다."+ (count<targets.length?" 연결하지 못한 소재는 기존 데이터로 보관합니다.":""));
    }catch(failure){if(token===generation.current)setError("서버 연결 확인 실패: "+(failure instanceof Error?failure.message:String(failure)));}
    finally{if(token===generation.current)setBusy(null);}
  }
  async function loadMetadata(event:React.ChangeEvent<HTMLInputElement>,kind:"registry"|"catalog"){
    const files=Array.from(event.target.files??[]);event.target.value="";if(!files.length)return;
    const initialReset=useEditorStore.getState().documentNonce;
    generation.current+=1;request.current?.abort();setBusy(null);setLoadingIndex(null);setFailedIndex(null);setError("");setNotice("");
    try{
      const sources=await Promise.all(files.map(async file=>({name:file.name,text:await file.text()})));
      if(useEditorStore.getState().documentNonce!==initialReset)return;
      const editor=useEditorStore.getState();
      if(kind==="registry"){editor.loadRegistry(JSON.parse(sources[0].text));setNotice("기존 소재의 서버 리소스 연결 정보를 읽었습니다.");}
      else{
        const head=sources[0].text.trimStart();
        if(sources.length===1&&(head.startsWith("{")||head.startsWith("["))){editor.loadNpcCatalog(JSON.parse(sources[0].text));setNotice("NPC·몬스터 종류 목록을 읽었습니다.");}
        else{const result=buildCatalogFromCsv(sources);if(result.entries.length)editor.setNpcCatalog(catalogFromEntries(result.entries));setNotice("종류 목록 "+result.entries.length+"개를 읽었습니다."+ (result.warnings.length?" "+result.warnings.join(" "):""));}
      }
    }catch(failure){setError("연결 정보를 읽지 못했습니다: "+(failure instanceof Error?failure.message:String(failure)));}
  }

  if(gameSync&&comparisonEnabled)return <aside className="palette" aria-label="변경 내역"><GameComparisonSidebar/></aside>;
  if(gameSync&&runtimePanel)return <aside className="palette" aria-label="배치 라이브러리"><GameRuntimeLibrary key={gameSync.baselineId+runtimePanel} kind={runtimePanel}/></aside>;
  if(gameSync&&showNpcs)return <aside className="palette" aria-label="NPC 라이브러리"><GameNpcLibrary key={gameSync.baselineId}/></aside>;
  if(gameSync&&showObjects)return <aside className="palette" aria-label="건물·장식 라이브러리"><GameObjectLibrary/></aside>;
  return <aside className="palette server-palette" aria-label={gameSync?"바닥 소재 라이브러리":"MSW 소재 팔레트"}>
    <header className="server-palette-heading"><div><p className="resource-eyebrow">{gameSync?"이 맵의 MSW 소재":"MSW 서버 리소스"}</p><h2>{gameSync?"바닥 소재":"소재 팔레트"} <span>{eligible.length}</span></h2></div>
      <button className="resource-primary" disabled={!!gameSync && (preview.status!=="ready" || preview.scene?.baselineId!==gameSync.baselineId)} onClick={()=>setBrowseOpen(true)}>{gameSync?"＋ 서버 소재 추가":"＋ 리소스 찾기"}</button>
    </header>
    {gameSync?<div className="palette-library-links"><button onClick={()=>{useGamePreviewStore.getState().setShowObjects(true);useEditorStore.getState().clearGameSelection();useEditorStore.getState().setTool("cursor");}}>건물·장식</button><button onClick={openNpcPanel}>NPC 목록</button><p>큰 타일 묶음은 저장할 때 자동으로 유지합니다.</p></div>:<p className="server-palette-help">서버 라이브러리에서 소재를 가져온 뒤 선택해 배치하세요.</p>}
    <div className="server-palette-filter"><label><span>팔레트 검색</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="이름 또는 리소스 ID 검색"/></label>
      <label><span>분류</span><select value={effectiveCategory} onChange={e=>setCategory(e.target.value)}><option value="all">모든 분류 ({eligible.length})</option>{categories.map(cat=><option key={cat} value={cat}>{resourceCategoryName(cat)} ({eligible.filter(item=>(item.tile.category||DEFAULT_CATEGORY)===cat).length})</option>)}</select></label>
    </div>
    {error&&<div className="resource-message resource-error" role="alert"><span>{error}</span>{failedIndex!==null&&<button disabled={busy!==null} onClick={()=>void chooseTile(failedIndex)}>다시 시도</button>}</div>}
    {notice&&<p className="resource-message" role="status">{notice}</p>}
    {gameSync&&!ready&&<div className="resource-message" role={preview.status==="error"?"alert":"status"}>
      {preview.status==="error"?<><span>바닥 소재를 읽지 못했습니다.</span><button onClick={preview.refresh}>다시 읽기</button></>:preview.status==="loading"?"맵 소재를 읽는 중…":"이 맵은 바닥 대신 건물·장식 목록의 오브젝트 바닥을 사용합니다."}
    </div>}
    <div className="server-palette-results" aria-busy={busy==="select"}><div className="server-palette-results-heading"><span>{visible.length}개 표시</span>{(search||effectiveCategory!=="all")&&<button onClick={()=>{setSearch("");setCategory("all");}}>검색 초기화</button>}</div>
      {!visible.length?<div className="resource-empty"><strong>{eligible.length?"일치하는 소재가 없습니다":gameSync?"사용할 바닥 소재가 없습니다":"아직 소재가 없습니다"}</strong><p>{eligible.length?"다른 검색어나 분류를 선택하세요.":gameSync?"건물·장식 목록에서 이 맵의 원본 소재를 확인하세요.":"MSW 서버에서 필요한 소재를 골라 추가하세요."}</p>{!gameSync&&!eligible.length&&<button className="resource-primary" onClick={()=>setBrowseOpen(true)}>서버 리소스 찾기</button>}</div>:
      <div className="server-palette-grid">{visible.map(({tile,index})=>{
        const enabled=isServerTile(tile)&&ready,active=index===activeIdx&&brushActive,thumbnailKey=(tile.ruid??tile.name)+tile.url.length;
        return <button key={index} type="button" className={"server-palette-tile"+(active?" selected":"")+(enabled?"":" unavailable")} disabled={!enabled||busy==="resolve"} aria-pressed={active}
          aria-label={tile.name+(enabled?"":" · 서버 연결 필요")} title={tile.name+"\n"+resourceCategoryName(tile.category||DEFAULT_CATEGORY)+(tile.ruid?"\n"+tile.ruid:"\n기존 데이터 보관 중 · 서버 리소스 연결 필요")} onClick={()=>void chooseTile(index)}>
          <span className="server-palette-image">{tile.url&&!failedThumbs.has(thumbnailKey)?<img src={tile.url} alt="" loading="lazy" onError={()=>setFailedThumbs(previous=>new Set([...previous,thumbnailKey]))}/>:<span className="resource-image-fallback">이미지 없음</span>}
            <span className={"server-palette-tag"+(!enabled?" muted":"")}>{loadingIndex===index&&busy==="select"?"확인 중…":active?"✓ 선택":enabled?"MSW":"연결 필요"}</span>
          </span><strong>{tile.name}</strong><small>{resourceCategoryName(tile.category||DEFAULT_CATEGORY)}</small>
        </button>;
      })}</div>}
    </div>
    <footer className="server-palette-selected" aria-live="polite">{busy==="select"?<><span className="resource-spinner"/>서버 이미지를 확인하고 있습니다…</>:selected&&brushActive&&isServerTile(selected)?<><strong>선택한 소재</strong><span>{selected.name}</span><small>{gameSync||activeTool==="brush"?"맵에서 클릭·드래그하여 바닥 칠하기":"맵에서 클릭하여 배치"}</small></>:<><strong>소재를 선택하세요</strong><small>그림을 누르면 해당 배치 도구가 준비됩니다.</small></>}</footer>
    {!gameSync&&<details className="server-palette-legacy"><summary>기존 프로젝트 연결 도구{unresolved>0?" · 미연결 "+unresolved+"개":""}</summary><p>이전 소재는 삭제하지 않습니다. 서버와 연결된 소재만 새로 배치할 수 있습니다.</p><div>
      <button disabled={busy!==null||!unresolved} onClick={()=>void resolveLegacy()}>{busy==="resolve"?"연결 확인 중…":"미연결 소재 서버 조회"}</button>
      <button onClick={()=>regRef.current?.click()}>RUID 연결 파일 읽기</button><button onClick={()=>npcRef.current?.click()}>NPC·몬스터 종류 목록</button>
      <input ref={regRef} type="file" accept="application/json,.json" hidden onChange={e=>void loadMetadata(e,"registry")}/>
      <input ref={npcRef} type="file" accept="application/json,.json,text/csv,.csv" multiple hidden onChange={e=>void loadMetadata(e,"catalog")}/>
    </div></details>}
    {browseOpen&&<ResourceBrowser key={documentNonce} gameObjects={!!gameSync} onClose={()=>setBrowseOpen(false)}/>}
  </aside>;
}
