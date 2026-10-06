import { useGamePreviewStore } from "../store/gamePreviewStore";
import { gameRequest } from "../lib/gameWorkspace";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { fetchSpriteAssets, listResources, type ResourceItem } from "../lib/apiClient";
import { tilesFromResources } from "../lib/palette";
import { markServerResourceImage } from "../lib/serverResourceImage";
import "./ResourceLibrary.css";

export const RESOURCE_CATEGORIES = [
  ["all","전체"],["foothold","바닥 타일"],["object","건물·장식"],["background","배경"],
  ["npc","NPC"],["monster","몬스터"],["portal","포털"],["trap","장치"],["item","아이템"],
] as const;
export const resourceCategoryName = (category: string) => RESOURCE_CATEGORIES.find(([id])=>id===category)?.[1] ?? category;
const PAGE = 48;
const validRuid = (ruid: string) => /^[a-f0-9]{32}$/i.test(ruid);
type Query = { category: string; search: string; revision: number };

/** Read-only MSW catalog. Adding only copies verified server resource references into this project. */
export function ResourceBrowser({ onClose, gameObjects = false }: { onClose: () => void; gameObjects?: boolean }) {
  const inPalette = useEditorStore(state=>state.palette);
  const prototypes = useGamePreviewStore(state=>state.scene?.objectPrototypes);
  const havePalette = useMemo(()=>new Set(gameObjects ? (prototypes ?? []).filter(item=>item.resourceId).map(item=>item.ruid) : inPalette.map(tile=>tile.ruid).filter(Boolean)),[inPalette,prototypes,gameObjects]);
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0), addingGeneration = useRef(0);
  const imageRequest = useRef<AbortController | null>(null);
  const [query,setQuery] = useState<Query>({category:gameObjects?"background":"foothold",search:"",revision:0});
  const [search,setSearch] = useState("");
  const [items,setItems] = useState<ResourceItem[]>([]);
  const [cursor,setCursor] = useState<string | null>(null);
  const [loading,setLoading] = useState(false), [adding,setAdding] = useState(false);
  const [error,setError] = useState(""), [addError,setAddError] = useState("");
  const [failedPage,setFailedPage] = useState<{cursor:string|null;replace:boolean}|null>(null);
  const [selected,setSelected] = useState<Map<string,ResourceItem>>(new Map());
  const [anchor,setAnchor] = useState<number|null>(null);
  const [failedThumbnails,setFailedThumbnails] = useState<Set<string>>(new Set());
  const pending = [...selected.values()].filter(item=>!havePalette.has(item.ruid));
  const visibleSelected = items.filter(item=>selected.has(item.ruid)&&!havePalette.has(item.ruid)).length;
  const close = useCallback(()=>{
    generation.current += 1; addingGeneration.current += 1; imageRequest.current?.abort();
    dialog.current?.close(); onClose();
  },[onClose]);

  const load = useCallback(async (target:Query, after:string|null, replace:boolean)=>{
    const request = ++generation.current;
    setLoading(true);setError("");setFailedPage(null);
    if(replace){setItems([]);setCursor(null);setAnchor(null);setFailedThumbnails(new Set());}
    try{
      const result = await listResources({category:"sprite",subcategory:target.category,count:PAGE,searchWord:target.search||null,cursor:after});
      if(request!==generation.current)return;
      if(!Array.isArray(result.items))throw new Error("서버에서 리소스 목록을 받지 못했습니다.");
      const incoming=result.items.filter(item=>typeof item.ruid==="string"&&validRuid(item.ruid));
      setItems(previous=>[...new Map((replace?incoming:[...previous,...incoming]).map(item=>[item.ruid,item])).values()]);
      setCursor(result.nextCursor??null);
    }catch(failure){
      if(request!==generation.current)return;
      setError(failure instanceof Error?failure.message:String(failure));setFailedPage({cursor:after,replace});
    }finally{if(request===generation.current)setLoading(false);}
  },[]);
  useEffect(()=>{
    const element=dialog.current;if(element&&!element.open)element.showModal();
    return ()=>{generation.current+=1;addingGeneration.current+=1;imageRequest.current?.abort();};
  },[]);
  useEffect(()=>{
    // Server request state is reset when a submitted query changes, not on each keystroke.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(query,null,true);
    return ()=>{generation.current+=1;};
  },[query,load]);

  const toggle = (index:number,range:boolean)=>{
    const item=items[index];if(!item||havePalette.has(item.ruid))return;
    setAddError("");
    setSelected(previous=>{
      const next=new Map(previous);
      if(range&&anchor!==null){
        for(let i=Math.min(anchor,index);i<=Math.max(anchor,index);i++){
          const current=items[i];if(current&&!havePalette.has(current.ruid))next.set(current.ruid,current);
        }
      }else if(next.has(item.ruid))next.delete(item.ruid);else next.set(item.ruid,item);
      return next;
    });
    if(!range)setAnchor(index);
  };
  async function addSelected(){
    if(adding||!pending.length)return;
    const token=++addingGeneration.current,controller=new AbortController();imageRequest.current?.abort();imageRequest.current=controller;
    const before=useEditorStore.getState(),projectIdentity=[before.mapName,before.gameSync?.baselineId,before.resetNonce].join(":");
    setAdding(true);setAddError("");
    try{
      if(gameObjects){
        if(!before.gameSync)throw new Error("게임 맵을 먼저 열어 주세요.");
        const result = await gameRequest<{resourceIds:string[]}>({ action:"register-object-resources", mapName:before.gameSync.mapName, baselineId:before.gameSync.baselineId, resources:pending.map(item=>({ruid:item.ruid,name:item.name})) });
        if(token!==addingGeneration.current||controller.signal.aborted)return;
        const current=useEditorStore.getState();
        if([current.mapName,current.gameSync?.baselineId,current.resetNonce].join(":")!==projectIdentity)throw new Error("편집 중인 맵이 바뀌었습니다. 다시 선택해 주세요.");
        current.addGameResourceReferences(result.resourceIds);
        useGamePreviewStore.getState().setShowObjects(true);
        close();return;
      }
      const assets=await fetchSpriteAssets(pending.map(item=>item.ruid),controller.signal);
      if(token!==addingGeneration.current||controller.signal.aborted)return;
      const missing=pending.filter(item=>!assets.images[item.ruid]);
      if(missing.length)throw new Error("이미지를 확인하지 못한 "+missing.length+"개가 있습니다: "+missing.slice(0,3).map(item=>item.name).join(", ")+". 선택을 조정하거나 다시 시도하세요.");
      const tiles=await tilesFromResources(pending.map(item=>({...item,imageUrl:assets.images[item.ruid]})));
      if(token!==addingGeneration.current||controller.signal.aborted)return;
      if(tiles.some(tile=>!tile.img))throw new Error("일부 이미지를 열지 못했습니다. 잠시 뒤 다시 추가해 주세요.");
      const current=useEditorStore.getState();
      if([current.mapName,current.gameSync?.baselineId,current.resetNonce].join(":")!==projectIdentity)throw new Error("편집 중인 프로젝트가 바뀌었습니다. 창을 닫고 다시 선택해 주세요.");
      tiles.forEach(markServerResourceImage);
      current.addResolvedTiles(tiles);close();
    }catch(failure){if(token===addingGeneration.current&&!controller.signal.aborted)setAddError(failure instanceof Error?failure.message:String(failure));}
    finally{if(token===addingGeneration.current)setAdding(false);}
  }
  return <dialog ref={dialog} className="resource-dialog" aria-labelledby="resource-dialog-title"
    onCancel={event=>{event.preventDefault();close();}}
    onKeyDown={event=>{event.stopPropagation();if(event.key==="Escape"){event.preventDefault();close();}}}
    onKeyUp={event=>event.stopPropagation()}>
    <header className="resource-dialog-header">
      <div><p className="resource-eyebrow">MSW 서버 리소스</p><h2 id="resource-dialog-title">라이브러리에서 소재 선택</h2><p>{gameObjects?"선택한 이미지를 이 맵의 건물·장식 소재로 추가합니다. 바닥 브러시와 NPC·몬스터 배치는 기존 전용 도구를 이용하세요.":"선택한 서버 이미지를 팔레트에 추가합니다."}</p></div>
      <button type="button" className="resource-close" onClick={close} aria-label="리소스 라이브러리 닫기">닫기 <kbd>Esc</kbd></button>
    </header>
    <div className="resource-search-area">
      <form className="resource-search" onSubmit={event=>{event.preventDefault();setQuery(q=>({...q,search:search.trim(),revision:q.revision+1}));}}>
        <label className="resource-search-label"><span>소재 이름 검색</span><input autoFocus type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="나무, 벽, 타일…" disabled={adding}/></label>
        <button type="submit" className="resource-primary" disabled={adding}>검색</button>
      </form>
      <div className="resource-categories" role="group" aria-label="리소스 분류">
        {RESOURCE_CATEGORIES.map(([id,label])=><button key={id} type="button" aria-pressed={query.category===id} disabled={adding} onClick={()=>setQuery(q=>({...q,category:id,revision:q.revision+1}))}>{label}</button>)}
      </div>
    </div>
    <div className="resource-results-meta"><span>{resourceCategoryName(query.category)}{query.search&&" · “"+query.search+"”"} · {items.length}개{cursor?" 이상":""}</span>
      <button type="button" disabled={adding||loading||!items.some(item=>!havePalette.has(item.ruid))} onClick={()=>setSelected(previous=>new Map([...previous,...items.filter(item=>!havePalette.has(item.ruid)).map(item=>[item.ruid,item] as const)]))}>현재 결과 모두 선택</button>
    </div>
    {error&&<div className="resource-message resource-error" role="alert"><strong>목록을 불러오지 못했습니다.</strong><span>{error}</span><button onClick={()=>void load(query,failedPage?.cursor??null,failedPage?.replace??true)} disabled={loading||adding}>다시 시도</button></div>}
    <div className="resource-result-scroll" aria-busy={loading} aria-label="서버 리소스 검색 결과">
      {!items.length&&!loading&&!error&&<div className="resource-empty"><strong>검색 결과가 없습니다</strong><p>검색어를 짧게 바꾸거나 전체 분류에서 찾아보세요.</p><button onClick={()=>{setSearch("");setQuery(q=>({category:"all",search:"",revision:q.revision+1}));}}>전체 소재 보기</button></div>}
      {!items.length&&loading&&<div className="resource-empty" role="status"><span className="resource-spinner"/><strong>MSW 소재를 읽는 중…</strong><p>이미지가 많은 분류는 잠시 걸릴 수 있습니다.</p></div>}
      <div className="resource-results-grid">
        {items.map((item,index)=>{
          const already=havePalette.has(item.ruid),chosen=selected.has(item.ruid)&&!already;
          return <button key={item.ruid} type="button" className={"resource-card"+(chosen?" chosen":"")+(already?" present":"")}
            disabled={already||adding} aria-pressed={chosen} aria-label={item.name+(already?(gameObjects?" · 이 맵에 추가된 소재":" · 이미 팔레트에 있음"):chosen?" · 선택됨":"")}
            title={item.name+"\n"+resourceCategoryName(item.subcategory)+"\n"+item.ruid} onClick={event=>toggle(index,event.shiftKey)}>
            <span className="resource-card-image">{item.imageUrl&&!failedThumbnails.has(item.ruid)?<img src={item.imageUrl} alt="" loading="lazy" onError={()=>setFailedThumbnails(previous=>new Set([...previous,item.ruid]))}/>:<span className="resource-image-fallback">미리보기 없음</span>}
              {(chosen||already)&&<span className="resource-card-check">{already?"추가됨":"✓ 선택"}</span>}</span>
            <span className="resource-card-name">{item.name}</span><small>{resourceCategoryName(item.subcategory)}</small>
          </button>;
        })}
      </div>
      {items.length>0&&<div className="resource-more">{cursor?<button onClick={()=>void load(query,cursor,false)} disabled={loading||adding}>{loading?"불러오는 중…":"소재 더 보기"}</button>:!loading&&!error&&<span>현재 검색 결과를 모두 불러왔습니다.</span>}</div>}
    </div>
    <footer className="resource-dialog-footer">
      {addError&&<div className="resource-message resource-error" role="alert">{addError}</div>}
      <div className="resource-selection-summary"><div><strong>{pending.length}개 선택</strong><span>{pending.length>visibleSelected?"다른 검색에서 선택한 "+(pending.length-visibleSelected)+"개 포함 · ":""}Shift+클릭으로 여러 개 선택</span></div><button disabled={!pending.length||adding} onClick={()=>{setSelected(new Map());setAnchor(null);setAddError("");}}>선택 해제</button>
        <button className="resource-primary" disabled={!pending.length||adding} onClick={()=>void addSelected()}>{adding?"서버 이미지 확인 중…":pending.length+(gameObjects?"개 소재 추가":"개 팔레트에 추가")}</button></div>
    </footer>
  </dialog>;
}
