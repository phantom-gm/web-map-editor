'use strict';
// NPCs are runtime CSV spawns. This module never creates native .map entities.
const crypto = require('node:crypto');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const key = c => c.join(',');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FILES = ['DT_NpcSpawn.csv', 'DT_NpcClass.csv', 'DT_NpcAppearance.csv', 'ST_NpcName.csv'];
function fail(code, message) { const e = new Error(message); e.name = 'GameSyncError'; e.code = code; throw e; }
function parseCsv(bytes, required = []) {
  const text = bytes.toString('utf8'), records = [];
  if (!Buffer.from(text, 'utf8').equals(bytes)) fail('UNSUPPORTED_NPC', 'NPC CSV는 UTF-8이어야 합니다.');
  let start = 0, field = '', fields = [], quoted = false, fieldStart = true;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || fieldStart) quoted = !quoted;
      else fail('UNSUPPORTED_NPC', 'NPC CSV 따옴표 형식이 올바르지 않습니다.');
      fieldStart = false;
    } else if (!quoted && c === ',') { fields.push(field); field = ''; fieldStart = true; }
    else if (!quoted && (c === '\r' || c === '\n')) {
      fields.push(field); if (c === '\r' && text[i + 1] === '\n') i++;
      records.push({ raw: text.slice(start, i + 1), fields }); start = i + 1; fields = []; field = ''; fieldStart = true;
    } else { field += c; fieldStart = false; }
  }
  if (quoted) fail('UNSUPPORTED_NPC', 'NPC CSV 따옴표가 닫히지 않았습니다.');
  if (start < text.length) { fields.push(field); records.push({ raw: text.slice(start), fields }); }
  const header = records[0]?.fields;
  if (!header || new Set(header).size !== header.length || required.some(name => !header.includes(name))) fail('UNSUPPORTED_NPC', 'NPC CSV 필수 열이 없거나 중복되었습니다: ' + required.join(', '));
  const rows = records.slice(1).filter(r => r.fields.some(v => v !== '')).map(record => {
    if (record.fields.length !== header.length) fail('UNSUPPORTED_NPC', 'NPC CSV 행의 열 수가 헤더와 다릅니다.');
    return { ...record, data: Object.fromEntries(header.map((name, i) => [name, record.fields[i]])) };
  });
  return { header, records, rows, newline: /\r\n|\n|\r/.exec(text)?.[0] || '\r\n' };
}
const truth = value => /^(true|1)$/i.test(value);
const integer = (value, label) => { if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail('UNSUPPORTED_NPC', label + ' 값이 정수가 아닙니다.'); return Number(value); };
function spawnRows(bytes) {
  const parsed = parseCsv(bytes, ['NpcSpawnID', 'MapName', 'NpcClassID', 'CellX', 'CellY', 'Enabled', 'Scale', 'FlipX', 'DialogID']);
  const seen = new Set();
  for (const row of parsed.rows) {
    const d = row.data;
    if (!ID.test(d.NpcSpawnID) || !ID.test(d.MapName) || seen.has(d.NpcSpawnID)) fail('UNSUPPORTED_NPC', 'NPC 스폰 ID가 중복되었거나 올바르지 않습니다: ' + d.NpcSpawnID);
    seen.add(d.NpcSpawnID);
    row.spawnId = d.NpcSpawnID; row.mapName = d.MapName; row.npcClassId = integer(d.NpcClassID, 'NpcClassID');
    row.cell = [integer(d.CellX, 'CellX'), integer(d.CellY, 'CellY')]; row.enabled = truth(d.Enabled); row.flipX = truth(d.FlipX); row.dialogId = d.DialogID;
  }
  return parsed;
}
function targetSignature(parsed, mapName) {
  return JSON.stringify(parsed.rows.filter(r => r.mapName === mapName).map(r => r.data).sort((a, b) => a.NpcSpawnID.localeCompare(b.NpcSpawnID)));
}
function world(cell, constants) {
  const x = ((cell[0] - constants.ORIGIN_X) - (cell[1] - constants.ORIGIN_Y)) * constants.TILE_W * 0.5;
  const y = -((cell[0] - constants.ORIGIN_X) + (cell[1] - constants.ORIGIN_Y)) * constants.TILE_H * 0.5;
  return [x, y, y * constants.DEPTH_SCALE];
}
function analyzeNpcs(files, mapName, sourceId = null) {
  const out = { supported: false, files, mapName, sourceId, reasons: [], catalog: [], rows: [], allIds: new Set(), targetSignature: '', spawnRelative: files.DT_NpcSpawn?.relative || null };
  const get = name => files[name.slice(0, -4)]?.bytes;
  if (FILES.slice(0, 3).some(name => !get(name))) { out.reasons.push('NPC 배치·종류·외형 CSV가 없어 NPC 편집을 지원하지 않습니다.'); return out; }
  try {
    const names = new Map();
    if (get('ST_NpcName.csv')) for (const row of parseCsv(get('ST_NpcName.csv'), ['Key']).rows) names.set(row.data.Key, row.data.ko || row.data.Source || row.data.Value || row.data.Key);
    const appearances = parseCsv(get('DT_NpcAppearance.csv'), ['NpcAppearanceID', 'Action', 'BaseDir', 'Ruid']).rows;
    const classRows = parseCsv(get('DT_NpcClass.csv'), ['NpcClassID', 'NpcName', 'NpcAppearanceID', 'BodyScale']).rows;
    const seenClasses = new Set();
    out.catalog = classRows.map(row => {
      const d = row.data, npcClassId = integer(d.NpcClassID, 'NpcClassID');
      if (seenClasses.has(npcClassId)) fail('UNSUPPORTED_NPC', 'NPC 종류 ID가 중복되었습니다.'); seenClasses.add(npcClassId);
      const matches = appearances.filter(a => a.data.NpcAppearanceID === d.NpcAppearanceID && a.data.Action === 'Idle' && a.data.Ruid);
      const art = matches.find(a => a.data.BaseDir === 'SE');
      const bodyScale = Number(d.BodyScale || 1), ruid = art?.data.Ruid || '';
      const canAdd = (!d.ModelID || d.ModelID === 'npc') && /^[a-f0-9]{32}$/i.test(ruid) && Number.isFinite(bodyScale) && bodyScale > 0 && bodyScale <= 20;
      return { npcClassId, name: names.get(d.NpcName) || d['#DevName'] || d.NpcName || String(npcClassId), ruid,
        bodyScale: canAdd ? bodyScale : 1, canAdd, ...(canAdd ? {} : { reason: '기본 npc 모델·Idle SE 외형 또는 몸통 배율을 확인할 수 없습니다.' }),
        footPx: art?.data.FootPx === '' || art?.data.FootPx == null ? null : Number(art.data.FootPx) };
    });
    const parsed = spawnRows(get('DT_NpcSpawn.csv'));
    out.rows = parsed.rows.filter(row => row.mapName === mapName); out.allIds = new Set(parsed.rows.map(r => r.spawnId));
    out.targetSignature = targetSignature(parsed, mapName); out.header = parsed.header; out.supported = true;
  } catch (error) { if (error.name !== 'GameSyncError') throw error; out.reasons.push(error.message); }
  return out;
}
function inspectNpcs(project, profile, constants) {
  const raw = project.gameNpcEdits;
  const warnings = [], changed = [], added = [], removed = [], moves = [], updates = [], classes = new Map(profile.catalog.map(c => [c.npcClassId, c]));
  const records = new Map(profile.rows.map(row => [row.spawnId, { ...row, entityId: row.spawnId, sourceCell: [...row.cell], sourceFlipX: row.flipX, sourceDialogId: row.dialogId }]));
  const exactKeys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k));
  if (raw != null) {
    if (!exactKeys(raw, ['version', 'updated', 'removed', 'added']) || raw.version !== 1 || !['updated', 'removed', 'added'].every(k => Array.isArray(raw[k]))) fail('INVALID_NPC_EDIT', 'NPC 편집 형식이 올바르지 않습니다.');
    if (!profile.supported && (raw.updated.length || raw.removed.length || raw.added.length)) fail('UNSUPPORTED_NPC', profile.reasons.join(' '));
    const ids = new Set();
    const target = id => { if (typeof id !== 'string' || !ID.test(id) || ids.has(id)) fail('INVALID_NPC_EDIT', 'NPC 편집 ID가 잘못되었거나 중복되었습니다.'); ids.add(id); };
    const validCell = c => Array.isArray(c) && c.length === 2 && c.every(Number.isSafeInteger) && c[0] >= 0 && c[1] >= 0 && c[0] < project.size[0] && c[1] < project.size[1];
    const validDialog = d => typeof d === 'string' && (d === '' || ID.test(d));
    for (const edit of raw.updated) {
      if (!exactKeys(edit, ['entityId', 'cell', 'flipX', 'dialogId'])) fail('INVALID_NPC_EDIT', '지원하지 않는 NPC 수정 필드입니다.'); target(edit.entityId);
      const record = records.get(edit.entityId);
      if (!record || !classes.get(record.npcClassId)?.canAdd) fail('INVALID_NPC_EDIT', '수정할 수 없는 NPC입니다.');
      if (edit.cell !== undefined && !validCell(edit.cell) || edit.flipX !== undefined && typeof edit.flipX !== 'boolean' || edit.dialogId !== undefined && !validDialog(edit.dialogId)) fail('INVALID_NPC_EDIT', 'NPC 좌표·반전·대사 ID를 확인하세요.');
      const next = { ...record, cell: edit.cell || record.cell, flipX: edit.flipX ?? record.flipX, dialogId: edit.dialogId ?? record.dialogId };
      if (!equal(next.cell, record.cell) || next.flipX !== record.flipX || next.dialogId !== record.dialogId) {
        records.set(edit.entityId, next); changed.push(next);
        if (!equal(next.cell, record.cell)) moves.push(next);
        if (next.flipX !== record.flipX || next.dialogId !== record.dialogId) updates.push(next);
      }
    }
    for (const id of raw.removed) { target(id); const record = records.get(id); if (!record) fail('INVALID_NPC_EDIT', '삭제할 NPC가 없습니다.'); removed.push(record); records.delete(id); }
    for (const edit of raw.added) {
      if (!exactKeys(edit, ['entityId', 'npcClassId', 'cell', 'flipX', 'dialogId'])) fail('INVALID_NPC_EDIT', '지원하지 않는 NPC 추가 필드입니다.'); target(edit.entityId);
      const spawnId = profile.mapName + '_Editor_' + edit.entityId;
      if (!UUID.test(edit.entityId) || records.has(edit.entityId) || profile.allIds.has(edit.entityId) || !Number.isSafeInteger(edit.npcClassId) || edit.npcClassId <= 0 || !classes.get(edit.npcClassId)?.canAdd || !validCell(edit.cell) || typeof edit.flipX !== 'boolean' || !validDialog(edit.dialogId) || profile.allIds.has(spawnId)) fail('INVALID_NPC_EDIT', '새 NPC의 종류·ID·좌표·반전·대사 ID를 확인하세요.');
      const record = { ...edit, spawnId, mapName: profile.mapName, enabled: true, sourceCell: null, sourceFlipX: null, sourceDialogId: null };
      added.push(record); records.set(edit.entityId, record);
    }
  }
  const blocked = new Set(project.blocked.map(key)), ground = new Set(project.ground.map(c => key(c.slice(0, 2))));
  const touched = new Set([...moves, ...added].map(r => r.entityId));
  const occupancy = new Map();
  for (const row of records.values()) if (row.enabled) {
    const k = key(row.cell), other = occupancy.get(k);
    if (other && (touched.has(row.entityId) || touched.has(other.entityId))) fail('NPC_OCCUPIED', '다른 NPC가 이미 있는 셀입니다: ' + k);
    occupancy.set(k, row);
    if (touched.has(row.entityId) && (blocked.has(k) || (ground.size && !ground.has(k)))) warnings.push('NPC ' + row.spawnId + '의 셀 ' + k + '은 이동불가이거나 일반 바닥이 없습니다. 게임은 지정 셀에 그대로 배치합니다.');
  }
  const normalized = { version: 1,
    updated: changed.map(r => ({ entityId: r.entityId, ...(!equal(r.cell, r.sourceCell) ? { cell: [...r.cell] } : {}), ...(r.flipX !== r.sourceFlipX ? { flipX: r.flipX } : {}), ...(r.dialogId !== r.sourceDialogId ? { dialogId: r.dialogId } : {}) })),
    removed: removed.map(r => r.entityId), added: added.map(r => ({ entityId: r.entityId, npcClassId: r.npcClassId, cell: [...r.cell], flipX: r.flipX, dialogId: r.dialogId })) };
  const descriptor = row => {
    const art = classes.get(row.npcClassId);
    return { entityId: row.entityId, spawnId: row.spawnId, npcClassId: row.npcClassId, name: art?.name || String(row.npcClassId), cell: [...row.cell],
      sourceCell: row.sourceCell, sourceFlipX: row.sourceFlipX, sourceDialogId: row.sourceDialogId, position: world(row.cell, constants),
      ruid: art?.ruid || '', bodyScale: art?.bodyScale || 1, flipX: row.flipX, dialogId: row.dialogId, enabled: row.enabled,
      canEdit: !!art?.canAdd, ...(art?.canAdd ? {} : { reason: art?.reason || 'NPC 종류를 찾을 수 없습니다.' }) };
  };
  return { profile, records, changed, added, removed, moves, updates, warnings, edited: changed.length + added.length + removed.length,
    normalized: changed.length || added.length || removed.length ? normalized : null,
    requested: raw && (raw.updated.length || raw.removed.length || raw.added.length) ? { version: 1,
      updated: raw.updated.map(r => ({ entityId: r.entityId, ...(r.cell !== undefined ? { cell: r.cell } : {}), ...(r.flipX !== undefined ? { flipX: r.flipX } : {}), ...(r.dialogId !== undefined ? { dialogId: r.dialogId } : {}) })),
      removed: [...raw.removed], added: raw.added.map(r => ({ entityId: r.entityId, npcClassId: r.npcClassId, cell: r.cell, flipX: r.flipX, dialogId: r.dialogId })) } : null,
    descriptors: [...records.values()].map(descriptor), catalog: profile.catalog.map(entry => { const result = { ...entry }; delete result.footPx; return result; }),
    comparison: { moved: moves.map(r => ({ entityId: r.entityId, from: world(r.sourceCell, constants), to: world(r.cell, constants) })),
      added: added.map(r => ({ entityId: r.entityId, position: world(r.cell, constants) })), removed: removed.map(r => ({ entityId: r.entityId, position: world(r.cell, constants) })),
      updated: updates.map(r => ({ entityId: r.entityId, position: world(r.cell, constants) })) } };
}
function sourceDrift(profile, currentFiles) {
  const changes = [];
  for (const [name, file] of Object.entries(profile.files)) {
    const current = currentFiles[name];
    if (!current?.bytes) { changes.push(file.relative); continue; }
    if (name === 'DT_NpcSpawn') {
      try { if (targetSignature(spawnRows(current.bytes), profile.mapName) !== profile.targetSignature) changes.push(file.relative); }
      catch { changes.push(file.relative); }
    } else if (sha(current.bytes) !== sha(file.bytes)) changes.push(file.relative);
  }
  return [...new Set(changes)];
}
const csvField = value => /[,"\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
function buildNpcCandidate(bytes, edit) {
  const { profile } = edit, parsed = spawnRows(bytes);
  if (targetSignature(parsed, profile.mapName) !== profile.targetSignature) fail('STALE_NPC_SOURCE', '현재 맵의 NPC 배치 원본이 변경되었습니다. NPC 원본을 새로 가져오세요.');
  for (const row of edit.added) if (parsed.rows.some(r => r.spawnId === row.spawnId)) fail('NPC_ID_COLLISION', '다른 맵을 포함해 새 NPC 스폰 ID가 이미 있습니다.');
  const removals = new Set(edit.removed.map(r => r.spawnId)), changes = new Map(edit.changed.map(r => [r.spawnId, r]));
  const render = (row, original) => {
    const data = original ? { ...original } : Object.fromEntries(parsed.header.map(k => [k, '']));
    if (!original) Object.assign(data, { NpcSpawnID: row.spawnId, MapName: profile.mapName, NpcClassID: String(row.npcClassId), Enabled: 'True', Scale: '1' });
    if (!original || !equal(row.cell, row.sourceCell)) { data.CellX = String(row.cell[0]); data.CellY = String(row.cell[1]); }
    if (!original || row.flipX !== row.sourceFlipX) data.FlipX = row.flipX ? 'True' : 'False';
    if (!original || row.dialogId !== row.sourceDialogId) data.DialogID = row.dialogId;
    return parsed.header.map(k => csvField(data[k])).join(',');
  };
  const byRaw = new Map(parsed.rows.map(row => [row.raw, row])); let output = '';
  const incoming = edit.added.map(row => render(row) + parsed.newline).join('');
  let inserted = false;
  const targetExists = parsed.rows.some(row => row.mapName === profile.mapName);
  for (let i = 0; i < parsed.records.length; i++) {
    const record = parsed.records[i];
    const row = byRaw.get(record.raw);
    if (!inserted && incoming && ((row && row.mapName === profile.mapName) || (!targetExists && i === 1))) {
      output += (output && !/[\r\n]$/.test(output) ? parsed.newline : '') + incoming; inserted = true;
    }
    if (row && row.mapName === profile.mapName && removals.has(row.spawnId)) continue;
    const change = row && changes.get(row.spawnId);
    output += change ? render(change, row.data) + (/\r\n$|\n$|\r$/.exec(record.raw)?.[0] || '') : record.raw;
  }
  if (incoming && !inserted) output += (output && !/[\r\n]$/.test(output) ? parsed.newline : '') + incoming;
  const result = Buffer.from(output, 'utf8'), check = spawnRows(result);
  const other = p => p.rows.filter(r => r.mapName !== profile.mapName).map(r => r.raw);
  if (!equal(other(parsed), other(check))) fail('NPC_PRESERVATION_FAILED', '다른 맵 NPC 행이 변경되었습니다.');
  const actual = check.rows.filter(r => r.mapName === profile.mapName).map(r => [r.spawnId, r.npcClassId, r.cell, r.flipX, r.dialogId, r.enabled]).sort((a,b) => a[0].localeCompare(b[0]));
  const expected = [...edit.records.values()].map(r => [r.spawnId, r.npcClassId, r.cell, r.flipX, r.dialogId, r.enabled]).sort((a,b) => a[0].localeCompare(b[0]));
  if (!equal(actual, expected)) fail('NPC_PRESERVATION_FAILED', '후보 NPC 배치가 편집 상태와 일치하지 않습니다.');
  return { bytes: result, comparison: { currentMapRowsExact: true, unchangedOtherRowsExact: true,
    movedRows: edit.moves.length, updatedRows: edit.updates.length, addedRows: edit.added.length, removedRows: edit.removed.length,
    sourceSha256: sha(bytes), candidateSha256: sha(result) } };
}
module.exports = { FILES, analyzeNpcs, inspectNpcs, sourceDrift, buildNpcCandidate, parseCsv, spawnRows, world };
