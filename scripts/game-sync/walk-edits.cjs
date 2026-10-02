'use strict';
// Surgical CSV editing: preserve every unchanged source record, including quoting,
// BOM and line endings; only explicit cells in this map may change.
const crypto = require('node:crypto');
const key = (x, y) => x + ',' + y;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code, message) { const e = new Error(message); e.name = 'GameSyncError'; e.code = code; throw e; }
function blockedSet(project) {
  if (!Array.isArray(project.blocked)) fail('INVALID_BLOCKED', '이동불가 셀 배열이 필요합니다.');
  const out = new Set();
  for (const cell of project.blocked) {
    if (!Array.isArray(cell) || cell.length !== 2 || cell.some(n => !Number.isInteger(n))
      || cell[0] < 0 || cell[1] < 0 || cell[0] >= project.size[0] || cell[1] >= project.size[1]) fail('INVALID_BLOCKED', '이동불가 셀은 맵 안의 정수 [x,y]여야 합니다.');
    const k = key(...cell);
    if (out.has(k)) fail('INVALID_BLOCKED', '이동불가 셀이 중복되었습니다: ' + k);
    out.add(k);
  }
  return out;
}
function parseCsv(bytes) {
  const text = bytes.toString('utf8'), records = [];
  if (!Buffer.from(text, 'utf8').equals(bytes)) fail('UNSUPPORTED_WALK', 'DT_Walk는 UTF-8 CSV여야 합니다.');
  let start = 0, field = '', fields = [], quoted = false, fieldStart = true;
  // BOM belongs to the header raw bytes, not its first decoded field.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || fieldStart) quoted = !quoted;
      else fail('UNSUPPORTED_WALK', 'DT_Walk 따옴표 형식을 확인할 수 없습니다.');
      fieldStart = false;
    } else if (!quoted && c === ',') { fields.push(field); field = ''; fieldStart = true; }
    else if (!quoted && (c === '\r' || c === '\n')) {
      fields.push(field);
      if (c === '\r' && text[i + 1] === '\n') i++;
      records.push({ raw: text.slice(start, i + 1), fields });
      start = i + 1; fields = []; field = ''; fieldStart = true;
    } else { field += c; fieldStart = false; }
  }
  if (quoted) fail('UNSUPPORTED_WALK', 'DT_Walk 따옴표가 닫히지 않았습니다.');
  if (start < text.length) { fields.push(field); records.push({ raw: text.slice(start), fields }); }
  const header = records[0];
  if (!header || header.fields.length !== 3 || [...header.fields].sort().join(',') !== 'CellX,CellY,MapName') fail('UNSUPPORTED_WALK', 'DT_Walk 헤더는 MapName,CellX,CellY여야 합니다.');
  const columns = { map: header.fields.indexOf('MapName'), x: header.fields.indexOf('CellX'), y: header.fields.indexOf('CellY') };
  return { records, header, columns, newline: /\r\n|\n|\r/.exec(text)?.[0] || '\r\n' };
}
function mapRows(parsed, mapName) {
  const rows = [], seen = new Set(), { map, x, y } = parsed.columns;
  for (const r of parsed.records.slice(1)) {
    if (r.fields[map] !== mapName) continue;
    if (r.fields.length !== 3 || !/^-?\d+$/.test(r.fields[x]) || !/^-?\d+$/.test(r.fields[y])) fail('UNSUPPORTED_WALK', '현재 맵의 DT_Walk 좌표를 확인할 수 없습니다.');
    const k = key(Number(r.fields[x]), Number(r.fields[y]));
    if (seen.has(k)) fail('UNSUPPORTED_WALK', '현재 맵의 DT_Walk에 중복 셀이 있습니다: ' + k);
    seen.add(k); rows.push({ ...r, key: k });
  }
  return { rows, keys: seen };
}
const sorted = cells => [...cells].sort((a, b) => { const aa = a.split(',').map(Number), bb = b.split(',').map(Number); return aa[1] - bb[1] || aa[0] - bb[0]; });
function sameKeys(a, b) { return a.size === b.size && [...a].every(k => b.has(k)); }
function analyzeWalk(bytes, relative, baseline, mapName) {
  const before = blockedSet(baseline);
  const result = { relative, before, supported: false, reasons: [] };
  if (!bytes) { result.reasons.push('DT_Walk 원본이 없어 이동불가 영역 편집을 지원하지 않습니다.'); return result; }
  try {
    const parsed = parseCsv(bytes), target = mapRows(parsed, mapName);
    if (!sameKeys(before, target.keys)) result.reasons.push('게임 DT_Walk와 기준 이동불가 셀이 달라 영역 편집을 보호합니다.');
    else Object.assign(result, { supported: true, sourceSha256: hash(bytes),
      targetRaw: target.rows.map(r => r.raw), headerRaw: parsed.header.raw });
  } catch (e) {
    if (e.name !== 'GameSyncError') throw e;
    result.reasons.push(e.message);
  }
  return result;
}
function inspectBlocked(project, profile) {
  const after = blockedSet(project);
  const changed = [...profile.before].filter(k => !after.has(k)).length + [...after].filter(k => !profile.before.has(k)).length;
  if (changed && !profile.supported) fail('UNSUPPORTED_WALK', profile.reasons.join(' '));
  return { ...profile, after, changed };
}
function buildWalkCandidate(bytes, edit, mapName) {
  const parsed = parseCsv(bytes), current = mapRows(parsed, mapName);
  if (parsed.header.raw !== edit.headerRaw || JSON.stringify(current.rows.map(r => r.raw)) !== JSON.stringify(edit.targetRaw)) fail('STALE_WALK_ROWS', '현재 맵의 DT_Walk 원본이 기준 이후 변경되었습니다. 게임 원본을 다시 가져오세요.');
  const additions = sorted(new Set([...edit.after].filter(k => !current.keys.has(k))));
  const rowFor = k => { const [x, y] = k.split(','); const row = ['', '', '']; row[parsed.columns.map] = mapName; row[parsed.columns.x] = x; row[parsed.columns.y] = y; return row.join(',') + parsed.newline; };
  const incoming = additions.map(rowFor).join('');
  let inserted = false, output = '', keptTargetRows = 0;
  const existing = new Map(current.rows.map(r => [r.raw, r.key]));
  for (let i = 0; i < parsed.records.length; i++) {
    const record = parsed.records[i];
    if (i === 1 && !current.rows.length) { output += incoming; inserted = true; }
    if (i && record.fields[parsed.columns.map] === mapName) {
      if (!inserted) { output += incoming; inserted = true; }
      if (edit.after.has(existing.get(record.raw))) { output += record.raw; keptTargetRows++; }
    } else output += record.raw;
  }
  if (!inserted && incoming) output += (output && !/[\r\n]$/.test(output) ? parsed.newline : '') + incoming;
  const result = Buffer.from(output, 'utf8'), check = parseCsv(result), checked = mapRows(check, mapName);
  if (!sameKeys(checked.keys, edit.after)) fail('WALK_PRESERVATION_FAILED', '후보 DT_Walk의 이동불가 영역이 일치하지 않습니다.');
  const otherRows = p => p.records.slice(1).filter(r => r.fields[p.columns.map] !== mapName).map(r => r.raw);
  if (JSON.stringify(otherRows(parsed)) !== JSON.stringify(otherRows(check))) fail('WALK_PRESERVATION_FAILED', '다른 맵의 DT_Walk 행이 변경되었습니다.');
  return { bytes: result, comparison: { currentMapCellsExact: true, unchangedOtherRowsExact: true,
    retainedCurrentMapRows: keptTargetRows, addedRows: additions.length,
    removedRows: current.rows.length - keptTargetRows, sourceSha256: hash(bytes), candidateSha256: hash(result) } };
}
module.exports = { analyzeWalk, inspectBlocked, buildWalkCandidate, blockedSet };
