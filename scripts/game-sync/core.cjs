'use strict';
// Candidate compiler for explicit floor, native object and blocked-cell edits. The game checkout is always an input, never a destination.
// No game CLI is executed: current MapBuilder + coordinate constants are read-only dependencies.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const objectEdits = require('./object-edits.cjs');
const walkEdits = require('./walk-edits.cjs');

const VERSION = 1;
const TILE_NAME = /^Tile_(\d+)_(\d+)$/;
const FAMILY_NAME = /^(페른델)_(1|2|4)x\2_(.+)_(\d+)$/;
const CONSTANT_KEYS = ['TILE_W', 'TILE_H', 'ORIGIN_X', 'ORIGIN_Y', 'DEPTH_SCALE', 'GROUND_ORDER'];
const COMPONENT = { transform: 'MOD.Core.TransformComponent', sprite: 'MOD.Core.SpriteRendererComponent' };
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const key = (x, y) => x + ',' + y;
const coord = k => k.split(',').map(Number);
const sortedKeys = cells => [...cells.keys()].sort((a, b) => { const aa = coord(a), bb = coord(b); return aa[1] - bb[1] || aa[0] - bb[0]; });
const stable = value => JSON.stringify(canonical(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  return value;
}
function fail(code, message) { const e = new Error(message); e.name = 'GameSyncError'; e.code = code; throw e; }
function validMapName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(name)) fail('INVALID_MAP', '맵 이름은 영문, 숫자, 밑줄, 하이픈만 허용합니다.');
  return name;
}
function contained(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
// Resolve the closest existing ancestor, so a not-yet-created child cannot hide a junction.
function prospectiveRealPath(target) {
  let cursor = path.resolve(target);
  const suffix = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) fail('INVALID_PATH', '경로를 확인할 수 없습니다: ' + target);
    suffix.unshift(path.basename(cursor)); cursor = parent;
  }
  return path.resolve(fs.realpathSync.native(cursor), ...suffix);
}
function gamePath(gameRoot) {
  const root = prospectiveRealPath(gameRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail('INVALID_GAME_ROOT', '게임 폴더가 없습니다.');
  return root;
}
function outsideGame(target, root) {
  const dest = prospectiveRealPath(target);
  if (contained(root, dest) || contained(dest, root)) fail('GAME_WRITE_FORBIDDEN', '게임 폴더 또는 그 상위 폴더에는 동기화 파일을 출력할 수 없습니다.');
  return dest;
}
function safeChild(parent, relative, root) {
  const base = outsideGame(parent, root);
  const dest = outsideGame(path.resolve(base, relative), root);
  if (!contained(base, dest) || dest === base) fail('UNSAFE_OUTPUT', '출력 경로가 지정된 폴더를 벗어났습니다.');
  return dest;
}
function writeFile(base, relative, bytes, root) {
  const dest = safeChild(base, relative, root);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (safeChild(base, relative, root) !== dest) fail('UNSAFE_OUTPUT', '출력 경로가 변경되었습니다.');
  fs.writeFileSync(dest, bytes, { flag: 'wx' });
  return dest;
}
function jsonBytes(value) { return JSON.stringify(value, null, 2) + '\n'; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function emptyLayer() { return { size: [0, 0], origin: [0, 0], paletteCount: 0, palette: [], cellCount: 0, cells: [] }; }
function datasetFiles(root) {
  const base = path.join(root, 'RootDesk/MyDesk/DataSet');
  const found = [];
  function visit(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isSymbolicLink()) fail('UNSUPPORTED_SOURCE_LINK', 'DataSet의 링크 경로는 지원하지 않습니다: ' + file);
      if (e.isDirectory()) visit(file);
      else if (e.isFile() && e.name.endsWith('.csv')) found.push(path.relative(root, file).split(path.sep).join('/'));
    }
  }
  visit(base); return found.sort();
}
function sourceRelative(root, relative) {
  const absolute = prospectiveRealPath(path.join(root, relative));
  if (!contained(root, absolute)) fail('UNSUPPORTED_SOURCE_LINK', '게임 외부를 가리키는 원본 경로입니다.');
  return absolute;
}
function loadDependencies(root) {
  const constantFile = sourceRelative(root, 'scripts/build_map.cjs');
  // build_map has require.main protection; only its exported constants are consumed.
  delete require.cache[require.resolve(constantFile)];
  const exported = require(constantFile);
  const constants = Object.fromEntries(CONSTANT_KEYS.map(k => [k, exported[k]]));
  if (Object.values(constants).some(v => !Number.isFinite(v))) fail('INVALID_CONSTANTS', '게임 좌표 상수가 유효하지 않습니다.');
  const candidates = ['.agents/skills', '.claude/skills', '.codex/skills'].map(p => p + '/msw-general/scripts/map/msw_map_builder.cjs');
  const relative = candidates.find(p => fs.existsSync(path.join(root, p)));
  if (!relative) fail('MISSING_BUILDER', '게임의 MapBuilder를 찾지 못했습니다.');
  const builderFile = sourceRelative(root, relative);
  const { MapBuilder, vector3 } = require(builderFile);
  if (!MapBuilder || !vector3) fail('MISSING_BUILDER', 'MapBuilder API를 확인할 수 없습니다.');
  return { MapBuilder, vector3, constants, ppu: Number.isFinite(exported.PPU) && exported.PPU > 0 ? exported.PPU : 100, builderRelative: relative };
}
function catalogFromLock(lock) {
  const entries = [];
  const seen = new Map();
  for (const r of lock.resources || []) {
    const m = FAMILY_NAME.exec(r.name || '');
    if (!m || !r.ruid) continue;
    if (seen.has(r.name) && seen.get(r.name) !== r.ruid) fail('AMBIGUOUS_CATALOG', '동명 타일에 RUID가 여러 개입니다: ' + r.name);
    if (seen.has(r.name)) continue;
    seen.set(r.name, r.ruid);
    const n = Number(m[2]);
    entries.push({ name: r.name, ruid: r.ruid, n, family: m[1] + ':' + m[3], material: m[3], variant: Number(m[4]), px: [n * 256, n * 128] });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
function blockPos(x, y, n, c) {
  const px = ((x - c.ORIGIN_X) - (y - c.ORIGIN_Y)) * c.TILE_W * 0.5;
  const py = -((x - c.ORIGIN_X) + (y - c.ORIGIN_Y) + (n - 1)) * c.TILE_H * 0.5;
  return [px, py, py * c.DEPTH_SCALE];
}
function vector(v, defaults) { return defaults.map((d, i) => Number(v?.[['x', 'y', 'z', 'w'][i]] ?? v?.[i] ?? d)); }
function near(a, b) { return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1e-6); }
function analyzeMap(mb, catalog, constants, size) {
  const byRuid = new Map(catalog.map(t => [t.ruid, t]));
  const blocks = [], coverage = new Map(), reasons = [];
  let tileCount = 0;
  const entities = mb.listEntities();
  if (mb.getTileMapMode() !== 1) reasons.push('RectTile(TileMapMode=1) 맵만 바닥 편집을 지원합니다.');
  for (const item of entities) {
    if (!String(item.name).startsWith('Tile_')) continue;
    tileCount++;
    const m = TILE_NAME.exec(item.name || '');
    const sr = mb.component(item.name, COMPONENT.sprite), tf = mb.component(item.name, COMPONENT.transform);
    const asset = sr && byRuid.get(sr.SpriteRUID);
    if (!m || !asset || !tf) { reasons.push('해석할 수 없는 바닥: ' + item.name); continue; }
    const gx = Number(m[1]), gy = Number(m[2]), n = asset.n;
    const expected = blockPos(gx, gy, n, constants);
    const validTransform = near(vector(tf.Position, [0, 0, 0]), expected)
      && near(vector(tf.Scale, [1, 1, 1]), [1, 1, 1])
      && near(vector(tf.QuaternionRotation, [0, 0, 0, 1]), [0, 0, 0, 1]);
    const color = sr.Color || { r: 1, g: 1, b: 1, a: 1 };
    const entityJson = mb.find(item.name)?.jsonString;
    const standard = validTransform && sr.OrderInLayer === constants.GROUND_ORDER
      && !sr.FlipX && !sr.FlipY && (sr.DrawMode == null || sr.DrawMode === 0)
      && ['r', 'g', 'b', 'a'].every(k => color[k] === 1)
      && sr.Enable !== false && tf.Enable !== false
      && entityJson?.enable !== false && entityJson?.visible !== false
      && (entityJson?.['@components'] || []).every(c => [COMPONENT.transform, COMPONENT.sprite].includes(c['@type']))
      && sr.SortingLayer == null && (sr.PlayRate == null || sr.PlayRate === 1)
      && (sr.StartFrameIndex == null || sr.StartFrameIndex === 0)
      && (sr.EndFrameIndex == null || sr.EndFrameIndex === 2147483647)
      && !entities.some(e => e.path.startsWith(item.path + '/'));
    if (!standard) reasons.push('표준 위치/배율/레이어가 아닌 바닥: ' + item.name);
    const leaf = n === 1 ? asset : catalog.find(t => t.family === asset.family && t.n === 1);
    if (!leaf) reasons.push('1×1 대체 타일이 없는 소재: ' + asset.material);
    const block = { name: item.name, gx, gy, n, ruid: asset.ruid, family: asset.family, leafRuid: leaf?.ruid, standard };
    blocks.push(block);
    for (let dx = 0; dx < n; dx++) for (let dy = 0; dy < n; dy++) {
      const x = gx + dx, y = gy + dy, k = key(x, y);
      if (coverage.has(k)) reasons.push('바닥 블록 겹침: ' + k);
      if (x < 0 || y < 0 || x >= size[0] || y >= size[1]) reasons.push('맵 경계 밖 바닥: ' + k);
      coverage.set(k, block);
    }
  }
  if (!tileCount) reasons.push('Tile_* 바닥이 없는 맵입니다. 오브젝트 바닥은 원본 그대로 보존합니다.');
  return { blocks, coverage, groundEntities: tileCount, totalEntities: entities.length,
    supported: reasons.length === 0 && tileCount > 0, reasons: [...new Set(reasons)] };
}
function projectDefaults(raw, mapName) {
  const p = clone(raw || {});
  p.type = 'web-map-editor-project'; p.version = 2; p.map = p.map || mapName;
  validMapName(p.map);
  p.size = p.size || [1, 1]; p.groundOrigin = p.groundOrigin || [0, 0];
  p.ground = p.ground || []; p.blocked = p.blocked || []; p.entities = p.entities || [];
  p.palette = (p.palette || []).map(t => { const v = { ...t }; delete v.url; delete v.img; return v; });
  delete p.gameObjectEdits; // The actual native map, not an old editor overlay, is the baseline.
  p.staticLayer = p.staticLayer || emptyLayer(); p.attributeBase = p.attributeBase || emptyLayer();
  return p;
}
function protectedState(p) {
  const out = { ...p };
  for (const k of ['ground', 'palette', 'gameSync', 'gameObjectEdits', 'blocked']) delete out[k];
  return out;
}
function counts(blocks, groundCells, groundEntities = blocks.length) {
  const bySize = { '1': 0, '2': 0, '4': 0 };
  for (const b of blocks) bySize[String(b.n)]++;
  return { groundCells, groundEntities, bySize };
}
function readSnapshotSet(root, relatives) {
  return [...new Set(relatives)].sort().map(relative => {
    const absolute = sourceRelative(root, relative);
    const exists = fs.existsSync(absolute);
    const bytes = exists ? fs.readFileSync(absolute) : null;
    return { relative, exists, sha256: bytes ? hash(bytes) : null, bytes };
  });
}
function verifySources(root, manifest, { includeDatasets = false } = {}) {
  const referenceFiles = new Set(manifest.datasetFiles);
  if (includeDatasets && stable(datasetFiles(root)) !== stable(manifest.datasetFiles)) fail('STALE_SOURCE', '게임 DataSet 파일 목록이 기준 시점과 달라졌습니다. 다시 동기화하세요.');
  for (const f of manifest.sourceFiles) {
    // CSVs never enter the compiled map and are never applied. Their current bytes are
    // independently captured at export, rather than locking unrelated game work.
    if (!includeDatasets && referenceFiles.has(f.relative)) continue;
    const absolute = sourceRelative(root, f.relative);
    const exists = fs.existsSync(absolute);
    if (exists !== f.exists || (exists && hash(fs.readFileSync(absolute)) !== f.sha256)) {
      fail('STALE_SOURCE', '게임 원본이 기준 시점과 달라졌습니다: ' + f.relative + '. 다시 동기화하세요.');
    }
  }
}
function referenceChanged() {
  fail('REFERENCE_CHANGED_DURING_EXPORT', '내보내는 동안 CSV 참고 원본이 변경되었습니다. 편집 상태를 유지하고 후보 내보내기를 다시 시도하세요.');
}
function verifyDatasetCapture(root, captured) {
  try {
    if (stable(datasetFiles(root)) !== stable(captured.map(f => f.relative))) referenceChanged();
    for (const f of captured) {
      if (!f.exists) referenceChanged();
      const absolute = sourceRelative(root, f.relative);
      if (!fs.existsSync(absolute) || hash(fs.readFileSync(absolute)) !== f.sha256) referenceChanged();
    }
  } catch (e) {
    if (e.code === 'ENOENT') referenceChanged();
    throw e;
  }
}
function captureDatasetReferences(root, manifest) {
  let captured;
  try { captured = readSnapshotSet(root, datasetFiles(root)); }
  catch (e) { if (e.code === 'ENOENT') referenceChanged(); throw e; }
  verifyDatasetCapture(root, captured);
  const baseline = new Map(manifest.sourceFiles.filter(f => manifest.datasetFiles.includes(f.relative)).map(f => [f.relative, f]));
  const current = new Map(captured.map(f => [f.relative, f]));
  const changes = [];
  for (const relative of [...new Set([...baseline.keys(), ...current.keys()])].sort()) {
    const before = baseline.get(relative), after = current.get(relative);
    if (before?.sha256 === after?.sha256) continue;
    changes.push({ path: relative, status: !before ? 'added' : !after ? 'deleted' : 'modified',
      baselineSha256: before?.sha256 ?? null, currentSha256: after?.sha256 ?? null });
  }
  return { captured, changes };
}
function createSyncProject({ gameRoot, mapName, baselineRoot }) {
  const root = gamePath(gameRoot);
  validMapName(mapName);
  const storage = outsideGame(baselineRoot, root);
  const deps = loadDependencies(root);
  const mapRelative = 'map/' + mapName + '.map', projectRelative = 'map/' + mapName + '.json';
  const ds = datasetFiles(root);
  const snapshots = readSnapshotSet(root, [mapRelative, projectRelative, 'scripts/storage-inventory.lock.json',
    'scripts/build_map.cjs', deps.builderRelative, ...ds]);
  const snapshot = relative => snapshots.find(f => f.relative === relative);
  if (!snapshot(mapRelative)?.exists) fail('MAP_NOT_FOUND', '게임 맵 파일이 없습니다: ' + mapName);
  const raw = snapshot(projectRelative)?.exists ? JSON.parse(snapshot(projectRelative).bytes.toString('utf8').replace(/^\uFEFF/, '')) : null;
  const project = projectDefaults(raw, mapName);
  if (!Array.isArray(project.size) || project.size.length !== 2 || project.size.some(n => !Number.isInteger(n) || n < 1)) fail('INVALID_SIZE', '프로젝트 맵 크기가 유효하지 않습니다.');
  const catalog = catalogFromLock(JSON.parse(snapshot('scripts/storage-inventory.lock.json').bytes.toString('utf8')));
  let analysis;
  try { analysis = analyzeMap(deps.MapBuilder.read(sourceRelative(root, mapRelative)), catalog, deps.constants, project.size); }
  catch (e) { analysis = { blocks: [], coverage: new Map(), groundEntities: 0, totalEntities: 0, supported: false, reasons: ['MapBuilder 읽기 미지원: ' + e.message] }; }
  if (analysis.supported) {
    const index = new Map(project.palette.map((t, i) => [t.ruid, i]));
    for (const asset of catalog.filter(t => t.n === 1)) {
      if (!index.has(asset.ruid)) {
        index.set(asset.ruid, project.palette.length);
        project.palette.push({ name: asset.name, ruid: asset.ruid, px: asset.px, regStatus: 'registered', category: 'foothold' });
      }
    }
    project.groundOrigin = [0, 0];
    project.ground = sortedKeys(analysis.coverage).map(k => { const [x, y] = coord(k); return [x, y, index.get(analysis.coverage.get(k).leafRuid)]; });
  }
  const baselineId = crypto.randomUUID();
  project.gameSync = { version: VERSION, baselineId, mapName: project.map };
  const manifest = {
    version: VERSION, baselineId, mapName: project.map, mapFileName: mapName, gameRoot: root,
    createdAt: new Date().toISOString(), mapRelative, projectRelative, datasetFiles: ds,
    baselineProjectSha256: hash(jsonBytes(project)),
    sourceFiles: snapshots.map(f => ({ relative: f.relative, exists: f.exists, sha256: f.sha256 })), constants: deps.constants, builderRelative: deps.builderRelative,
    catalog, blocks: analysis.blocks, groundEditingSupported: analysis.supported, unsupportedReasons: analysis.reasons,
    totalEntities: analysis.totalEntities, counts: counts(analysis.blocks, analysis.coverage.size, analysis.groundEntities)
  };
  verifySources(root, manifest, { includeDatasets: true });
  const baselineDir = safeChild(storage, baselineId, root);
  if (fs.existsSync(baselineDir)) fail('BASELINE_EXISTS', '기준 폴더가 이미 있습니다.');
  fs.mkdirSync(baselineDir, { recursive: true });
  for (const f of snapshots) if (f.exists) writeFile(baselineDir, 'snapshot/' + f.relative, f.bytes, root);
  writeFile(baselineDir, 'project.json', jsonBytes(project), root);
  writeFile(baselineDir, 'manifest.json', jsonBytes(manifest), root);
  verifySources(root, manifest, { includeDatasets: true });
  const report = { mapName: project.map, baselineId, counts: manifest.counts,
    groundEditingSupported: analysis.supported, preservedEntities: analysis.totalEntities,
    sourceFilesUnchanged: true, sourceFiles: manifest.sourceFiles.length, datasetFiles: ds.length,
    warnings: analysis.supported
      ? ['게임 배치 미리보기와 후보 출력은 실제 게임의 4×4/2×2/1×1 배치를 보존합니다.',
         '바닥 블록 일부를 수정하면 그 블록 안의 그림은 같은 소재의 작은 타일로 다시 구성될 수 있습니다.']
      : analysis.reasons };
  return { project, report, baselineDir, projectPath: path.join(baselineDir, 'project.json') };
}
function loadBaseline(project, { gameRoot, baselineRoot }) {
  const pointer = project?.gameSync;
  if (!pointer || pointer.version !== VERSION || !/^[a-f0-9-]{36}$/.test(pointer.baselineId || '')) fail('INVALID_BASELINE', '게임 동기화 기준 정보가 없습니다.');
  const root = gamePath(gameRoot);
  const storage = outsideGame(baselineRoot, root);
  const dir = safeChild(storage, pointer.baselineId, root);
  const manifest = readJson(safeChild(dir, 'manifest.json', root));
  if (manifest.version !== VERSION || manifest.baselineId !== pointer.baselineId
      || manifest.gameRoot !== root || manifest.mapName !== pointer.mapName || project.map !== manifest.mapName) fail('BASELINE_MISMATCH', '프로젝트와 게임 동기화 기준이 일치하지 않습니다.');
  const baselinePath = safeChild(dir, 'project.json', root);
  if (hash(fs.readFileSync(baselinePath)) !== manifest.baselineProjectSha256) fail('BASELINE_CORRUPT', '기준 프로젝트 파일이 변경되었습니다. 다시 동기화하세요.');
  const baseline = readJson(baselinePath);

  // Snapshots are immutable inputs too: a stale or edited baseline must never become a candidate.
  for (const f of manifest.sourceFiles) {
    if (!f.exists) continue;
    if (hash(fs.readFileSync(safeChild(dir, 'snapshot/' + f.relative, root))) !== f.sha256) fail('BASELINE_CORRUPT', '기준 스냅샷이 변경되었습니다: ' + f.relative);
  }
  return { root, dir, manifest, baseline };
}
function groundMap(project) {
  const out = new Map();
  if (!Array.isArray(project.ground) || !Array.isArray(project.palette)) fail('INVALID_GROUND', '바닥과 팔레트 배열이 필요합니다.');
  for (const tuple of project.ground) {
    if (!Array.isArray(tuple) || tuple.length !== 3 || tuple.some(n => !Number.isInteger(n))) fail('INVALID_GROUND', '바닥 셀은 정수 [x,y,paletteIndex]여야 합니다.');
    const [x, y, i] = tuple;
    if (x < 0 || y < 0 || x >= project.size[0] || y >= project.size[1] || i < 0 || i >= project.palette.length) fail('INVALID_GROUND', '바닥 셀 또는 팔레트 인덱스가 범위를 벗어났습니다.');
    const tile = project.palette[i];
    if (!tile || typeof tile.ruid !== 'string' || !tile.ruid) fail('INVALID_GROUND', '바닥 셀에 RUID가 필요합니다.');
    const k = key(x, y);
    if (out.has(k)) fail('DUPLICATE_CELL', '중복 바닥 셀입니다: ' + k);
    out.set(k, tile.ruid);
  }
  return out;
}
function changesBetween(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].filter(k => before.get(k) !== after.get(k));
}
function hash32(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return (h ^ (h >>> 16)) >>> 0;
}
// Same 4 -> 2 -> 1 cover search as retile_ground, restricted to affected blocks.
// Unlike the CLI it never merges grass with flower grass or changes unedited blocks.
function packCells(cells, catalog) {
  const byRuid = new Map(catalog.map(t => [t.ruid, t]));
  const groups = new Map();
  for (const [k, ruid] of cells) {
    const t = byRuid.get(ruid);
    if (!t || t.n !== 1) fail('UNSUPPORTED_TILE', '편집에는 등록된 페른델 1×1 바닥 소재를 사용하세요: ' + ruid);
    const group = groups.get(ruid) || { tile: t, cells: new Set() };
    group.cells.add(k); groups.set(ruid, group);
  }
  const result = [];
  for (const { tile, cells: target } of groups.values()) {
    const variants = [4, 2, 1].map(n => catalog.filter(t => t.family === tile.family && t.n === n).sort((a, b) => a.variant - b.variant));
    // Transition tiles are directional individual artwork and must never be merged.
    if (tile.material === '길경계') { for (const k of target) { const [gx, gy] = coord(k); result.push({ gx, gy, n: 1, ruid: tile.ruid }); } continue; }
    let best = null;
    const keys = sortedKeys(target);
    for (let ox4 = 0; ox4 < 4; ox4++) for (let oy4 = 0; oy4 < 4; oy4++)
      for (let ox2 = 0; ox2 < 2; ox2++) for (let oy2 = 0; oy2 < 2; oy2++) {
        const claimed = new Set(), candidate = [];
        for (const [n, ox, oy, list] of [[4, ox4, oy4, variants[0]], [2, ox2, oy2, variants[1]], [1, 0, 0, [tile]]]) {
          if (!list.length) continue;
          for (const k of keys) {
            const [gx, gy] = coord(k);
            if (n > 1 && (((gx - ox) % n + n) % n || ((gy - oy) % n + n) % n)) continue;
            const area = [];
            for (let dx = 0; dx < n; dx++) for (let dy = 0; dy < n; dy++) area.push(key(gx + dx, gy + dy));
            if (area.some(k => !target.has(k) || claimed.has(k))) continue;
            area.forEach(k => claimed.add(k));
            const asset = list[hash32(Math.floor(gx / n), Math.floor(gy / n)) % list.length];
            candidate.push({ gx, gy, n, ruid: asset.ruid });
          }
        }
        if (!best || candidate.length < best.length) best = candidate;
      }
    result.push(...best);
  }
  return result.sort((a, b) => a.gy - b.gy || a.gx - b.gx);
}
function inspectSyncProject(project, options) {
  return inspectLoadedProject(project, loadBaseline(project, options));
}
function inspectLoadedProject(project, state) {
  const { root, manifest, baseline } = state;
  verifySources(root, manifest);
  if (stable(protectedState(project)) !== stable(protectedState(baseline))) {
    const a = protectedState(baseline), b = protectedState(project);
    const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => stable(a[k]) !== stable(b[k]));
    fail('UNSUPPORTED_EDIT', '보호된 원본 항목은 직접 바꿀 수 없습니다. 변경 항목: ' + changed.join(', '));
  }
  const deps = loadDependencies(root);
  let original;
  try { original = deps.MapBuilder.read(safeChild(state.dir, 'snapshot/' + manifest.mapRelative, root)); }
  catch { /* Opaque native maps still permit exact unchanged output. */ }
  const objectProfile = original ? objectEdits.analyzeObjects(original, baseline, previewMapSprites(original, manifest.blocks))
    : { records: new Map(), entities: [] };
  const objects = objectEdits.inspectObjectEdits(project.gameObjectEdits, objectProfile, manifest.constants);
  const walkFiles = manifest.datasetFiles.filter(p => path.basename(p) === 'DT_Walk.csv');
  const walkRelative = walkFiles.length === 1 ? walkFiles[0] : null;
  const walkBytes = walkRelative ? fs.readFileSync(safeChild(state.dir, 'snapshot/' + walkRelative, root)) : null;
  const walk = walkEdits.inspectBlocked(project, walkEdits.analyzeWalk(walkBytes, walkRelative, baseline, manifest.mapName));
  const before = groundMap(baseline), after = groundMap(project);
  const changed = changesBetween(before, after);
  if (changed.length && !manifest.groundEditingSupported) fail('UNSUPPORTED_GROUND', '이 맵의 바닥 편집은 지원하지 않습니다: ' + manifest.unsupportedReasons.join(' / '));
  const dirty = new Set(changed), affected = [];
  for (const b of manifest.blocks) {
    let touched = false;
    for (let dx = 0; dx < b.n; dx++) for (let dy = 0; dy < b.n; dy++) if (dirty.has(key(b.gx + dx, b.gy + dy))) touched = true;
    if (touched) {
      affected.push(b);
      for (let dx = 0; dx < b.n; dx++) for (let dy = 0; dy < b.n; dy++) dirty.add(key(b.gx + dx, b.gy + dy));
    }
  }
  const area = new Map([...after].filter(([k]) => dirty.has(k)));
  const replacements = changed.length ? packCells(area, manifest.catalog) : [];
  const mapUnchanged = changed.length === 0 && !objects.changed;
  const warnings = changed.length ? ['수정한 칸과 겹치는 기존 블록만 다시 구성했습니다. 그 블록 안의 무늬는 바뀔 수 있습니다.'] : [...manifest.unsupportedReasons];
  if (objects.changed) warnings.push('선택하지 않은 이동불가 영역은 그대로 유지됩니다. 함께 수정하려면 해당 칸을 직접 선택해 묶음으로 편집하세요.');
  if (walk.changed) warnings.push('후보 DT_Walk에 현재 맵에서 직접 수정한 이동불가 셀만 반영합니다. 게임 원본에는 적용하지 않습니다.');
  return { ...state, before, after, affected, replacements, dirty, objectProfile, objects, walk,
    report: { mapName: manifest.mapName, baselineId: manifest.baselineId, unchanged: mapUnchanged && !walk.changed, mapUnchanged,
      objectChanges: { moved: objects.moved.length, removed: objects.removed.length, added: objects.added.length },
      objectEditingSupported: [...objectProfile.records.values()].some(r => r.descriptor.canMove),
      editableObjects: [...objectProfile.records.values()].filter(r => r.descriptor.canMove).length,
      protectedObjects: [...objectProfile.records.values()].filter(r => !r.descriptor.canMove).length,
      walkEditingSupported: walk.supported, walkEditingReasons: walk.reasons, walkChangedCells: walk.changed,
      changedCells: changed.length, affectedCells: dirty.size, removedGroundEntities: affected.length,
      generatedGroundEntities: replacements.length,
      groundEditingSupported: manifest.groundEditingSupported, strictSourceFilesUnchangedSinceBaseline: true,
      before: manifest.counts,
      counts: counts(manifest.blocks.filter(b => !affected.includes(b)).concat(replacements), after.size,
        manifest.counts.groundEntities - affected.length + replacements.length),
      preservedEntities: manifest.totalEntities - affected.length - objects.moved.length - objects.removed.length,
      warnings } };
}
// Shared in-memory map construction keeps preview and export on the same packing path.
function buildCandidateMap(project, checked) {
  const { root, dir, manifest, affected, replacements, after, report, objects } = checked;
  const deps = loadDependencies(root);
  if (stable(deps.constants) !== stable(manifest.constants)) fail('STALE_SOURCE', '게임 좌표 상수가 변경되었습니다.');
  const originalPath = safeChild(dir, 'snapshot/' + manifest.mapRelative, root);
  const mb = deps.MapBuilder.read(originalPath);
  const changedPaths = new Set([...objects.moved, ...objects.removed].map(e => e.record.item.path));
  const removedNames = new Set(affected.map(b => b.name));
  const preserved = mb.listEntities().filter(e => !removedNames.has(e.name) && !changedPaths.has(e.path)).map(e => [e.path, stable(mb.find(e.path))]);
  if (report.changedCells > 0) {
    for (const b of affected) mb.remove(b.name);
    for (const b of replacements) {
      const name = 'Tile_' + b.gx + '_' + b.gy;
      if (mb.find(name)) fail('ENTITY_COLLISION', '기존 엔티티와 이름이 겹칩니다: ' + name);
      mb.sprite(name, { ruid: b.ruid, pos: blockPos(b.gx, b.gy, b.n, deps.constants), order: deps.constants.GROUND_ORDER });
      mb.patchComponent(name, COMPONENT.transform, { Scale: deps.vector3(1, 1, 1) });
    }
    for (const [name, value] of preserved) if (stable(mb.find(name)) !== value) fail('PRESERVATION_FAILED', '보호 엔티티가 변경되었습니다: ' + name);
    const parsed = analyzeMap(mb, manifest.catalog, deps.constants, project.size);
    const parseErrors = parsed.reasons.filter(reason => !(after.size === 0 && reason.startsWith('Tile_*')));
    if (parseErrors.length || stable(sortedKeys(parsed.coverage)) !== stable(sortedKeys(after))) fail('COVERAGE_FAILED', '출력 바닥의 겹침, 빈칸 또는 좌표 검증에 실패했습니다.');
  }
  const editedObjects = objectEdits.applyObjectEdits(mb, objects, stable);
  for (const [entityPath, value] of preserved) if (stable(mb.find(entityPath)) !== value) fail('PRESERVATION_FAILED', '보호 엔티티가 변경되었습니다: ' + entityPath);
  return { mb, deps, preserved, editedObjects };
}
function previewMapSprites(mb, blocks) {
  // listEntities() sorts by path; build() preserves the file order needed for render ties.
  const sourceIndices = new Map(mb.build().ContentProto.Entities.map((e, index) => [e.id, index]));
  const entities = mb.listEntities().sort((a, b) => sourceIndices.get(a.id) - sourceIndices.get(b.id));
  const byPath = new Map(entities.map(e => [e.path, e]));
  const ground = new Map(blocks.map(b => [b.name || 'Tile_' + b.gx + '_' + b.gy, b]));
  const rootPath = entities.find(e => e.path.split('/').length === 3)?.path;
  const sprites = [], unsupportedSprites = [], unknownLayers = new Set();
  let hiddenSpriteCount = 0, spriteCount = 0;
  const identity = tf => !tf || (near(vector(tf.Position, [0, 0, 0]), [0, 0, 0])
    && near(vector(tf.Scale, [1, 1, 1]), [1, 1, 1])
    && near(vector(tf.QuaternionRotation, [0, 0, 0, 1]), [0, 0, 0, 1]));
  for (let sourceOrder = 0; sourceOrder < entities.length; sourceOrder++) {
    const item = entities[sourceOrder], sr = mb.component(item.path, COMPONENT.sprite);
    if (!sr) continue;
    spriteCount++;
    const tf = mb.component(item.path, COMPONENT.transform);
    const ruid = typeof sr.SpriteRUID === 'string' ? sr.SpriteRUID : sr.SpriteRUID?.DataId;
    const lineage = [];
    let cursor = item.path;
    while (cursor && cursor.startsWith(rootPath || '/maps/')) {
      const ancestor = byPath.get(cursor);
      if (!ancestor) break;
      lineage.push(ancestor);
      if (cursor === rootPath) break;
      cursor = cursor.slice(0, cursor.lastIndexOf('/'));
    }
    const hidden = !ruid || sr.Enable === false || sr.Visible === false || tf?.Enable === false
      || lineage.some(e => {
        const json = mb.find(e.path)?.jsonString;
        return json?.enable === false || json?.visible === false;
      });
    if (hidden) { hiddenSpriteCount++; continue; }
    const position = vector(tf?.Position, [0, 0, 0]), scale3 = vector(tf?.Scale, [1, 1, 1]);
    const quaternion = vector(tf?.QuaternionRotation, [0, 0, 0, 1]);
    const color = ['r', 'g', 'b', 'a'].map(k => Number(sr.Color?.[k] ?? 1));
    const orderInLayer = Number(sr.OrderInLayer ?? 0);
    let reason;
    if (!tf || ![...position, ...scale3, ...quaternion, ...color, orderInLayer].every(Number.isFinite)) reason = '유효하지 않은 변환 또는 색상';
    else if (!rootPath || lineage.at(-1)?.path !== rootPath || lineage.slice(1).some(e => !identity(mb.component(e.path, COMPONENT.transform)))) reason = '부모 엔티티 변환';
    else if (Math.abs(quaternion[0]) > 1e-6 || Math.abs(quaternion[1]) > 1e-6
      || Math.abs(quaternion.reduce((sum, v) => sum + v * v, 0) - 1) > 1e-6) reason = '2D Z축 회전 이외의 회전';
    else if (sr.DrawMode != null && sr.DrawMode !== 0) reason = '타일/슬라이스 렌더링';
    else if (sr.MaterialID || sr.MaterialId) reason = '사용자 머티리얼';
    else if (color.some(v => v < 0 || v > 1)) reason = '일반 범위 밖의 색상';
    if (reason) { unsupportedSprites.push({ path: item.path, reason }); continue; }
    const sortingLayer = sr.SortingLayer == null ? null : String(sr.SortingLayer);
    if (sortingLayer !== null && sortingLayer !== 'Default') unknownLayers.add(sortingLayer);
    const block = ground.get(item.name);
    const sprite = {
      id: item.id, name: item.name, path: item.path, ruid,
      kind: item.name.startsWith('Tile_') ? 'ground' : item.name.startsWith('Obj_') ? 'object' : 'other',
      position, scale: scale3.slice(0, 2), quaternion,
      rotationDeg: 2 * Math.atan2(quaternion[2], quaternion[3]) * 180 / Math.PI,
      flipX: sr.FlipX === true, flipY: sr.FlipY === true, sortingLayer, orderInLayer, sourceOrder, color
    };
    if (block) sprite.ground = { gx: block.gx, gy: block.gy, size: block.n };
    sprites.push(sprite);
  }
  const warnings = [];
  if (unsupportedSprites.length) warnings.push('정적 미리보기에서 지원하지 않는 스프라이트 ' + unsupportedSprites.length + '개를 제외했습니다. 후보 맵에는 원본이 보존됩니다.');
  if (unknownLayers.size) warnings.push('순서를 확인할 수 없는 SortingLayer: ' + [...unknownLayers].join(', ') + '. 해당 레이어의 겹침 순서는 미리보기와 다를 수 있습니다.');
  return { sprites, warnings, spriteCount, hiddenSpriteCount, unsupportedSpriteCount: unsupportedSprites.length, unsupportedSprites };
}
function previewEditedProject(project, options) {
  return previewFromChecked(project, inspectSyncProject(project, options));
}
function previewFromChecked(project, checked) {
  const { mb, deps } = buildCandidateMap(project, checked);
  const { root, manifest, affected, replacements, report } = checked;
  const blocks = manifest.blocks.filter(b => !affected.includes(b)).concat(replacements);
  const scene = previewMapSprites(mb, blocks);
  const nativeObjects = objectEdits.objectScene(mb, checked.objectProfile, checked.objects);
  const objectIds = new Map(nativeObjects.objects.map(o => [o.spriteId, o.entityId]));
  for (const sprite of scene.sprites) if (objectIds.has(sprite.id)) sprite.objectEntityId = objectIds.get(sprite.id);
  verifySources(root, manifest);
  return {
    version: VERSION, baselineId: manifest.baselineId, mapName: manifest.mapName,
    constants: { ...manifest.constants, PPU: deps.ppu }, groundOrigin: clone(project.groundOrigin),
    // Native SpriteRendererComponent.d.mlua declares SortingLayer = "Default".
    defaultSortingLayer: 'Default', sprites: scene.sprites, ...nativeObjects,
    groundBrushRuids: [...new Set(manifest.catalog.filter(t => t.n === 1).map(t => t.ruid))],
    warnings: [...report.warnings, ...scene.warnings],
    report: { ...report, spriteCount: scene.spriteCount, visibleSpriteCount: scene.sprites.length,
      hiddenSpriteCount: scene.hiddenSpriteCount, unsupportedSpriteCount: scene.unsupportedSpriteCount,
      unsupportedSprites: scene.unsupportedSprites, previewMode: 'static-map', runtimeVerified: false }
  };
}
// Original and current previews share one scene encoder; neither path creates files.
function previewBaselineProject({ mapName, baselineId } = {}, options) {
  validMapName(mapName);
  const state = loadBaseline({ map: mapName, gameSync: { version: VERSION, mapName, baselineId } }, options);
  const checked = inspectLoadedProject(state.baseline, state);
  const scene = previewFromChecked(state.baseline, checked);
  return {
    version: VERSION, baselineId: state.manifest.baselineId, mapName: state.manifest.mapName,
    size: clone(state.baseline.size), groundOrigin: clone(state.baseline.groundOrigin), scene,
    ground: sortedKeys(checked.before).map(k => [...coord(k), checked.before.get(k)]),
    blocked: sortedKeys(checked.walk.before).map(coord)
  };
}
function comparisonFromChecked(checked) {
  const { manifest, before, after, affected, replacements, dirty, objects, walk } = checked;
  const changed = new Set(changesBetween(before, after));
  const block = b => ({ name: b.name || 'Tile_' + b.gx + '_' + b.gy, gx: b.gx, gy: b.gy, size: b.n, ruid: b.ruid });
  return {
    version: VERSION, baselineId: manifest.baselineId, mapName: manifest.mapName,
    ground: {
      changedCells: sortedKeys(changed).map(k => { const [gx, gy] = coord(k); return { gx, gy, beforeRuid: before.get(k) ?? null, afterRuid: after.get(k) ?? null }; }),
      repackedCells: sortedKeys(new Set([...dirty].filter(k => !changed.has(k)))).map(coord),
      affectedBeforeBlocks: affected.map(block), replacementBlocks: replacements.map(block)
    },
    objects: {
      // Editor IDs are stable across requests; generated native GUIDs intentionally are not.
      moved: objects.moved.map(e => ({ entityId: e.entityId, from: [...e.record.descriptor.sourcePosition], to: [...e.position] })),
      added: objects.added.map(e => ({ entityId: e.entityId, prototypeId: e.prototypeId, position: [...e.position] })),
      removed: objects.removed.map(e => ({ entityId: e.entityId, position: [...e.record.descriptor.sourcePosition] }))
    },
    blocked: {
      added: sortedKeys(new Set([...walk.after].filter(k => !walk.before.has(k)))).map(coord),
      removed: sortedKeys(new Set([...walk.before].filter(k => !walk.after.has(k)))).map(coord)
    }
  };
}
function compareEditedProject(project, options) {
  const checked = inspectSyncProject(project, options);
  return { scene: previewFromChecked(project, checked), comparison: comparisonFromChecked(checked) };
}
function validateStorageRoot(target, gameRoot) { return outsideGame(target, gamePath(gameRoot)); }

