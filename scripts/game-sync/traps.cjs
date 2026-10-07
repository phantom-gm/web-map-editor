'use strict';
const {parseCsv,world}=require('./npcs.cjs');
const hash=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
const ID=/^[A-Za-z0-9_-]{1,128}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fields=['cell','maxCell','abnormalityId'];
const fail=(code,message)=>{const e=new Error(message);e.name='GameSyncError';e.code=code;throw e;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const integer=v=>{const n=Number(v);if(v===''||!Number.isSafeInteger(n))fail('UNSUPPORTED_TRAPS','함정 좌표·효과 번호는 정수여야 합니다.');return n;};
const covers=(v,c)=>c[0]>=v.cell[0]&&c[0]<=v.maxCell[0]&&c[1]>=v.cell[1]&&c[1]<=v.maxCell[1];
function analyze(files,mapName){
 const result={mapName,files,rows:[],catalog:[],supported:false,reasons:[]};
 try{
  if(!files.DT_MapTrap||!files.DT_Abnormality)fail('UNSUPPORTED_TRAPS','함정·상태이상 CSV가 없습니다. 배치 원본을 다시 읽어 주세요.');
  const names=new Map(files.ST_ABNName?parseCsv(files.ST_ABNName.bytes,['Key']).rows.map(r=>[r.data.Key,r.data.ko||r.data.Source]):[]);
  const abn=parseCsv(files.DT_Abnormality.bytes,['AbnormalityID','AbnormalityName','Duration','ApplyTarget']).rows,seenAbn=new Set();
  result.catalog=abn.map(r=>{const id=integer(r.data.AbnormalityID);if(seenAbn.has(id))fail('UNSUPPORTED_TRAPS','상태이상 번호가 중복되었습니다.');seenAbn.add(id);return{abnormalityId:id,name:names.get(r.data.AbnormalityName)||r.data['#Desc']||r.data.AbnormalityName,durationMs:integer(r.data.Duration),canAdd:(r.data.ApplyTarget||'').split(',').map(s=>s.trim()).includes('Pc'),isComa:r.data.ValueTarget==='COMA'};});
  const parsed=parseCsv(files.DT_MapTrap.bytes,['TrapID','MapName','MinX','MinY','MaxX','MaxY','AbnormalityID']),seen=new Set();
  result.rows=parsed.rows.map(r=>{const id=r.data.TrapID,map=r.data.MapName;if(!ID.test(id||'')||!ID.test(map||'')||seen.has(id))fail('UNSUPPORTED_TRAPS','함정 ID가 잘못됐거나 중복되었습니다.');seen.add(id);const values={cell:[integer(r.data.MinX),integer(r.data.MinY)],maxCell:[integer(r.data.MaxX),integer(r.data.MaxY)],abnormalityId:integer(r.data.AbnormalityID)};if(values.cell.some(n=>n<0)||values.maxCell.some((n,i)=>n<values.cell[i])||!seenAbn.has(values.abnormalityId))fail('UNSUPPORTED_TRAPS','함정 범위 또는 상태이상 참조를 확인하세요.');return{...r,id,map,values};});
  result.supported=true;
 }catch(e){if(e.name!=='GameSyncError')throw e;result.reasons.push(e.message);}
 return result;
}
function inspect(raw,profile,constants,size,portals=[],incoming=[]){
 const patch=raw??{version:1,updated:[],removed:[],added:[]};
 if(!patch||patch.version!==1||Object.keys(patch).some(k=>!['version','updated','removed','added'].includes(k))||!['updated','removed','added'].every(k=>Array.isArray(patch[k])))fail('INVALID_TRAP_EDIT','함정 편집 형식을 확인하세요.');
 const seen=new Set(),take=id=>{if(!ID.test(id||'')||seen.has(id))fail('INVALID_TRAP_EDIT','함정 편집 ID가 중복되었거나 잘못됐습니다.');seen.add(id);};
 const records=new Map(profile.rows.filter(r=>r.map===profile.mapName).map(r=>[r.id,{entityId:r.id,id:r.id,source:r.values,values:{...r.values},row:r}])),changed=[],added=[],removed=[],moved=[],updated=[];
 const validate=v=>{if(!Array.isArray(v.cell)||!Array.isArray(v.maxCell)||v.cell.length!==2||v.maxCell.length!==2||[...v.cell,...v.maxCell].some(n=>!Number.isSafeInteger(n)||n<0)||v.maxCell.some((n,i)=>n<v.cell[i]||n>=size[i])||!profile.catalog.some(a=>a.abnormalityId===v.abnormalityId&&a.canAdd))fail('INVALID_TRAP_EDIT','함정은 맵 안의 닫힌 사각형과 플레이어용 상태이상이어야 합니다.');};
 if(!profile.supported&&(patch.updated.length||patch.added.length||patch.removed.length))fail('UNSUPPORTED_TRAPS',profile.reasons.join(' '));
 const readPatch=r=>{if(!r||Object.keys(r).some(k=>!['entityId',...fields].includes(k)))fail('INVALID_TRAP_EDIT','지원하지 않는 함정 편집 항목입니다.');take(r.entityId);return Object.fromEntries(fields.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));};
 for(const r of patch.updated){const values=readPatch(r),old=records.get(r.entityId);if(!old||!Object.keys(values).length)fail('INVALID_TRAP_EDIT','수정할 함정이 없습니다.');const next={...old.values,...values};validate(next);if(same(next,old.values))continue;const record={...old,values:next};records.set(r.entityId,record);changed.push(record);if(!same(next.cell,old.values.cell))moved.push(record);if(!same(next.maxCell,old.values.maxCell)||next.abnormalityId!==old.values.abnormalityId)updated.push(record);}
 for(const id of patch.removed){take(id);const old=records.get(id);if(!old)fail('INVALID_TRAP_EDIT','삭제할 함정이 없습니다.');removed.push(old);records.delete(id);}
 for(const r of patch.added){const values=readPatch(r);if(!UUID.test(r.entityId)||fields.some(k=>values[k]===undefined))fail('INVALID_TRAP_EDIT','새 함정의 필수 항목을 입력하세요.');validate(values);const id=profile.mapName+'_Editor_'+r.entityId;if(profile.rows.some(s=>s.id===id))fail('TRAP_ID_COLLISION','새 함정 ID가 이미 있습니다.');const record={entityId:r.entityId,id,source:null,values};added.push(record);records.set(r.entityId,record);}
 const descriptors=[...records.values()].map(r=>({...r.values,entityId:r.entityId,trapId:r.id,source:r.source,sourceCell:r.source?.cell||null,position:world(r.values.cell,constants),name:profile.catalog.find(a=>a.abnormalityId===r.values.abnormalityId)?.name||String(r.values.abnormalityId),canEdit:profile.supported}));
 const warnings=[];
 for(let i=0;i<descriptors.length;i++)for(let j=i+1;j<descriptors.length;j++){const a=descriptors[i],b=descriptors[j];if(a.cell[0]<=b.maxCell[0]&&a.maxCell[0]>=b.cell[0]&&a.cell[1]<=b.maxCell[1]&&a.maxCell[1]>=b.cell[1])warnings.push('함정 '+a.trapId+'와 '+b.trapId+'가 겹칩니다. CSV에서 먼저 적힌 함정이 적용됩니다.');}
 for(const p of portals)if(p.enabled&&descriptors.some(t=>covers(t,p.cell)))warnings.push('포탈 '+p.portalId+' 출발 칸이 함정 안입니다.');
 for(const r of incoming)if(r.values.enabled&&r.values.destMap===profile.mapName&&descriptors.some(t=>covers(t,r.values.destCell)))warnings.push('포탈 '+r.id+' 도착 칸 '+r.values.destCell.join(',')+'이 함정 안입니다. 도착 즉시 상태이상이 걸릴 수 있습니다.');
 if(descriptors.length)warnings.push('함정 표시는 편집용입니다. 게임에서는 플레이어가 새 칸에 들어설 때 발동하며, 코마 해제 후 같은 칸에 서 있으면 다시 발동하지 않습니다.');
 return{profile,records,changed,added,removed,moved,updated,descriptors,warnings,edited:changed.length+added.length+removed.length,echo:patch.updated.length||patch.removed.length||patch.added.length?patch:null};
}
function signature(files,map){const f=files.DT_MapTrap;if(!f)return null;const p=parseCsv(f.bytes,['TrapID','MapName']);return JSON.stringify({header:p.header,rows:p.rows.filter(r=>r.data.MapName===map).map(r=>r.data)});}
function drift(profile,current){const out=[];if(signature(profile.files,profile.mapName)!==signature(current,profile.mapName))out.push(profile.files.DT_MapTrap?.relative||current.DT_MapTrap?.relative||'DT_MapTrap.csv');for(const n of ['DT_Abnormality','ST_ABNName'])if(!same(profile.files[n]?.bytes?.toString('base64'),current[n]?.bytes?.toString('base64')))out.push(profile.files[n]?.relative||current[n]?.relative||n+'.csv');return out;}
const quote=s=>/[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
function build(edit,current){
 if(!edit.edited)return[];if(drift(edit.profile,current).length)fail('STALE_TRAP_SOURCE','함정 원본이나 상태이상 정의가 바뀌었습니다. 원본을 다시 읽어 주세요.');
 const latest=analyze(current,edit.profile.mapName);if(!latest.supported)fail('UNSUPPORTED_TRAPS',latest.reasons.join(' '));
 const file=current.DT_MapTrap,p=parseCsv(file.bytes,['TrapID','MapName']),byId=new Map(p.rows.map(r=>[r.data.TrapID,r]));for(const r of edit.added)if(byId.has(r.id))fail('TRAP_ID_COLLISION','새 함정 ID가 최신 CSV에 이미 있습니다.');
 const changed=new Map(edit.changed.map(r=>[r.id,r])),deleted=new Set(edit.removed.map(r=>r.id)),raw=new Map(p.rows.map(r=>[r.raw,r]));
 const render=(r,old)=>{const v=r.values,d=old?{...old}:Object.fromEntries(p.header.map(k=>[k,'']));Object.assign(d,{TrapID:r.id,MapName:edit.profile.mapName,MinX:String(v.cell[0]),MinY:String(v.cell[1]),MaxX:String(v.maxCell[0]),MaxY:String(v.maxCell[1]),AbnormalityID:String(v.abnormalityId)});return p.header.map(k=>quote(String(d[k]??''))).join(',');};
 const incoming=edit.added.map(r=>render(r,null)+p.newline).join('');
 let lastTarget=0;for(let i=1;i<p.records.length;i++)if(raw.get(p.records[i].raw)?.data.MapName===edit.profile.mapName)lastTarget=i;
 let out='';for(let i=0;i<p.records.length;i++){const r=p.records[i],row=raw.get(r.raw);if(!row||!deleted.has(row.data.TrapID))out+=row&&changed.has(row.data.TrapID)?render(changed.get(row.data.TrapID),row.data)+(/\r\n$|\n$|\r$/.exec(r.raw)?.[0]||''):r.raw;
  if(incoming&&i===lastTarget){if(out&&!/[\r\n]$/.test(out))out+=p.newline;out+=incoming;}
 }
 const bytes=Buffer.from(out),after=parseCsv(bytes,p.header),touched=new Set([...changed.keys(),...deleted,...edit.added.map(r=>r.id)]);
 assertUntouched(p,after,touched);for(const r of [...edit.changed,...edit.added]){const actual=after.rows.find(s=>s.data.TrapID===r.id);if(!actual||actual.raw.replace(/\r?\n$/,'')!==render(r,byId.get(r.id)?.data))fail('TRAP_PRESERVATION_FAILED','수정한 함정 CSV 행이 일치하지 않습니다.');}
 return[{name:'DT_MapTrap',relative:file.relative,sourceBytes:file.bytes,bytes,comparison:{unchangedRowsExact:true,sourceSha256:hash(file.bytes),candidateSha256:hash(bytes)}}];
}
function assertUntouched(a,b,ids){
 const original=a.rows.filter(r=>!ids.has(r.data.TrapID)),next=b.rows.filter(r=>!ids.has(r.data.TrapID));
 if(original.length!==next.length||original.some((r,i)=>r.raw!==next[i].raw&&!(r===a.rows.at(-1)&&!/[\r\n]$/.test(r.raw)&&next[i].raw===r.raw+a.newline)))fail('TRAP_PRESERVATION_FAILED','미수정 함정 행이 변경되었습니다.');
}
module.exports={analyze,inspect,drift,build,covers};
