'use strict';
// Runtime spawn tables only. All filesystem access and candidate paths remain in core.cjs.
const crypto = require('node:crypto');
const { parseCsv, world } = require('./npcs.cjs');
const FILES = ['DT_MonsterSpawn.csv','DT_MonsterClass.csv','DT_MonsterAppearance.csv','ST_MonsterName.csv','DT_Portal.csv','DT_Bounds.csv','DT_Walk.csv','DT_GameConfig.csv'];
const ID = /^[A-Za-z0-9_-]{1,128}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const M_FIELDS = ['monsterClassId','cell','count','spread','respawnMinSec','respawnMaxSec','firstSpawnSec','enabled'];
const P_FIELDS = ['cell','destMap','destCell','destFacing','enabled'];
const M_COLUMNS = { monsterClassId:'MonsterClassID',count:'Count',spread:'Spread',respawnMinSec:'RespawnMinSec',respawnMaxSec:'RespawnMaxSec',firstSpawnSec:'FirstSpawnSec',enabled:'Enabled' };
const P_COLUMNS = { destMap:'DestMap',destFacing:'DestFacing',enabled:'Enabled' };
const clone = v => JSON.parse(JSON.stringify(v));
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v;
const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const key = c => c.join(',');
function fail(code, message) { const e = new Error(message); e.name='GameSyncError'; e.code=code; throw e; }
function exact(value, fields) { return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(k=>fields.includes(k)); }
function number(value, fallback=0) { const n = value === '' || value == null ? fallback : Number(value); if (!Number.isFinite(n)) fail('UNSUPPORTED_RUNTIME','런타임 CSV 숫자 값이 올바르지 않습니다.'); return n; }
function int(value, fallback=0) { const n=number(value,fallback); if (!Number.isSafeInteger(n)) fail('UNSUPPORTED_RUNTIME','런타임 CSV 좌표·수량은 정수여야 합니다.'); return n; }
function bool(value, fallback=true) { if (value === '' || value == null) return fallback; if (/^(true|1)$/i.test(value)) return true; if (/^(false|0)$/i.test(value)) return false; fail('UNSUPPORTED_RUNTIME','런타임 CSV 활성 값이 올바르지 않습니다.'); }
function table(files,name,required) { const file=files[name]; if (!file) fail('UNSUPPORTED_RUNTIME',name+' CSV가 없습니다.'); return parseCsv(file.bytes,required); }
function identify(parsed,idColumn,mapColumn) {
  const seen=new Set();
  return parsed.rows.map(r=> { const id=r.data[idColumn], map=r.data[mapColumn]; if (!ID.test(id||'') || !ID.test(map||'') || seen.has(id)) fail('UNSUPPORTED_RUNTIME','런타임 ID가 중복되었거나 올바르지 않습니다: '+id); seen.add(id); return {...r,id,map}; });
}
function monsterRows(files) { return identify(table(files,'DT_MonsterSpawn',['MonsterSpawnID','MapName','MonsterClassID','CellX','CellY','Count','Spread','RespawnMinSec','RespawnMaxSec','FirstSpawnSec','Enabled','Scale','FlipX']),'MonsterSpawnID','MapName').map(r=>({...r,values:{monsterClassId:int(r.data.MonsterClassID),cell:[int(r.data.CellX),int(r.data.CellY)],count:int(r.data.Count,1),spread:int(r.data.Spread,1),respawnMinSec:number(r.data.RespawnMinSec),respawnMaxSec:number(r.data.RespawnMaxSec),firstSpawnSec:number(r.data.FirstSpawnSec),enabled:bool(r.data.Enabled)}})); }
function portalRows(files) { return identify(table(files,'DT_Portal',['PortalID','SrcMap','SrcX','SrcY','DestMap','DestX','DestY','DestFacing','Enabled']),'PortalID','SrcMap').map(r=>({...r,values:{cell:[int(r.data.SrcX),int(r.data.SrcY)],destMap:r.data.DestMap,destCell:[int(r.data.DestX),int(r.data.DestY)],destFacing:r.data.DestFacing||'SE',enabled:bool(r.data.Enabled)}})); }
function boundsRows(files) { return identify(table(files,'DT_Bounds',['MapName','MinX','MaxX','MinY','MaxY','SpawnX','SpawnY']),'MapName','MapName').map(r=>({...r,bounds:{minX:int(r.data.MinX),maxX:int(r.data.MaxX),minY:int(r.data.MinY),maxY:int(r.data.MaxY)},cell:[int(r.data.SpawnX),int(r.data.SpawnY)]})); }
function walkRows(files) { return table(files,'DT_Walk',['MapName','CellX','CellY']).rows.map(r=>({map:r.data.MapName,cell:[int(r.data.CellX),int(r.data.CellY)]})); }
function inBounds(c,b) { return Array.isArray(c)&&c.length===2&&c.every(Number.isSafeInteger)&&b&&c[0]>=b.minX&&c[0]<=b.maxX&&c[1]>=b.minY&&c[1]<=b.maxY; }
function analyzeRuntime(files,mapName,sourceId=null) {
  const out={files,mapName,sourceId,reasons:{monsters:[],portals:[],spawn:[]},supported:{monsters:false,portals:false,spawn:false},monsters:[],portals:[],bounds:[],walk:[],catalog:[],portalRuid:'',spawn:null};
  const tryKind=(kind,fn)=>{try{fn();out.supported[kind]=true;}catch(e){if(e.name!=='GameSyncError')throw e;out.reasons[kind].push(e.message);}};
  let placementReady=false;
  try { out.bounds=boundsRows(files); out.walk=walkRows(files); placementReady=true; } catch(e) { if(e.name!=='GameSyncError')throw e; for(const k of Object.keys(out.reasons))out.reasons[k].push(e.message); }
  const mapBounds=out.bounds.find(r=>r.map===mapName);
  tryKind('monsters',()=>{
    if(!placementReady||!mapBounds)fail('UNSUPPORTED_RUNTIME','현재 맵 경계가 없습니다.');
    const appearances=table(files,'DT_MonsterAppearance',['MonsterAppearanceID','Action','BaseDir','Ruid']).rows;
    const classes=table(files,'DT_MonsterClass',['MonsterClassID','MonsterName','MonsterAppearanceID','ModelID','BodyScale']).rows;
    const names=new Map(files.ST_MonsterName ? table(files,'ST_MonsterName',['Key']).rows.map(r=>[r.data.Key,r.data.ko||r.data.Source||r.data.Key]) : []), seen=new Set();
    out.catalog=classes.map(r=>{const d=r.data,id=int(d.MonsterClassID),arts=appearances.filter(a=>a.data.MonsterAppearanceID===d.MonsterAppearanceID&&a.data.Action==='Idle'&&a.data.BaseDir==='SE');
      if(seen.has(id))fail('UNSUPPORTED_RUNTIME','몬스터 종류 ID가 중복되었습니다.');seen.add(id);
      const ruid=arts.length===1?arts[0].data.Ruid:'',bodyScale=number(d.BodyScale,1),canAdd=id>0&&!!d.ModelID&&/^[a-f0-9]{32}$/i.test(ruid)&&bodyScale>0&&bodyScale<=20&&!d.BodyTint;
      return {monsterClassId:id,name:names.get(d.MonsterName)||d['#DevName']||d.MonsterName||String(id),ruid,bodyScale:bodyScale>0?bodyScale:1,canAdd,...(canAdd?{}:{reason:'모델·Idle SE 외형·배율 또는 몸 색상 지원을 확인할 수 없습니다.'})}; });
    out.monsters=monsterRows(files);
  });
  tryKind('portals',()=>{if(!placementReady||!mapBounds)fail('UNSUPPORTED_RUNTIME','현재 맵 경계가 없습니다.');out.portals=portalRows(files);
    if(files.DT_GameConfig){const rows=table(files,'DT_GameConfig',['ConfigKey','ConfigValue']).rows.filter(r=>r.data.ConfigKey==='PortalSpriteRuid');if(rows.length===1&&/^[a-f0-9]{32}$/i.test(rows[0].data.ConfigValue))out.portalRuid=rows[0].data.ConfigValue;}
  });
  tryKind('spawn',()=>{if(!placementReady||!mapBounds)fail('UNSUPPORTED_RUNTIME','현재 맵 시작점이 없습니다.');if(mapBounds.bounds.minX>mapBounds.bounds.maxX||mapBounds.bounds.minY>mapBounds.bounds.maxY)fail('UNSUPPORTED_RUNTIME','맵 경계가 잘못되었습니다.');out.spawn=mapBounds;});
  return out;
}
function overlay(raw,fields,profile,kind) {
  if(raw===undefined||raw===null)return null;
  if(!exact(raw,['version','updated','removed','added'])||raw.version!==1||!['updated','removed','added'].every(k=>Array.isArray(raw[k])))fail('INVALID_RUNTIME_EDIT','런타임 편집 형식이 올바르지 않습니다.');
  if(!profile.supported[kind]&&(raw.updated.length||raw.removed.length||raw.added.length))fail('UNSUPPORTED_RUNTIME',profile.reasons[kind].join(' '));
  const seen=new Set(),target=id=>{if(typeof id!=='string'||!ID.test(id)||seen.has(id))fail('INVALID_RUNTIME_EDIT','런타임 편집 ID가 중복되었거나 올바르지 않습니다.');seen.add(id);};
  const items=(rows,added)=>rows.map(r=>{if(!exact(r,['entityId',...fields])||(!added&&!fields.some(k=>r[k]!==undefined))||(added&&!UUID.test(r.entityId||'')))fail('INVALID_RUNTIME_EDIT','지원하지 않는 런타임 편집 필드입니다.');target(r.entityId);return Object.fromEntries(['entityId',...fields].filter(k=>r[k]!==undefined).map(k=>[k,clone(r[k])]));});
  const updated=items(raw.updated,false),removed=raw.removed.map(id=>{target(id);return id;}),added=items(raw.added,true);
  return updated.length||removed.length||added.length?{version:1,updated,removed,added}:null;
}
function inspectRuntime(project,profile,constants,npcs=[]) {
  const bounds=profile.bounds.find(b=>b.map===profile.mapName)?.bounds,warnings=[];
  const mapByName=new Map(profile.bounds.map(b=>[b.map,b]));
  const blockedFor=map=>map===profile.mapName?new Set(project.blocked.map(key)):new Set(profile.walk.filter(r=>r.map===map).map(r=>key(r.cell)));
  const currentBlocked=blockedFor(profile.mapName),catalog=new Map(profile.catalog.map(r=>[r.monsterClassId,r]));
  const echoes={monsters:overlay(project.gameMonsterEdits,M_FIELDS,profile,'monsters'),portals:overlay(project.gamePortalEdits,P_FIELDS,profile,'portals'),spawn:null};
  const validateMonster=v=>{if(!catalog.get(v.monsterClassId)?.canAdd||!inBounds(v.cell,bounds)||!Number.isSafeInteger(v.count)||v.count<1||v.count>200||!Number.isSafeInteger(v.spread)||v.spread<0||v.spread>Math.max(bounds.maxX-bounds.minX+1,bounds.maxY-bounds.minY+1)||!['respawnMinSec','respawnMaxSec','firstSpawnSec'].every(k=>Number.isFinite(v[k])&&v[k]>=0&&v[k]<=31536000)||typeof v.enabled!=='boolean')fail('INVALID_RUNTIME_EDIT','몬스터 종류·중심·수량·범위·리젠 시간을 확인하세요.');
    if(v.enabled){let available=0;for(let y=Math.max(bounds.minY,v.cell[1]-v.spread);y<=Math.min(bounds.maxY,v.cell[1]+v.spread);y++)for(let x=Math.max(bounds.minX,v.cell[0]-v.spread);x<=Math.min(bounds.maxX,v.cell[0]+v.spread);x++)if(!currentBlocked.has(key([x,y]))&&!npcs.some(n=>n.enabled&&same(n.cell,[x,y])))available++;
      if(!available)fail('NO_MONSTER_CELLS','몬스터 스폰 범위에 걸을 수 있는 빈 셀이 없습니다.');if(available<v.count)warnings.push('몬스터 스폰 범위의 정적 빈 칸 '+available+'개보다 수량 '+v.count+'개가 많아 실제 수량이 줄 수 있습니다.');}
  };
  const validatePortal=(v,previous)=>{const dest=mapByName.get(v.destMap);if(!inBounds(v.cell,bounds)||!ID.test(v.destMap||'')||!dest||!inBounds(v.destCell,dest.bounds)||!['NE','SE','SW','NW'].includes(v.destFacing)||typeof v.enabled!=='boolean')fail('INVALID_RUNTIME_EDIT','포탈 출발·도착 맵과 좌표·방향을 확인하세요.');
    if(v.enabled&&(!previous||!same(v.cell,previous.cell)||!previous.enabled)&&currentBlocked.has(key(v.cell)))fail('BLOCKED_PORTAL','포탈 출발 셀이 이동불가입니다.');
    if(v.enabled&&(!previous||v.destMap!==previous.destMap||!same(v.destCell,previous.destCell)||!previous.enabled)&&blockedFor(v.destMap).has(key(v.destCell)))fail('BLOCKED_PORTAL','포탈 도착 셀이 이동불가입니다.');
  };
  function editRows(kind,rows,fields,validate){const source=rows.filter(r=>r.map===profile.mapName),records=new Map(source.map(r=>[r.id,{entityId:r.id,id:r.id,source:r.values,values:clone(r.values),row:r}])),allIds=new Set(rows.map(r=>r.id));const changed=[],added=[],removed=[],moved=[],updated=[],raw=echoes[kind];
    for(const patch of raw?.updated||[]){const old=records.get(patch.entityId);if(!old)fail('INVALID_RUNTIME_EDIT','수정할 런타임 행이 없습니다.');const values={...old.values,...Object.fromEntries(fields.filter(k=>patch[k]!==undefined).map(k=>[k,patch[k]]))};if(!same(values,old.values)){validate(values,old.values);const record={...old,values};records.set(record.entityId,record);changed.push(record);if(!same(values.cell,old.source.cell))moved.push(record);if(fields.some(k=>k!=='cell'&&!same(values[k],old.source[k])))updated.push(record);}}
    for(const id of raw?.removed||[]){const old=records.get(id);if(!old)fail('INVALID_RUNTIME_EDIT','삭제할 런타임 행이 없습니다.');removed.push(old);records.delete(id);}
    for(const item of raw?.added||[]){const id=profile.mapName+'_Editor_'+item.entityId;if(allIds.has(id)||allIds.has(item.entityId)||records.has(item.entityId))fail('RUNTIME_ID_COLLISION','새 런타임 행 ID가 이미 존재합니다.');const values=Object.fromEntries(fields.map(k=>[k,item[k]]));validate(values,null);const record={entityId:item.entityId,id,source:null,values};added.push(record);records.set(item.entityId,record);}
    const comparison={moved:moved.map(r=>({entityId:r.entityId,from:world(r.source.cell,constants),to:world(r.values.cell,constants)})),added:added.map(r=>({entityId:r.entityId,position:world(r.values.cell,constants)})),removed:removed.map(r=>({entityId:r.entityId,position:world(r.values.cell,constants)})),updated:updated.map(r=>({entityId:r.entityId,position:world(r.values.cell,constants)}))};
    return {records,changed,added,removed,moved,updated,comparison,edited:changed.length+added.length+removed.length};
  }
  const monsters=editRows('monsters',profile.monsters,M_FIELDS,validateMonster),portals=editRows('portals',profile.portals,P_FIELDS,validatePortal);
  const touched=new Set([...portals.changed,...portals.added].map(r=>r.entityId)),occupied=new Map();for(const r of portals.records.values())if(r.values.enabled){const k=key(r.values.cell),other=occupied.get(k);if(other&&(touched.has(r.entityId)||touched.has(other)))fail('PORTAL_OCCUPIED','같은 출발 셀에 활성 포탈을 중복 배치할 수 없습니다.');occupied.set(k,r.entityId);}
  const descriptor=r=>({entityId:r.entityId,sourceCell:r.source?.cell||null,source:r.source?clone(r.source):null,...clone(r.values),position:world(r.values.cell,constants)});
  const monsterDescriptors=[...monsters.records.values()].map(r=>{const c=catalog.get(r.values.monsterClassId);return {...descriptor(r),spawnId:r.id,name:c?.name||String(r.values.monsterClassId),ruid:c?.ruid||'',bodyScale:c?.bodyScale||1,canEdit:!!c?.canAdd,...(c?.canAdd?{}:{reason:c?.reason||'몬스터 종류를 확인할 수 없습니다.'})};});
  const portalDescriptors=[...portals.records.values()].map(r=>({...descriptor(r),portalId:r.id,ruid:profile.portalRuid,canEdit:profile.supported.portals}));
  const total=monsterDescriptors.filter(r=>r.enabled).reduce((sum,r)=>sum+r.count,0)+npcs.filter(r=>r.enabled).length;if(total>200)warnings.push('현재 맵의 몬스터 수량과 NPC 합계 '+total+'개가 런타임 상한 200개를 넘어 일부가 생성되지 않을 수 있습니다.');
  let spawn=profile.spawn?{cell:[...profile.spawn.cell],sourceCell:[...profile.spawn.cell],position:world(profile.spawn.cell,constants),bounds:clone(profile.spawn.bounds),canEdit:profile.supported.spawn}:null,spawnChanged=false;
  if(project.gameSpawnEdits!==undefined&&project.gameSpawnEdits!==null){const raw=project.gameSpawnEdits;if(!exact(raw,['version','cell'])||raw.version!==1||!inBounds(raw.cell,bounds)||!spawn)fail('INVALID_RUNTIME_EDIT','시작점은 현재 맵 안의 정수 셀이어야 합니다.');echoes.spawn={version:1,cell:[...raw.cell]};spawnChanged=!same(raw.cell,spawn.sourceCell);if(spawnChanged){if(currentBlocked.has(key(raw.cell)))fail('BLOCKED_SPAWN','시작점은 이동 가능한 셀이어야 합니다.');if(npcs.some(n=>n.enabled&&same(n.cell,raw.cell)))fail('OCCUPIED_SPAWN','시작점에 NPC가 있습니다.');spawn={...spawn,cell:[...raw.cell],position:world(raw.cell,constants)};}}
  if(monsterDescriptors.length)warnings.push('몬스터 이미지는 스포너 중심을 나타냅니다. 실제 개체는 범위 안에서 무작위로 배치되며 런타임 깊이·AI·전투는 별도 검증 대상입니다.');
  if(portalDescriptors.length)warnings.push('포탈은 정적 위치 표시입니다. 런타임 깊이 보정과 실제 맵 이동은 별도 게임 검증이 필요합니다.');
  return {profile,monsters,portals,spawn,spawnChanged,edited:monsters.edited+portals.edited+Number(spawnChanged),warnings,echoes,
    scene:{monsters:monsterDescriptors,monsterCatalog:profile.catalog,portals:portalDescriptors,spawn,mapDestinations:profile.bounds.map(r=>({mapName:r.map,bounds:clone(r.bounds),spawnCell:[...r.cell],blocked:[...blockedFor(r.map)].map(k=>k.split(',').map(Number)),canTarget:r.bounds.minX<=r.bounds.maxX&&r.bounds.minY<=r.bounds.maxY}))},
    comparison:{monsters:monsters.comparison,portals:portals.comparison,spawn:spawnChanged?{from:world(spawn.sourceCell,constants),to:world(spawn.cell,constants)}:null}};
}
function signature(files,name,mapName,maps){
  const file=files[name];if(!file)return null;const parsed=parseCsv(file.bytes);
  let rows;
  if(name==='DT_MonsterSpawn'||name==='DT_Portal')rows=parsed.rows.filter(r=>r.data[name==='DT_Portal'?'SrcMap':'MapName']===mapName).map(r=>r.data);
  else if(name==='DT_Bounds')rows=parsed.rows.filter(r=>maps.has(r.data.MapName)).map(r=>{const d={...r.data};if(d.MapName!==mapName){delete d.SpawnX;delete d.SpawnY;}return d;});
  else if(name==='DT_Walk')rows=parsed.rows.filter(r=>maps.has(r.data.MapName)).map(r=>r.data);
  else if(name==='DT_GameConfig')rows=parsed.rows.filter(r=>r.data.ConfigKey==='PortalSpriteRuid').map(r=>r.data);
  else return hash(file.bytes);
  return JSON.stringify(rows.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
function sourceDrift(profile,currentFiles,edit){
  const maps=new Set([profile.mapName,...profile.portals.filter(r=>r.map===profile.mapName).map(r=>r.values.destMap),...[...(edit?.portals?.records?.values()||[])].map(r=>r.values.destMap)]);
  const changes=[];for(const [name,file]of Object.entries(profile.files)){try{if(signature(profile.files,name,profile.mapName,maps)!==signature(currentFiles,name,profile.mapName,maps))changes.push(file.relative);}catch{changes.push(file.relative);}}return [...new Set(changes)];
}
const quote=s=>/[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
function patchTable(bytes,mapName,idColumn,mapColumn,changes,added,removed,render){const parsed=parseCsv(bytes,[idColumn,mapColumn]);identify(parsed,idColumn,mapColumn);const byId=new Map(parsed.rows.map(r=>[r.data[idColumn],r]));for(const r of added)if(byId.has(r.id))fail('RUNTIME_ID_COLLISION','새 런타임 행 ID가 최신 CSV에 이미 있습니다.');const changed=new Map(changes.map(r=>[r.id,r])),deleted=new Set(removed.map(r=>r.id)),rawRows=new Map(parsed.rows.map(r=>[r.raw,r]));const serialize=(r,original)=>parsed.header.map(h=>quote(String(render(r,original,parsed.header)[h]??''))).join(',');const incoming=added.map(r=>serialize(r,null)+parsed.newline).join('');let out='',inserted=false;const hasTarget=parsed.rows.some(r=>r.data[mapColumn]===mapName);
  for(let i=0;i<parsed.records.length;i++){const record=parsed.records[i],row=rawRows.get(record.raw);if(incoming&&!inserted&&((row?.data[mapColumn]===mapName)||(!hasTarget&&i===1))){out+=(out&&!/[\r\n]$/.test(out)?parsed.newline:'')+incoming;inserted=true;}if(row?.data[mapColumn]===mapName&&deleted.has(row.data[idColumn]))continue;const edit=row&&changed.get(row.data[idColumn]);out+=edit?serialize(edit,row.data)+(/\r\n$|\n$|\r$/.exec(record.raw)?.[0]||''):record.raw;}
  if(incoming&&!inserted)out+=(out&&!/[\r\n]$/.test(out)?parsed.newline:'')+incoming;const result=Buffer.from(out,'utf8'),after=parseCsv(result,parsed.header);const untouched=p=>p.rows.filter(r=>r.data[mapColumn]!==mapName||(!changed.has(r.data[idColumn])&&!deleted.has(r.data[idColumn])&&!added.some(a=>a.id===r.data[idColumn]))).map(r=>r.raw);if(!same(untouched(parsed),untouched(after)))fail('RUNTIME_PRESERVATION_FAILED','미수정 런타임 CSV 행이 변경되었습니다.');
  for(const r of [...changes,...added]){const original=byId.get(r.id)?.data||null,expected=render(r,original,parsed.header),matches=after.rows.filter(row=>row.data[idColumn]===r.id);if(matches.length!==1||!same(matches[0].data,expected))fail('RUNTIME_PRESERVATION_FAILED','수정한 런타임 CSV 행 검증에 실패했습니다.');}
  if(after.rows.some(r=>deleted.has(r.data[idColumn])))fail('RUNTIME_PRESERVATION_FAILED','삭제한 런타임 CSV 행이 남아 있습니다.');return result;
}
function buildCandidates(edit,currentFiles){const {profile}=edit;if(sourceDrift(profile,currentFiles,edit).length)fail('STALE_RUNTIME_SOURCE','몬스터·포탈·시작점 원본이 변경되었습니다. 최신 원본을 다시 가져오세요.');const result=[];
  const render=(kind)=>(r,original,header)=>{const v=r.values,data=original?{...original}:Object.fromEntries(header.map(h=>[h,''])),fields=kind==='monsters'?M_FIELDS:P_FIELDS,columns=kind==='monsters'?M_COLUMNS:P_COLUMNS;if(!original){data[kind==='monsters'?'MonsterSpawnID':'PortalID']=r.id;data[kind==='monsters'?'MapName':'SrcMap']=profile.mapName;}
    for(const k of fields){if(original&&same(v[k],r.source[k]))continue;if(k==='cell'){data[kind==='monsters'?'CellX':'SrcX']=String(v.cell[0]);data[kind==='monsters'?'CellY':'SrcY']=String(v.cell[1]);}else if(k==='destCell'){data.DestX=String(v.destCell[0]);data.DestY=String(v.destCell[1]);}else data[columns[k]]=typeof v[k]==='boolean'?(v[k]?'True':'False'):String(v[k]);}return data;};
  for(const [kind,name,idColumn,mapColumn]of [['monsters','DT_MonsterSpawn','MonsterSpawnID','MapName'],['portals','DT_Portal','PortalID','SrcMap']])if(edit[kind].edited){const file=currentFiles[name],e=edit[kind],bytes=patchTable(file.bytes,profile.mapName,idColumn,mapColumn,e.changed,e.added,e.removed,render(kind));result.push({name,relative:file.relative,sourceBytes:file.bytes,bytes,comparison:{sourceSha256:hash(file.bytes),candidateSha256:hash(bytes),unchangedRowsExact:true}});}
  if(edit.spawnChanged){const file=currentFiles.DT_Bounds,record={id:profile.mapName,cell:edit.spawn.cell};const bytes=patchTable(file.bytes,profile.mapName,'MapName','MapName',[record],[],[],(r,original)=>({...original,SpawnX:String(r.cell[0]),SpawnY:String(r.cell[1])}));result.push({name:'DT_Bounds',relative:file.relative,sourceBytes:file.bytes,bytes,comparison:{sourceSha256:hash(file.bytes),candidateSha256:hash(bytes),unchangedRowsExact:true}});}
  return result;
}
module.exports={FILES,analyzeRuntime,inspectRuntime,sourceDrift,buildCandidates,inBounds};