function exportEditedProject(project, { gameRoot, baselineRoot, outputRoot }) {
  const checked = inspectSyncProject(project, { gameRoot, baselineRoot });
  const { root, dir, manifest, affected, report } = checked;
  const references = captureDatasetReferences(root, manifest);
  const walkReference = checked.walk.changed ? references.captured.find(r => r.relative === checked.walk.relative) : null;
  if (checked.walk.changed && !walkReference?.bytes) fail('STALE_WALK_ROWS', 'DT_Walk 원본이 없어졌습니다. 게임 원본을 다시 가져오세요.');
  const walkCandidate = checked.walk.changed ? walkEdits.buildWalkCandidate(walkReference.bytes, checked.walk, manifest.mapName) : null;
  const output = outsideGame(outputRoot, root);
  const storage = outsideGame(baselineRoot, root);
  if (contained(output, storage) || contained(storage, output)) fail('OVERLAPPING_OUTPUT', '후보 출력과 기준 보관 폴더는 서로 겹칠 수 없습니다.');
  const candidateDir = safeChild(output, manifest.mapFileName + '-' + crypto.randomUUID(), root);
  fs.mkdirSync(candidateDir, { recursive: true });
  const originalPath = safeChild(dir, 'snapshot/' + manifest.mapRelative, root);
  const mapPath = safeChild(candidateDir, manifest.mapRelative, root);
  const originalBytes = fs.readFileSync(originalPath);
  let groundComparison;
  if (report.mapUnchanged) {
    writeFile(candidateDir, manifest.mapRelative, originalBytes, root);
    groundComparison = { unchangedRuidTransform: true, coverageExact: true, unchangedBlocks: manifest.counts.groundEntities };
  } else {
    const { mb, deps, preserved, editedObjects } = buildCandidateMap(project, checked);
    fs.mkdirSync(path.dirname(mapPath), { recursive: true });
    if (safeChild(candidateDir, manifest.mapRelative, root) !== mapPath) fail('UNSAFE_OUTPUT', '후보 경로가 변경되었습니다.');
    if (fs.existsSync(mapPath)) fail('CANDIDATE_EXISTS', '후보 파일을 덮어쓰지 않습니다.');
    mb.write(mapPath); // The only structured map write. Destination is verified outside gameRoot.
    const reread = deps.MapBuilder.read(mapPath);
    for (const [name, value] of [...preserved, ...editedObjects]) if (stable(reread.find(name)) !== value) fail('PRESERVATION_FAILED', '저장 후 엔티티 검증 실패: ' + name);
    groundComparison = { unchangedRuidTransform: true, coverageExact: true, unchangedBlocks: manifest.counts.groundEntities - affected.length };
  }
  if (walkCandidate) writeFile(candidateDir, checked.walk.relative, walkCandidate.bytes, root);
  for (const reference of references.captured) {
    writeFile(candidateDir, 'reference/' + reference.relative, reference.bytes, root);
  }
  writeFile(candidateDir, 'editor-project.json', jsonBytes(project), root);
  verifySources(root, manifest);
  verifyDatasetCapture(root, references.captured);
  if (references.changes.length) report.warnings.push('기준 이후 CSV ' + references.changes.length + '개가 변경되어 최신 참고 사본을 보관했습니다. 게임에는 적용하지 않습니다.');
  Object.assign(report, {
    sourceMapSha256: hash(originalBytes), candidateMapSha256: hash(fs.readFileSync(mapPath)),
    exactMapBytes: originalBytes.equals(fs.readFileSync(mapPath)), sourceFilesUnchanged: true,
    strictSourceFilesUnchangedSinceBaseline: true,
    datasetFilesCopied: references.captured.length, datasetsExact: true, datasetReferenceBasis: 'export-start',
    datasetsUnchangedSinceBaseline: references.changes.length === 0,
    datasetChangesSinceBaseline: references.changes, groundComparison,
    applyFiles: [manifest.mapRelative, ...(walkCandidate ? [checked.walk.relative] : [])], datasetReferenceDirectory: 'reference',
    walkComparison: walkCandidate ? walkCandidate.comparison : { unchanged: true },
    objectComparison: { unchangedObjectsExact: true, existingIdsPreserved: true, permittedFieldsOnly: true },
    candidateOnly: true, gameApplied: false, runtimeVerified: false
  });
  const reportPath = writeFile(candidateDir, 'report.json', jsonBytes(report), root);
  return { candidateDir, mapPath, reportPath, report };
}
module.exports = { createSyncProject, inspectSyncProject, exportEditedProject, previewEditedProject, previewBaselineProject, compareEditedProject, validateStorageRoot,
  // Small pure helpers are exported for boundary and packing tests.
  _test: { prospectiveRealPath, outsideGame, packCells, blockPos, catalogFromLock, stable, groundMap, previewMapSprites } };
