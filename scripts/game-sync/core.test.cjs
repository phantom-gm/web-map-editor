'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSyncProject, inspectSyncProject, exportEditedProject, previewEditedProject, previewBaselineProject, compareEditedProject, reviewCandidate, listCandidates, packageCandidate, refreshNpcProject, refreshRuntimeProject, validateStorageRoot, _test } = require('./core.cjs');

function resources() {
  const out = [];
  let id = 0;
  for (const [material, sizes] of [['잔디', [1, 2, 4]], ['물', [1, 2, 4]], ['꽃잔디', [1, 2, 4]], ['길경계', [1]]]) {
    for (const n of sizes) for (const v of [1, 2]) out.push({
      name: '페른델_' + n + 'x' + n + '_' + material + '_' + String(v).padStart(2, '0'),
      ruid: (++id).toString(16).padStart(32, '0')
    });
  }
  return out;
}
const catalog = _test.catalogFromLock({ resources: resources() });
const tile = (material, n = 1, variant = 1) => catalog.find(t => t.material === material && t.n === n && t.variant === variant);
function rect(w, h, ruid = tile('잔디').ruid) {
  const cells = new Map();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.set(x + ',' + y, ruid);
  return cells;
}
function covered(blocks) {
  const cells = new Set();
  for (const b of blocks) for (let dy = 0; dy < b.n; dy++) for (let dx = 0; dx < b.n; dx++) {
    const k = (b.gx + dx) + ',' + (b.gy + dy);
    assert.equal(cells.has(k), false, 'overlap at ' + k); cells.add(k);
  }
  return [...cells].sort();
}
test('uniform 4x4 cells pack into one native-size tile', () => {
  const cells = rect(4, 4), blocks = _test.packCells(cells, catalog);
  assert.equal(blocks.length, 1); assert.equal(blocks[0].n, 4);
  assert.deepEqual(covered(blocks), [...cells.keys()].sort());
});
test('partial block edit leaves exact coverage without filling the hole', () => {
  const cells = rect(4, 4); cells.delete('1,1');
  const blocks = _test.packCells(cells, catalog);
  assert.deepEqual(covered(blocks), [...cells.keys()].sort());
  assert.ok(blocks.some(b => b.n === 2)); assert.ok(blocks.some(b => b.n === 1));
});
test('mixed materials and explicit variants are not merged across each other', () => {
  const cells = rect(4, 4);
  cells.set('0,0', tile('꽃잔디').ruid); cells.set('1,0', tile('잔디', 1, 2).ruid);
  const blocks = _test.packCells(cells, catalog);
  assert.deepEqual(covered(blocks), [...cells.keys()].sort());
  assert.ok(blocks.some(b => b.gx === 0 && b.gy === 0 && b.ruid === tile('꽃잔디').ruid));
  assert.ok(blocks.some(b => b.gx === 1 && b.gy === 0 && b.ruid === tile('잔디', 1, 2).ruid));
});
test('directional transition artwork is always preserved at 1x1', () => {
  const cells = rect(4, 4, tile('길경계', 1, 2).ruid), blocks = _test.packCells(cells, catalog);
  assert.equal(blocks.length, 16);
  assert.ok(blocks.every(b => b.n === 1 && b.ruid === tile('길경계', 1, 2).ruid));
});
test('missing large art safely falls back and unknown/large brush tiles fail closed', () => {
  const ones = catalog.filter(t => t.n === 1);
  assert.equal(_test.packCells(rect(4, 4), ones).length, 16);
  assert.throws(() => _test.packCells(new Map([['0,0', 'unknown']]), catalog), e => e.code === 'UNSUPPORTED_TILE');
  assert.throws(() => _test.packCells(new Map([['0,0', tile('잔디', 4).ruid]]), catalog), e => e.code === 'UNSUPPORTED_TILE');
});
test('duplicate resource names with conflicting RUIDs are rejected', () => {
  assert.throws(() => _test.catalogFromLock({ resources: [{ name: tile('잔디').name, ruid: 'a' }, { name: tile('잔디').name, ruid: 'b' }] }), e => e.code === 'AMBIGUOUS_CATALOG');
});
test('packing is deterministic regardless of cell insertion order', () => {
  const cells = rect(8, 8); cells.delete('2,2'); cells.delete('5,5');
  assert.deepEqual(_test.packCells(cells, catalog), _test.packCells(new Map([...cells].reverse()), catalog));
});
test('ground rejects duplicate/out-of-bounds cells and invalid palette indices', () => {
  const p = { size: [4, 4], palette: [{ ruid: 'a' }], ground: [[0, 0, 0], [0, 0, 0]] };
  assert.throws(() => _test.groundMap(p), e => e.code === 'DUPLICATE_CELL');
  p.ground = [[4, 0, 0]]; assert.throws(() => _test.groundMap(p), e => e.code === 'INVALID_GROUND');
  p.ground = [[0, 0, -1]]; assert.throws(() => _test.groundMap(p), e => e.code === 'INVALID_GROUND');
});

// The integration fixture uses the actual project's authoring builder, but every fixture
// source and write is in a newly created OS temp folder. No test mutates the game checkout.
const sourceRoot = process.env.MSW_GAME_SYNC_TEST_ROOT || 'C:/Trunk/legend_of_light';
const builderSource = ['.agents/skills', '.claude/skills', '.codex/skills']
  .map(p => path.join(sourceRoot, p, 'msw-general/scripts/map/msw_map_builder.cjs')).find(p => fs.existsSync(p));
const fixtureOptions = { skip: !builderSource && 'Set MSW_GAME_SYNC_TEST_ROOT to a checkout containing MapBuilder.' };
function fixture(t, { noGround = false, mapMode = 1 } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'msw-game-sync-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'game'), baselineRoot = path.join(temp, 'baselines'), outputRoot = path.join(temp, 'candidates');
  function put(relative, content) { const p = path.join(root, relative); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; }
  const builderRel = '.agents/skills/msw-general/scripts/map/msw_map_builder.cjs';
  put(builderRel, fs.readFileSync(builderSource));
  const constants = { TILE_W: 2.56, TILE_H: 1.28, ORIGIN_X: 15, ORIGIN_Y: 15, DEPTH_SCALE: 0.21875, GROUND_ORDER: -1000 };
  put('scripts/build_map.cjs', 'module.exports = ' + JSON.stringify(constants) + ';');
  put('scripts/storage-inventory.lock.json', JSON.stringify({ resources: resources() }));
  const csvRelative = 'RootDesk/MyDesk/DataSet/world/DT_Portal.csv';
  put(csvRelative, '\uFEFFPortalID,MapName,X,Y\r\np1,fixture,3,2\r\np2,elsewhere,7,8\r\n');
  put('RootDesk/MyDesk/DataSet/actor/DT_MonsterSpawn.csv', 'NpcClassID,MapName\r\n12,fixture\r\n');
  const { MapBuilder } = require(path.join(root, builderRel));
  const mb = new MapBuilder('fixture');
  mb.entity('/maps/fixture', [{ '@type': 'MOD.Core.MapComponent', TileMapMode: mapMode }]);
  mb.sprite('Obj_keep', { ruid: 'object-ruid', pos: [7, 8, 9], order: 0 });
  mb.upsertComponent('Obj_keep', 'script.UnknownPreservedComponent', { '@type': 'script.UnknownPreservedComponent', Value: 'protected' });
  if (!noGround) for (const [x, y, n, material, variant] of [[0, 0, 4, '잔디', 1], [4, 0, 4, '물', 2], [0, 4, 2, '꽃잔디', 1], [3, 5, 1, '길경계', 2]]) {
    mb.sprite('Tile_' + x + '_' + y, { ruid: tile(material, n, variant).ruid, pos: _test.blockPos(x, y, n, constants), order: -1000 });
  }
  fs.mkdirSync(path.join(root, 'map'), { recursive: true });
  mb.write(path.join(root, 'map/fixture.map'));
  const mapText = fs.readFileSync(path.join(root, 'map/fixture.map'), 'utf8');
  fs.writeFileSync(path.join(root, 'map/fixture.map'), mapText.replace(/\n/g, '\r\n')); // exact byte no-op matters.
  put('map/fixture.json', JSON.stringify({
    type: 'web-map-editor-project', version: 2, map: 'fixture', size: [8, 8], groundOrigin: [0, 0],
    ground: noGround ? [] : [[0, 0, 0]], palette: [{ name: tile('잔디').name, ruid: tile('잔디').ruid, px: [256, 128] }],
    blocked: [[2, 2]], entities: [{ id: 'keep', kind: 'object', gx: 3, gy: 3, name: 'existing', ruid: 'object-ruid' }]
  }));
  const options = { gameRoot: root, baselineRoot, outputRoot };
  const hashes = () => Object.fromEntries(['map/fixture.map', 'map/fixture.json', csvRelative].map(rel => [rel, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex')]));
  return { root, temp, options, csvRelative, MapBuilder, hashes };
}
test('no-op copies exact map bytes and CSV reference snapshots; source remains unchanged', fixtureOptions, t => {
  const f = fixture(t), before = f.hashes();
  const imported = createSyncProject({ ...f.options, mapName: 'fixture' });
  assert.equal(imported.report.counts.groundEntities, 4);
  assert.equal(imported.report.counts.groundCells, 37);
  const result = exportEditedProject(JSON.parse(JSON.stringify(imported.project)), f.options);
  assert.equal(result.report.exactMapBytes, true);
  assert.equal(result.report.changedCells, 0);
  assert.equal(result.report.datasetsExact, true);
  assert.equal(result.report.datasetReferenceBasis, 'export-start');
  assert.equal(result.report.datasetsUnchangedSinceBaseline, true);
  assert.deepEqual(result.report.datasetChangesSinceBaseline, []);
  assert.deepEqual(result.report.applyFiles, ['map/fixture.map']);
  assert.ok(fs.readFileSync(result.mapPath).equals(fs.readFileSync(path.join(f.root, 'map/fixture.map'))));
  assert.ok(fs.readFileSync(path.join(result.candidateDir, 'reference', f.csvRelative)).equals(fs.readFileSync(path.join(f.root, f.csvRelative))));
  assert.equal(fs.existsSync(path.join(result.candidateDir, f.csvRelative)), false);
  assert.deepEqual(f.hashes(), before);
});
test('one-cell edit rebuilds its intersecting block and preserves other entities and coverage', fixtureOptions, t => {
  const f = fixture(t), before = f.hashes();
  const { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const original = f.MapBuilder.read(path.join(f.root, 'map/fixture.map'));
  const water = project.palette.findIndex(p => p.ruid === tile('물').ruid);
  project.ground.find(c => c[0] === 1 && c[1] === 1)[2] = water;
  const result = exportEditedProject(project, f.options), candidate = f.MapBuilder.read(result.mapPath);
  assert.equal(result.report.changedCells, 1);
  assert.equal(result.report.affectedCells, 16);
  assert.equal(result.report.removedGroundEntities, 1);
  for (const name of ['fixture', 'Obj_keep', 'Tile_4_0', 'Tile_0_4', 'Tile_3_5']) assert.deepEqual(candidate.find(name), original.find(name));
  assert.equal(result.report.counts.groundCells, 37);
  assert.equal(result.report.groundComparison.coverageExact, true);
  assert.deepEqual(f.hashes(), before);
});
test('erase one cell preserves a hole; deleting all ground remains a valid candidate', fixtureOptions, t => {
  const f = fixture(t);
  const { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  project.ground = project.ground.filter(c => !(c[0] === 1 && c[1] === 1));
  const partial = exportEditedProject(project, f.options);
  assert.equal(partial.report.counts.groundCells, 36);
  project.ground = [];
  const empty = exportEditedProject(project, f.options);
  assert.equal(empty.report.counts.groundEntities, 0); assert.equal(empty.report.counts.groundCells, 0);
});
test('protected data edits and missing/tampered sync pointer are explicitly rejected', fixtureOptions, t => {
  const f = fixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  for (const [field, value] of [['size', [9, 9]], ['entities', []], ['groundOrigin', [1, 0]]]) {
    assert.throws(() => inspectSyncProject({ ...project, [field]: value }, f.options), e => e.code === 'UNSUPPORTED_EDIT');
  }
  assert.throws(() => inspectSyncProject({ ...project, gameSync: undefined }, f.options), e => e.code === 'INVALID_BASELINE');
  assert.throws(() => inspectSyncProject({ ...project, map: 'other' }, f.options), e => e.code === 'BASELINE_MISMATCH');
});
test('CSV modifications since baseline use current exact reference bytes and report the change', fixtureOptions, t => {
  const f = fixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const csv = path.join(f.root, f.csvRelative), original = fs.readFileSync(csv);
  fs.appendFileSync(csv, 'p3,other,1,1\r\n');
  const current = fs.readFileSync(csv), result = exportEditedProject(project, f.options);
  assert.ok(fs.readFileSync(path.join(result.candidateDir, 'reference', f.csvRelative)).equals(current));
  assert.equal(result.report.datasetsExact, true);
  assert.equal(result.report.datasetReferenceBasis, 'export-start');
  assert.equal(result.report.datasetsUnchangedSinceBaseline, false);
  assert.equal(result.report.sourceFilesUnchanged, true);
  assert.equal(result.report.strictSourceFilesUnchangedSinceBaseline, true);
  assert.equal(result.report.exactMapBytes, true);
  assert.deepEqual(result.report.datasetChangesSinceBaseline, [{
    path: f.csvRelative, status: 'modified',
    baselineSha256: crypto.createHash('sha256').update(original).digest('hex'),
    currentSha256: crypto.createHash('sha256').update(current).digest('hex')
  }]);
  assert.ok(result.report.warnings.some(w => w.includes('CSV 1개') && w.includes('게임에는 적용하지 않습니다')));
});
test('CSV additions and deletions since baseline copy only the current reference set', fixtureOptions, t => {
  const f = fixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const added = 'RootDesk/MyDesk/DataSet/world/DT_Added.csv';
  fs.writeFileSync(path.join(f.root, added), '\uFEFFKey,Value\r\nnew,1\r\n');
  fs.unlinkSync(path.join(f.root, f.csvRelative));
  const result = exportEditedProject(project, f.options);
  assert.equal(result.report.datasetFilesCopied, 2);
  assert.equal(result.report.datasetsUnchangedSinceBaseline, false);
  assert.equal(result.report.datasetsExact, true);
  assert.equal(result.report.datasetReferenceBasis, 'export-start');
  assert.equal(fs.existsSync(path.join(result.candidateDir, 'reference', f.csvRelative)), false);
  assert.ok(fs.readFileSync(path.join(result.candidateDir, 'reference', added)).equals(fs.readFileSync(path.join(f.root, added))));
  const changes = result.report.datasetChangesSinceBaseline;
  assert.deepEqual(changes.map(c => [c.path, c.status]), [[added, 'added'], [f.csvRelative, 'deleted']]);
  assert.equal(changes[0].baselineSha256, null);
  assert.equal(changes[1].currentSha256, null);
  assert.deepEqual(result.report.applyFiles, ['map/fixture.map']);
});
test('map, project, catalog, constants and builder changes remain strictly stale', fixtureOptions, t => {
  for (const relative of ['map/fixture.map', 'map/fixture.json', 'scripts/storage-inventory.lock.json',
    'scripts/build_map.cjs', '.agents/skills/msw-general/scripts/map/msw_map_builder.cjs']) {
    const f = fixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
    fs.appendFileSync(path.join(f.root, relative), ' ');
    assert.throws(() => exportEditedProject(project, f.options), e => e.code === 'STALE_SOURCE', relative);
  }
});
test('CSV modification or reference-list change during export requests a retry', fixtureOptions, t => {
  for (const change of ['modify', 'add', 'delete']) {
    const f = fixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
    const write = fs.writeFileSync;
    let changed = false;
    fs.writeFileSync = function (file, ...args) {
      if (!changed && String(file).startsWith(f.options.outputRoot) && String(file).includes(path.sep + 'reference' + path.sep)) {
        changed = true;
        if (change === 'modify') write.call(fs, path.join(f.root, f.csvRelative), 'changed,during-export\r\n');
        if (change === 'add') write.call(fs, path.join(f.root, 'RootDesk/MyDesk/DataSet/world/DT_Concurrent.csv'), 'new,value\r\n');
        if (change === 'delete') fs.unlinkSync(path.join(f.root, f.csvRelative));
      }
      return write.call(fs, file, ...args);
    };
    try {
      assert.throws(() => exportEditedProject(project, f.options), e => e.code === 'REFERENCE_CHANGED_DURING_EXPORT', change);
      assert.equal(changed, true);
    } finally { fs.writeFileSync = write; }
  }
});
test('tampering with baseline project or map bytes is rejected', fixtureOptions, t => {
  const f = fixture(t), imported = createSyncProject({ ...f.options, mapName: 'fixture' });
  fs.appendFileSync(imported.projectPath, ' ');
  assert.throws(() => inspectSyncProject(imported.project, f.options), e => e.code === 'BASELINE_CORRUPT');
  const again = createSyncProject({ ...f.options, mapName: 'fixture' });
  fs.appendFileSync(path.join(again.baselineDir, 'snapshot/map/fixture.map'), ' ');
  assert.throws(() => inspectSyncProject(again.project, f.options), e => e.code === 'BASELINE_CORRUPT');
});
test('game root, ancestor paths, and junction destinations cannot receive outputs', fixtureOptions, t => {
  const f = fixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' }), before = f.hashes();
  for (const outputRoot of [f.root, path.join(f.root, 'temp/output'), f.temp]) {
    assert.throws(() => exportEditedProject(project, { ...f.options, outputRoot }), e => e.code === 'GAME_WRITE_FORBIDDEN');
  }
  const link = path.join(f.temp, 'game-link');
  fs.symlinkSync(f.root, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => exportEditedProject(project, { ...f.options, outputRoot: path.join(link, 'output') }), e => e.code === 'GAME_WRITE_FORBIDDEN');
  assert.deepEqual(f.hashes(), before);
});
test('unsupported map mode and object-only floors permit only exact no-op output', fixtureOptions, t => {
  for (const options of [{ noGround: true }, { mapMode: 0 }]) {
    const f = fixture(t, options), { project, report } = createSyncProject({ ...f.options, mapName: 'fixture' });
    assert.equal(report.groundEditingSupported, false);
    assert.equal(exportEditedProject(project, f.options).report.exactMapBytes, true);
    project.ground.push([7, 7, 0]);
    assert.throws(() => exportEditedProject(project, f.options), e => e.code === 'UNSUPPORTED_GROUND');
  }
});
test('unused appended palette entries do not turn a no-op into a map rebuild', fixtureOptions, t => {
  const f = fixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  project.palette.push({ name: 'unused user asset', ruid: 'unused-ruid', px: [64, 64] });
  const result = exportEditedProject(project, f.options);
  assert.equal(result.report.exactMapBytes, true);
});

test('preview is read-only and keeps the actual mixed-size floor blocks and native object transform', fixtureOptions, t => {
  const f = fixture(t), before = f.hashes(), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const write = fs.writeFileSync;
  let scene;
  fs.writeFileSync = () => { throw new Error('Preview must never write files'); };
  try { scene = previewEditedProject(project, f.options); } finally { fs.writeFileSync = write; }
  assert.equal(scene.defaultSortingLayer, 'Default');
  assert.deepEqual(new Set(scene.groundBrushRuids), new Set(catalog.filter(t => t.n === 1).map(t => t.ruid)));
  assert.equal(scene.constants.TILE_W, 2.56); assert.equal(scene.constants.PPU, 100);
  assert.deepEqual(scene.groundOrigin, [0, 0]);
  assert.equal(scene.sprites.length, 5);
  assert.equal(scene.report.hiddenSpriteCount, 0); assert.equal(scene.report.unsupportedSpriteCount, 0);
  assert.deepEqual(scene.sprites.filter(s => s.kind === 'ground').map(s => s.ground.size), [4, 4, 2, 1]);
  const object = scene.sprites.find(s => s.name === 'Obj_keep');
  assert.deepEqual(object.position, [7, 8, 9]); assert.deepEqual(object.scale, [1, 1]);
  assert.deepEqual(object.quaternion, [0, 0, 0, 1]); assert.equal(object.rotationDeg, 0);
  assert.equal(object.sortingLayer, null); assert.equal(object.kind, 'object');
  assert.deepEqual(f.hashes(), before);
  assert.equal(fs.existsSync(f.options.outputRoot), false);
});
test('edited preview and exported map use identical sprite RUIDs, transforms, ordering and unaffected IDs', fixtureOptions, t => {
  const f = fixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const baseline = previewEditedProject(project, f.options);
  project.ground.find(c => c[0] === 1 && c[1] === 1)[2] = project.palette.findIndex(p => p.ruid === tile('물').ruid);
  const scene = previewEditedProject(project, f.options), result = exportEditedProject(project, f.options);
  const baked = _test.previewMapSprites(f.MapBuilder.read(result.mapPath), []);
  const renderFields = sprite => Object.fromEntries(Object.entries(sprite).filter(([name]) => !['id', 'ground', 'objectEntityId'].includes(name)));
  assert.deepEqual(scene.sprites.map(renderFields), baked.sprites.map(renderFields));
  assert.deepEqual(scene.report.counts, result.report.counts);
  for (const name of ['Obj_keep', 'Tile_4_0', 'Tile_0_4', 'Tile_3_5']) {
    const stableFields = sprite => Object.fromEntries(Object.entries(sprite).filter(([key]) => key !== 'sourceOrder'));
    assert.deepEqual(stableFields(scene.sprites.find(s => s.name === name)), stableFields(baseline.sprites.find(s => s.name === name)));
  }
  assert.equal(scene.report.changedCells, 1);
});
test('preview retains native rotation, flips, color and unknown layer with an explicit warning', fixtureOptions, t => {
  const f = fixture(t), mb = f.MapBuilder.read(path.join(f.root, 'map/fixture.map'));
  mb.patchComponent('Obj_keep', 'MOD.Core.TransformComponent', {
    Scale: { x: 2, y: 0.5, z: 1 }, QuaternionRotation: { x: 0, y: 0, z: Math.sin(Math.PI / 8), w: Math.cos(Math.PI / 8) }
  });
  mb.patchComponent('Obj_keep', 'MOD.Core.SpriteRendererComponent', {
    FlipX: true, FlipY: true, SortingLayer: 'UnconfirmedCustomLayer', OrderInLayer: 13, Color: { r: 0.2, g: 0.4, b: 0.6, a: 0.7 }
  });
  const scene = _test.previewMapSprites(mb, []), object = scene.sprites.find(s => s.name === 'Obj_keep');
  assert.deepEqual(object.scale, [2, 0.5]); assert.ok(Math.abs(object.rotationDeg - 45) < 1e-9);
  assert.equal(object.flipX, true); assert.equal(object.flipY, true); assert.equal(object.orderInLayer, 13);
  assert.deepEqual(object.color, [0.2, 0.4, 0.6, 0.7]); assert.equal(object.sortingLayer, 'UnconfirmedCustomLayer');
  assert.ok(scene.warnings.some(w => w.includes('UnconfirmedCustomLayer')));
});
test('preview excludes hidden entities, renderers, transforms and hidden-parent descendants', fixtureOptions, t => {
  const f = fixture(t);
  const cases = [
    mb => mb.entity('Obj_keep', mb.find('Obj_keep').jsonString['@components'], { enable: false }),
    mb => mb.entity('Obj_keep', mb.find('Obj_keep').jsonString['@components'], { visible: false }),
    mb => mb.patchComponent('Obj_keep', 'MOD.Core.SpriteRendererComponent', { Enable: false }),
    mb => mb.patchComponent('Obj_keep', 'MOD.Core.SpriteRendererComponent', { Visible: false }),
    mb => mb.patchComponent('Obj_keep', 'MOD.Core.TransformComponent', { Enable: false }),
    mb => mb.patchComponent('Obj_keep', 'MOD.Core.SpriteRendererComponent', { SpriteRUID: '' })
  ];
  for (const hide of cases) {
    const mb = f.MapBuilder.read(path.join(f.root, 'map/fixture.map')); hide(mb);
    const scene = _test.previewMapSprites(mb, []);
    assert.equal(scene.hiddenSpriteCount, 1); assert.equal(scene.sprites.some(s => s.name === 'Obj_keep'), false);
  }
  const mb = f.MapBuilder.read(path.join(f.root, 'map/fixture.map'));
  mb.entity('/maps/fixture', mb.find('fixture').jsonString['@components'], { visible: false });
  const hidden = _test.previewMapSprites(mb, []);
  assert.equal(hidden.hiddenSpriteCount, 5); assert.equal(hidden.sprites.length, 0);
});
test('unsupported parent transforms, 3D rotation, draw mode and materials are explicitly counted', fixtureOptions, t => {
  const f = fixture(t), mb = f.MapBuilder.read(path.join(f.root, 'map/fixture.map'));
  mb.empty('Parent', { pos: [1, 0, 0] }).sprite('Parent/Child', { ruid: 'child' });
  mb.sprite('Rotated3D', { ruid: '3d' }).patchComponent('Rotated3D', 'MOD.Core.TransformComponent', { QuaternionRotation: { x: 1, y: 0, z: 0, w: 0 } });
  mb.sprite('Tiled', { ruid: 'tiled' }).patchComponent('Tiled', 'MOD.Core.SpriteRendererComponent', { DrawMode: 1 });
  mb.sprite('Material', { ruid: 'material' }).patchComponent('Material', 'MOD.Core.SpriteRendererComponent', { MaterialID: 'custom' });
  const scene = _test.previewMapSprites(mb, []);
  assert.equal(scene.unsupportedSpriteCount, 4); assert.equal(scene.sprites.length, 5);
  assert.ok(scene.warnings.some(w => w.includes('4개')));
  assert.equal(scene.unsupportedSprites.length, 4);
});
test('preview preserves source order for ties and keeps protected-source rejection', fixtureOptions, t => {
  const f = fixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const mb = f.MapBuilder.read(path.join(f.root, 'map/fixture.map'));
  mb.sprite('TieZ', { ruid: 'z', pos: [0, 0, 0], order: 0 }).sprite('TieA', { ruid: 'a', pos: [0, 0, 0], order: 0 });
  const ties = _test.previewMapSprites(mb, []).sprites.filter(s => s.name.startsWith('Tie'));
  assert.deepEqual(ties.map(s => s.name), ['TieZ', 'TieA']);
  assert.ok(ties[0].sourceOrder < ties[1].sourceOrder);
  assert.throws(() => previewEditedProject({ ...project, entities: [] }, f.options), e => e.code === 'UNSUPPORTED_EDIT');
  fs.appendFileSync(path.join(f.root, 'map/fixture.map'), ' ');
  assert.throws(() => previewEditedProject(project, f.options), e => e.code === 'STALE_SOURCE');
  assert.equal(validateStorageRoot(f.options.outputRoot, f.root), path.resolve(f.options.outputRoot));
  assert.throws(() => validateStorageRoot(path.join(f.root, 'output'), f.root), e => e.code === 'GAME_WRITE_FORBIDDEN');
});

function objectFixture(t, options) {
  const f = fixture(t, options), mapPath = path.join(f.root, 'map/fixture.map');
  const mb = f.MapBuilder.read(mapPath);
  mb.sprite('Obj_editable', { ruid: 'editable-ruid', pos: [7, 8, 1.77], order: 0 });
  mb.patchComponent('Obj_editable', 'MOD.Core.TransformComponent', {
    Scale: { x: 1.4, y: 0.7, z: 1 }, QuaternionRotation: { x: 0, y: 0, z: Math.sin(0.2), w: Math.cos(0.2) }
  });
  mb.patchComponent('Obj_editable', 'MOD.Core.SpriteRendererComponent', {
    FlipX: true, Color: { r: 0.4, g: 0.6, b: 0.8, a: 0.9 }
  });
  mb.upsertComponent('Obj_editable', 'script.IsoDepthMetaComponent', {
    '@type': 'script.IsoDepthMetaComponent', GX: 2, GY: 3, W: 2, H: 3, StaticOrder: 0, StaticZ: 1.77,
    BaseW: 7, BaseH: 5, ScaleX: 1.4, ScaleY: 0.7, Fade: true, SortPadX: 0.3
  });
  mb.sprite('Obj_floor', { ruid: 'floor-ruid', pos: [-1, 1, 0.24], order: -999 });
  mb.write(mapPath);
  const walkRelative = 'RootDesk/MyDesk/DataSet/world/DT_Walk.csv';
  const walkPath = path.join(f.root, walkRelative);
  fs.writeFileSync(walkPath, '\uFEFFMapName,CellX,CellY\r\n"elsewhere","5","6"\nfixture,2,2\r\nfixture,3,3\nlast,7,8');
  const projectPath = path.join(f.root, 'map/fixture.json');
  const p = JSON.parse(fs.readFileSync(projectPath, 'utf8')); p.blocked = [[2, 2], [3, 3]];
  fs.writeFileSync(projectPath, JSON.stringify(p));
  return { ...f, mapPath, walkRelative, walkPath };
}
const objectPatch = (moved = [], removed = [], added = []) => ({ version: 1, moved, removed, added });
test('native object move preserves GUID, every unrelated field and source files while updating depth metadata', fixtureOptions, t => {
  const f = objectFixture(t), before = f.hashes(), walkBefore = fs.readFileSync(f.walkPath);
  const { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const base = previewEditedProject(project, f.options), item = base.objects.find(o => o.name === 'Obj_editable');
  assert.ok(item.canMove && item.canDelete && item.canDuplicate); assert.ok(item.collisionNote);
  assert.equal(base.objects.find(o => o.name === 'existing').canMove, false);
  project.gameObjectEdits = objectPatch([{ entityId: item.entityId, position: [8.28, 7.36] }]);
  const preview = previewEditedProject(project, f.options), output = exportEditedProject(project, f.options);
  const original = f.MapBuilder.read(f.mapPath), candidate = f.MapBuilder.read(output.mapPath);
  const expected = JSON.parse(JSON.stringify(original.find('Obj_editable')));
  const tf = expected.jsonString['@components'].find(c => c['@type'] === 'MOD.Core.TransformComponent');
  tf.Position = { x: 8.28, y: 7.36, z: 1.63 };
  const meta = expected.jsonString['@components'].find(c => c['@type'] === 'script.IsoDepthMetaComponent');
  meta.GX = 3; meta.GY = 3; meta.StaticZ = 1.63;
  assert.deepEqual(candidate.find('Obj_editable'), expected);
  for (const e of original.listEntities().filter(e => e.name !== 'Obj_editable')) assert.deepEqual(candidate.find(e.path), original.find(e.path));
  assert.equal(preview.sprites.find(s => s.objectEntityId === item.entityId).id, item.spriteId);
  assert.deepEqual(preview.objects.find(o => o.entityId === item.entityId).position, [8.28, 7.36, 1.63]);
  assert.deepEqual(output.report.objectChanges, { moved: 1, removed: 0, added: 0 });
  assert.equal(output.report.changedCells, 0); assert.equal(output.report.walkChangedCells, 0);
  assert.deepEqual(output.report.applyFiles, ['map/fixture.map']);
  assert.deepEqual(f.hashes(), before); assert.ok(fs.readFileSync(f.walkPath).equals(walkBefore));
});
test('duplicate/delete use baseline prototypes, fresh native IDs and stable editor IDs; undo restores exact bytes', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const base = previewEditedProject(project, f.options), prototype = base.objects.find(o => o.name === 'Obj_editable');
  const addedId = crypto.randomUUID();
  project.gameObjectEdits = objectPatch([], [prototype.entityId], [{ entityId: addedId, prototypeId: prototype.entityId, position: [5.72, 7.36] }]);
  const scene = previewEditedProject(project, f.options), exported = exportEditedProject(project, f.options);
  const candidate = f.MapBuilder.read(exported.mapPath);
  assert.equal(candidate.find('Obj_editable'), null);
  const added = scene.objects.find(o => o.entityId === addedId);
  assert.equal(added.prototypeId, prototype.entityId); assert.equal(added.canDuplicate, true);
  assert.notEqual(added.spriteId, prototype.spriteId);
  assert.equal(scene.objectPrototypes.some(o => o.entityId === prototype.entityId), true);
  const native = candidate.find('Obj_Editor_' + addedId);
  assert.notEqual(native.id, prototype.spriteId); assert.equal(native.jsonString.origin.root_entity_id, native.id);
  const previewSprite = scene.sprites.find(s => s.objectEntityId === addedId);
  const bakedSprite = _test.previewMapSprites(candidate, []).sprites.find(s => s.name === native.jsonString.name);
  const visual = s => Object.fromEntries(Object.entries(s).filter(([k]) => !['id', 'objectEntityId'].includes(k)));
  assert.deepEqual(visual(previewSprite), visual(bakedSprite));
  assert.deepEqual(candidate.component(native.path, 'script.IsoDepthMetaComponent').GX, 2);
  assert.deepEqual(candidate.component(native.path, 'script.IsoDepthMetaComponent').GY, 4);
  delete project.gameObjectEdits;
  const undone = exportEditedProject(project, f.options);
  assert.ok(fs.readFileSync(undone.mapPath).equals(fs.readFileSync(f.mapPath)));
  assert.equal(undone.report.unchanged, true);
});
test('empty overlays and identical moves remain exact byte no-ops', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const item = previewEditedProject(project, f.options).objects.find(o => o.name === 'Obj_editable');
  for (const patch of [objectPatch(), objectPatch([{ entityId: item.entityId, position: item.position.slice(0, 2) }])]) {
    project.gameObjectEdits = patch;
    assert.equal(exportEditedProject(project, f.options).report.exactMapBytes, true);
  }
});
test('unsupported ground does not prevent independent object-floor edits', fixtureOptions, t => {
  const f = objectFixture(t, { noGround: true }), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const scene = previewEditedProject(project, f.options);
  assert.equal(scene.report.groundEditingSupported, false);
  const floor = scene.objects.find(o => o.name === 'Obj_floor');
  project.gameObjectEdits = objectPatch([{ entityId: floor.entityId, position: [0.28, 0.36] }]);
  const result = exportEditedProject(project, f.options);
  assert.equal(result.report.objectChanges.moved, 1);
  assert.equal(result.report.counts.groundEntities, 0);
});
test('object patches reject unsafe IDs, unknown components, references, children, fractional moves and extra mutations', fixtureOptions, t => {
  const f = objectFixture(t);
  const mb = f.MapBuilder.read(f.mapPath);
  mb.sprite('Obj_parent', { ruid: 'parent' }).sprite('Obj_parent/Child', { ruid: 'child' });
  mb.sprite('Obj_ref', { ruid: 'referenced' });
  mb.empty('Reference').upsertComponent('Reference', 'script.Other', { '@type': 'script.Other', Target: mb.find('Obj_ref').id });
  mb.write(f.mapPath);
  const { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const scene = previewEditedProject(project, f.options), item = scene.objects.find(o => o.name === 'Obj_editable');
  for (const name of ['existing', 'Obj_parent', 'Obj_ref']) {
    const row = scene.objects.find(o => o.name === name); assert.equal(row.canMove, false, name);
    project.gameObjectEdits = objectPatch([], [row.entityId]);
    assert.throws(() => exportEditedProject(project, f.options), e => e.code === 'PROTECTED_OBJECT');
  }
  const invalid = [
    [objectPatch([{ entityId: item.entityId, position: [7.1, 8] }]), 'OBJECT_GRID_REQUIRED'],
    [objectPatch([{ entityId: item.entityId, position: [7, Infinity] }]), 'INVALID_OBJECT_POSITION'],
    [objectPatch([], [], [{ entityId: 'bad', prototypeId: item.entityId, position: [7, 8] }]), 'INVALID_OBJECT_ID'],
    [objectPatch([], [], [{ entityId: crypto.randomUUID(), prototypeId: 'missing', position: [7, 8] }]), 'UNKNOWN_OBJECT'],
    [objectPatch([{ entityId: item.entityId, position: [7, 8], ruid: 'changed' }]), 'INVALID_OBJECT_EDITS'],
    [objectPatch([{ entityId: item.entityId, position: [7, 8] }], [item.entityId]), 'DUPLICATE_OBJECT_EDIT']
  ];
  for (const [patch, code] of invalid) {
    project.gameObjectEdits = patch;
    assert.throws(() => inspectSyncProject(project, f.options), e => e.code === code, code);
  }
});
test('explicit blocked edits preserve map bytes, other map CSV records and current-map unchanged records exactly', fixtureOptions, t => {
  const f = objectFixture(t), sourceMap = fs.readFileSync(f.mapPath), sourceWalk = fs.readFileSync(f.walkPath);
  const { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  assert.equal(previewEditedProject(project, f.options).report.walkEditingSupported, true);
  project.blocked = [[3, 3], [4, 4]];
  const result = exportEditedProject(project, f.options);
  assert.equal(result.report.mapUnchanged, true); assert.equal(result.report.unchanged, false);
  assert.equal(result.report.walkChangedCells, 2); assert.equal(result.report.exactMapBytes, true);
  assert.deepEqual(result.report.applyFiles, ['map/fixture.map', f.walkRelative]);
  const candidate = fs.readFileSync(path.join(result.candidateDir, f.walkRelative), 'utf8');
  assert.equal(candidate, '\uFEFFMapName,CellX,CellY\r\n"elsewhere","5","6"\nfixture,4,4\r\nfixture,3,3\nlast,7,8');
  assert.ok(fs.readFileSync(path.join(result.candidateDir, 'reference', f.walkRelative)).equals(sourceWalk));
  assert.ok(fs.readFileSync(f.mapPath).equals(sourceMap)); assert.ok(fs.readFileSync(f.walkPath).equals(sourceWalk));
  assert.equal(result.report.walkComparison.unchangedOtherRowsExact, true);
  project.blocked = [[2, 2], [3, 3]];
  const undo = exportEditedProject(project, f.options);
  assert.equal(undo.report.unchanged, true); assert.deepEqual(undo.report.applyFiles, ['map/fixture.map']);
});
test('target-map walk changes are stale while newer other-map CSV rows are preserved', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  project.blocked = [[2, 2], [4, 4]];
  fs.appendFileSync(f.walkPath, '\r\nother,1,1\r\n');
  const good = exportEditedProject(project, f.options);
  assert.ok(fs.readFileSync(path.join(good.candidateDir, f.walkRelative), 'utf8').endsWith('other,1,1\r\n'));
  const changed = fs.readFileSync(f.walkPath, 'utf8').replace('fixture,2,2', 'fixture,2,3');
  fs.writeFileSync(f.walkPath, changed);
  assert.throws(() => exportEditedProject(project, f.options), e => e.code === 'STALE_WALK_ROWS');
});
test('invalid blocked edits and mismatched walk baselines fail closed without preventing no-op export', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  for (const blocked of [[[1, 1], [1, 1]], [[-1, 0]], [[8, 0]], [[1.2, 1]], [[1, 1, 2]]]) {
    assert.throws(() => inspectSyncProject({ ...project, blocked }, f.options), e => e.code === 'INVALID_BLOCKED');
  }
  fs.writeFileSync(f.walkPath, 'MapName,CellX,CellY\r\nfixture,0,0\r\n');
  const imported = createSyncProject({ ...f.options, mapName: 'fixture' });
  assert.equal(previewEditedProject(imported.project, f.options).report.walkEditingSupported, false);
  assert.equal(exportEditedProject(imported.project, f.options).report.exactMapBytes, true);
  assert.throws(() => exportEditedProject({ ...imported.project, blocked: [] }, f.options), e => e.code === 'UNSUPPORTED_WALK');
});

test('rounded original positions remain no-op and plain floors retain their depth residual', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const scene = previewEditedProject(project, f.options), floor = scene.objects.find(o => o.name === 'Obj_floor');
  project.gameObjectEdits = objectPatch([{ entityId: floor.entityId, position: [floor.position[0] + 1e-9, floor.position[1] - 1e-9] }]);
  assert.equal(exportEditedProject(project, f.options).report.exactMapBytes, true);
  project.gameObjectEdits.moved[0].position = [floor.position[0] + 1.28, floor.position[1] - 0.64];
  const moved = previewEditedProject(project, f.options).objects.find(o => o.entityId === floor.entityId);
  assert.ok(Math.abs(moved.position[2] - (floor.position[2] - 0.64 * 0.21875)) < 1e-12);
  assert.ok(Math.abs((moved.position[2] - moved.position[1] * 0.21875) - (floor.position[2] - floor.position[1] * 0.21875)) < 1e-12);
});
test('opaque MapBuilder inputs still allow exact no-op export', fixtureOptions, t => {
  const f = fixture(t), read = f.MapBuilder.read;
  f.MapBuilder.read = () => { throw new Error('Opaque format'); };
  try {
    const { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
    assert.equal(exportEditedProject(project, f.options).report.exactMapBytes, true);
  } finally { f.MapBuilder.read = read; }
});
test('walk candidate source change during export is rejected before reporting success', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  project.blocked = [[3, 3], [4, 4]];
  const write = fs.writeFileSync; let changed = false;
  fs.writeFileSync = function (file, ...args) {
    if (!changed && String(file).startsWith(f.options.outputRoot) && String(file).endsWith('DT_Walk.csv')) {
      changed = true; write.call(fs, f.walkPath, 'MapName,CellX,CellY\r\nfixture,0,0\r\n');
    }
    return write.call(fs, file, ...args);
  };
  try { assert.throws(() => exportEditedProject(project, f.options), e => e.code === 'REFERENCE_CHANGED_DURING_EXPORT'); }
  finally { fs.writeFileSync = write; }
  assert.equal(changed, true);
});
test('first blocked cells preserve an unterminated other-map row and alternate CSV column order', fixtureOptions, t => {
  const f = objectFixture(t), file = path.join(f.root, 'map/fixture.json');
  const source = JSON.parse(fs.readFileSync(file, 'utf8')); source.blocked = []; fs.writeFileSync(file, JSON.stringify(source));
  fs.writeFileSync(f.walkPath, '\uFEFFCellY,MapName,CellX\r\n"6","elsewhere","5"');
  const { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  project.blocked = [[2, 3]];
  const result = exportEditedProject(project, f.options);
  assert.equal(fs.readFileSync(path.join(result.candidateDir, f.walkRelative), 'utf8'), '\uFEFFCellY,MapName,CellX\r\n3,fixture,2\r\n"6","elsewhere","5"');
});


function compareIdentity(project) { return { mapName: project.map, baselineId: project.gameSync.baselineId }; }
function assertEmptyComparison(value) {
  assert.deepEqual(value.ground, { changedCells: [], repackedCells: [], affectedBeforeBlocks: [], replacementBlocks: [] });
  assert.deepEqual(value.objects, { moved: [], added: [], removed: [] });
  assert.deepEqual(value.blocked, { added: [], removed: [] });
}
function readWithoutWrites(callback) {
  const methods = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'copyFileSync', 'renameSync', 'unlinkSync', 'rmSync'];
  const originals = methods.map(name => [name, fs[name]]);
  for (const name of methods) fs[name] = () => assert.fail('Read-only preview attempted ' + name);
  try { return callback(); } finally { for (const [name, method] of originals) fs[name] = method; }
}
function fileTreeHashes(root) {
  const result = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name), relative = path.relative(root, file);
      if (entry.isDirectory()) { result[relative] = 'directory'; visit(file); }
      else result[relative] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }
  visit(root); return result;
}
test('baseline and comparison readers create no files and return the original native scene and logical cells', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const before = fileTreeHashes(f.temp), identity = compareIdentity(project);
  const { baseline, compared, regular } = readWithoutWrites(() => ({
    baseline: previewBaselineProject(identity, f.options),
    compared: compareEditedProject(project, f.options), regular: previewEditedProject(project, f.options)
  }));
  assert.deepEqual(fileTreeHashes(f.temp), before);
  assert.equal(fs.existsSync(f.options.outputRoot), false);
  assert.deepEqual(baseline.scene, regular); assert.deepEqual(compared.scene, regular);
  assert.deepEqual(baseline.size, project.size); assert.deepEqual(baseline.groundOrigin, project.groundOrigin);
  assert.deepEqual(baseline.ground, project.ground.map(([gx, gy, i]) => [gx, gy, project.palette[i].ruid]));
  assert.deepEqual(baseline.blocked, [[2, 2], [3, 3]]);
  assert.equal(compared.comparison.baselineId, identity.baselineId); assert.equal(compared.comparison.mapName, 'fixture');
  assertEmptyComparison(compared.comparison);
  assert.equal(Object.hasOwn(regular, 'comparison'), false); // Existing hot-path payload remains unchanged.
});
test('comparison separates one changed material cell from the fifteen repacked neighbours', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const baseline = previewBaselineProject(compareIdentity(project), f.options);
  project.ground.find(c => c[0] === 1 && c[1] === 1)[2] = project.palette.findIndex(p => p.ruid === tile('물').ruid);
  const { scene, comparison } = compareEditedProject(project, f.options);
  assert.deepEqual(comparison.ground.changedCells, [{ gx: 1, gy: 1, beforeRuid: tile('잔디').ruid, afterRuid: tile('물').ruid }]);
  assert.equal(comparison.ground.repackedCells.length, 15);
  assert.equal(comparison.ground.repackedCells.some(([x, y]) => x === 1 && y === 1), false);
  assert.deepEqual(comparison.ground.affectedBeforeBlocks, [{ name: 'Tile_0_0', gx: 0, gy: 0, size: 4, ruid: tile('잔디', 4).ruid }]);
  for (const block of comparison.ground.replacementBlocks) {
    const sprite = scene.sprites.find(s => s.name === block.name);
    assert.equal(sprite.ruid, block.ruid); assert.deepEqual(sprite.ground, { gx: block.gx, gy: block.gy, size: block.size });
  }
  assert.equal(scene.report.changedCells, 1); assert.equal(scene.report.affectedCells, 16);
  assert.deepEqual(previewBaselineProject(compareIdentity(project), f.options), baseline);
  assert.equal(fs.existsSync(f.options.outputRoot), false);
});
test('comparison uses RUID semantics and explicit nulls for added and erased ground cells', fixtureOptions, t => {
  const f = fixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const originalIndex = project.ground[0][2];
  project.palette.push({ ...project.palette[originalIndex], name: 'duplicate palette entry' });
  project.ground[0][2] = project.palette.length - 1;
  assertEmptyComparison(compareEditedProject(project, f.options).comparison);
  project.ground = project.ground.filter(c => !(c[0] === 1 && c[1] === 1));
  project.ground.push([7, 7, originalIndex]);
  const result = compareEditedProject(project, f.options).comparison.ground;
  assert.deepEqual(result.changedCells, [
    { gx: 1, gy: 1, beforeRuid: tile('잔디').ruid, afterRuid: null },
    { gx: 7, gy: 7, beforeRuid: null, afterRuid: tile('잔디').ruid }
  ]);
  assert.equal(result.repackedCells.length, 15);
  assert.equal(result.affectedBeforeBlocks.length, 1);
  assert.ok(result.replacementBlocks.some(b => b.gx === 7 && b.gy === 7 && b.size === 1));
});
test('comparison object changes use stable editor IDs and the same normalized world positions as its scene', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const original = JSON.parse(JSON.stringify(project));
  const baseline = previewBaselineProject(compareIdentity(project), f.options);
  const moving = baseline.scene.objects.find(o => o.name === 'Obj_editable');
  const removed = baseline.scene.objects.find(o => o.name === 'Obj_floor');
  const id = crypto.randomUUID();
  project.gameObjectEdits = objectPatch([{ entityId: moving.entityId, position: [moving.position[0] + 1.28, moving.position[1] - 0.64] }], [removed.entityId],
    [{ entityId: id, prototypeId: moving.entityId, position: [moving.position[0] - 1.28, moving.position[1] - 0.64] }]);
  project.blocked = [[2, 2], [4, 4]];
  const first = compareEditedProject(project, f.options), second = compareEditedProject(project, f.options);
  assert.deepEqual(first.comparison, second.comparison);
  const movedSprite = first.scene.objects.find(o => o.entityId === moving.entityId);
  const addedSprite = first.scene.objects.find(o => o.entityId === id);
  assert.deepEqual(first.comparison.objects, {
    moved: [{ entityId: moving.entityId, from: moving.position, to: movedSprite.position }],
    added: [{ entityId: id, prototypeId: moving.entityId, position: addedSprite.position }],
    removed: [{ entityId: removed.entityId, position: removed.position }]
  });
  assert.notEqual(addedSprite.spriteId, second.scene.objects.find(o => o.entityId === id).spriteId);
  assert.ok(first.scene.sprites.some(s => s.id === addedSprite.spriteId && s.objectEntityId === id));
  assert.equal(first.scene.objects.some(o => o.entityId === removed.entityId), false);
  assert.deepEqual(first.comparison.blocked, { added: [[4, 4]], removed: [[3, 3]] });
  assert.deepEqual(previewBaselineProject(compareIdentity(project), f.options), baseline);
  assertEmptyComparison(compareEditedProject(original, f.options).comparison);
  original.gameObjectEdits = objectPatch([{ entityId: moving.entityId, position: moving.position.slice(0, 2).map(n => Number(n.toFixed(8))) }]);
  assertEmptyComparison(compareEditedProject(original, f.options).comparison);
});
test('baseline comparison readers retain unsupported-ground warnings and independent object-floor changes', fixtureOptions, t => {
  const f = objectFixture(t, { noGround: true }), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const baseline = previewBaselineProject(compareIdentity(project), f.options);
  assert.equal(baseline.scene.report.groundEditingSupported, false); assert.deepEqual(baseline.ground, []);
  const floor = baseline.scene.objects.find(o => o.name === 'Obj_floor');
  project.gameObjectEdits = objectPatch([{ entityId: floor.entityId, position: [floor.position[0] + 1.28, floor.position[1] - 0.64] }]);
  const result = compareEditedProject(project, f.options);
  assert.equal(result.scene.report.groundEditingSupported, false); assert.equal(result.comparison.objects.moved.length, 1);
  assert.deepEqual(result.comparison.ground, { changedCells: [], repackedCells: [], affectedBeforeBlocks: [], replacementBlocks: [] });
});
test('baseline comparison requests reject traversal, mismatched identities, stale sources and corrupted snapshots', fixtureOptions, t => {
  const f = objectFixture(t), imported = createSyncProject({ ...f.options, mapName: 'fixture' }), { project } = imported;
  const identity = compareIdentity(project);
  assert.throws(() => previewBaselineProject({ ...identity, baselineId: '../escape' }, f.options), e => e.code === 'INVALID_BASELINE');
  assert.throws(() => previewBaselineProject({ ...identity, mapName: '../escape' }, f.options), e => e.code === 'INVALID_MAP');
  assert.throws(() => previewBaselineProject({ ...identity, mapName: 'another' }, f.options), e => e.code === 'BASELINE_MISMATCH');
  assert.throws(() => compareEditedProject({ ...project, groundOrigin: [99, 99] }, f.options), e => e.code === 'UNSUPPORTED_EDIT');
  fs.appendFileSync(path.join(f.root, 'map/fixture.map'), ' ');
  assert.throws(() => previewBaselineProject(identity, f.options), e => e.code === 'STALE_SOURCE');
  assert.throws(() => compareEditedProject(project, f.options), e => e.code === 'STALE_SOURCE');
  const again = createSyncProject({ ...f.options, mapName: 'fixture' });
  fs.appendFileSync(again.projectPath, ' ');
  assert.throws(() => previewBaselineProject(compareIdentity(again.project), f.options), e => e.code === 'BASELINE_CORRUPT');
  assert.throws(() => compareEditedProject(again.project, f.options), e => e.code === 'BASELINE_CORRUPT');
});
test('baseline and comparison previews recheck sources after native scene generation', fixtureOptions, t => {
  for (const action of ['baseline', 'compare']) {
    const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
    const build = f.MapBuilder.prototype.build; let changed = false;
    f.MapBuilder.prototype.build = function (...args) {
      const value = build.apply(this, args);
      if (!changed) { changed = true; fs.appendFileSync(path.join(f.root, 'map/fixture.map'), ' '); }
      return value;
    };
    try {
      assert.throws(() => action === 'baseline' ? previewBaselineProject(compareIdentity(project), f.options) : compareEditedProject(project, f.options), e => e.code === 'STALE_SOURCE');
      assert.equal(changed, true); assert.equal(fs.existsSync(f.options.outputRoot), false);
    } finally { f.MapBuilder.prototype.build = build; }
  }
});


const reviewInput = (output, project) => ({ candidateId: output.candidateId, mapName: project.map, baselineId: project.gameSync.baselineId });
test('candidate review manifest records exact files and hashes while review is strictly read-only', fixtureOptions, t => {
  const f = objectFixture(t), sourceBefore = fileTreeHashes(f.root);
  const { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const output = exportEditedProject(project, f.options);
  const manifest = JSON.parse(fs.readFileSync(path.join(output.candidateDir, 'review-manifest.json'), 'utf8'));
  assert.match(output.candidateId, /^[a-f0-9-]{36}$/); assert.equal(output.report.candidateId, output.candidateId);
  assert.equal(manifest.candidateId, output.candidateId); assert.equal(manifest.createdAt, output.report.createdAt);
  assert.deepEqual(manifest.applyFiles.map(f => f.path), output.report.applyFiles);
  assert.equal(manifest.referenceFiles.length, 3); assert.ok(manifest.referenceFiles.every(f => f.path.startsWith('reference/')));
  for (const item of [...manifest.referenceFiles, manifest.project, manifest.report]) {
    const bytes = fs.readFileSync(path.join(output.candidateDir, item.path));
    assert.equal(item.bytes, bytes.length); assert.equal(item.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  }
  const before = fileTreeHashes(f.temp), review = readWithoutWrites(() => reviewCandidate(reviewInput(output, project), f.options));
  assert.deepEqual(fileTreeHashes(f.temp), before); assert.deepEqual(fileTreeHashes(f.root), sourceBefore);
  assert.equal(review.status, 'ready'); assert.deepEqual(review.issues, []); assert.ok(review.checks.every(c => c.passed === true && c.detail === undefined));
  assert.equal(review.files.length, 1); assert.equal(review.files[0].path, 'map/fixture.map');
  assert.equal(review.files[0].sourceMatches, true); assert.equal(review.files[0].candidateMatches, true);
  assert.equal(review.files[0].sourceSha256, review.files[0].candidateSha256);
  assert.ok(Number.isFinite(Date.parse(review.checkedAt))); assert.equal(review.gameApplied, false); assert.equal(review.runtimeVerified, false);
  assert.deepEqual(review.summary, { groundChangedCells: 0, groundRepackedCells: 0, objectsMoved: 0, objectsAdded: 0, objectsRemoved: 0, blockedAdded: 0, blockedRemoved: 0, walkChangedCells: 0 });
});
test('mixed candidate review summarizes material, native objects and explicit blocked edits', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const scene = previewEditedProject(project, f.options), object = scene.objects.find(o => o.name === 'Obj_editable'), floor = scene.objects.find(o => o.name === 'Obj_floor');
  project.ground.find(c => c[0] === 1 && c[1] === 1)[2] = project.palette.findIndex(p => p.ruid === tile('물').ruid);
  project.gameObjectEdits = objectPatch([{ entityId: object.entityId, position: [8.28, 7.36] }], [floor.entityId], [{ entityId: crypto.randomUUID(), prototypeId: object.entityId, position: [5.72, 7.36] }]);
  project.blocked = [[2, 2], [4, 4]];
  const output = exportEditedProject(project, f.options), review = reviewCandidate(reviewInput(output, project), f.options);
  assert.equal(review.status, 'ready'); assert.deepEqual(review.files.map(f => f.path), ['map/fixture.map', f.walkRelative]);
  assert.deepEqual(review.summary, { groundChangedCells: 1, groundRepackedCells: 15, objectsMoved: 1, objectsAdded: 1, objectsRemoved: 1, blockedAdded: 1, blockedRemoved: 1, walkChangedCells: 2 });
  assert.ok(review.files.every(file => file.sourceMatches && file.candidateMatches && file.sourceSha256 !== file.candidateSha256));
});
test('candidate review blocks modified or missing map, walk, editor project and report files', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' }); project.blocked.push([4, 4]);
  const output = exportEditedProject(project, f.options), input = reviewInput(output, project);
  for (const relative of ['map/fixture.map', f.walkRelative, 'editor-project.json', 'report.json']) {
    const file = path.join(output.candidateDir, relative), original = fs.readFileSync(file);
    for (const operation of ['modify', 'remove']) {
      if (operation === 'modify') fs.appendFileSync(file, ' '); else fs.unlinkSync(file);
      const review = readWithoutWrites(() => reviewCandidate(input, f.options));
      assert.equal(review.status, 'blocked', relative + ' ' + operation); assert.ok(review.issues.some(issue => issue.includes(relative)));
      if (relative === 'map/fixture.map' || relative === f.walkRelative) {
        const row = review.files.find(item => item.path === relative); assert.equal(row.candidateMatches, false);
        assert.equal(row.currentCandidateSha256 === null, operation === 'remove');
      }
      fs.writeFileSync(file, original);
    }
  }
  assert.equal(reviewCandidate(input, f.options).status, 'ready');
});
test('review blocks any applied DT_Walk source change but permits unrelated current reference CSV edits', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' }); project.blocked.push([4, 4]);
  const output = exportEditedProject(project, f.options), input = reviewInput(output, project);
  fs.appendFileSync(path.join(f.root, f.csvRelative), 'p-new,elsewhere,1,2');
  assert.equal(reviewCandidate(input, f.options).status, 'ready');
  fs.appendFileSync(f.walkPath, '\nother-map,1,2');
  const review = reviewCandidate(input, f.options);
  assert.equal(review.status, 'blocked'); assert.equal(review.files.find(file => file.path === f.walkRelative).sourceMatches, false);
  assert.ok(review.issues.some(issue => issue.includes('DT_Walk')));
  const noWalk = { ...project, blocked: [[2, 2], [3, 3]] };
  const withoutWalk = exportEditedProject(noWalk, f.options);
  fs.appendFileSync(f.walkPath, '\nother-map,4,5');
  assert.equal(reviewCandidate(reviewInput(withoutWalk, noWalk), f.options).status, 'ready');
});
test('review strictly checks current native map, project, catalog, constants and builder hashes', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const output = exportEditedProject(project, f.options), input = reviewInput(output, project);
  for (const relative of ['map/fixture.map', 'map/fixture.json', 'scripts/storage-inventory.lock.json', 'scripts/build_map.cjs', '.agents/skills/msw-general/scripts/map/msw_map_builder.cjs']) {
    const file = path.join(f.root, relative), original = fs.readFileSync(file); fs.appendFileSync(file, ' ');
    const review = reviewCandidate(input, f.options); assert.equal(review.status, 'blocked', relative);
    assert.ok(review.issues.some(issue => issue.includes(relative))); fs.writeFileSync(file, original);
  }
});
test('legacy, malformed and mismatched candidate metadata fail closed with a rebake instruction', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const output = exportEditedProject(project, f.options), input = reviewInput(output, project);
  const file = path.join(output.candidateDir, 'review-manifest.json'), original = fs.readFileSync(file);
  fs.unlinkSync(file); let review = reviewCandidate(input, f.options); assert.equal(review.status, 'blocked'); assert.ok(review.issues.some(s => s.includes('다시 구워')));
  for (const bytes of ['{broken', 'null', JSON.stringify({ ...JSON.parse(original), mapName: 'elsewhere' })]) {
    fs.writeFileSync(file, bytes); review = reviewCandidate(input, f.options);
    assert.equal(review.status, 'blocked'); assert.deepEqual(review.files, []); assert.ok(review.checks.every(c => typeof c.passed === 'boolean'));
    assert.ok(review.issues.some(s => s.includes('다시 구워')));
  }
  fs.writeFileSync(file, original);
  const record = JSON.parse(original); record.applyFiles[0].path = 'reference/RootDesk/MyDesk/DataSet/world/DT_Portal.csv';
  fs.writeFileSync(file, JSON.stringify(record)); assert.equal(reviewCandidate(input, f.options).status, 'blocked');
  fs.writeFileSync(file, original);
  const corruptSource = JSON.parse(original); corruptSource.applyFiles[0].sourceSha256 = '0'.repeat(64);
  fs.writeFileSync(file, JSON.stringify(corruptSource)); review = reviewCandidate(input, f.options); assert.equal(review.status, 'blocked');
  assert.ok(review.checks.some(c => c.label.includes('기록 정합성') && c.passed === false));
});
test('candidate review rejects unsafe IDs and linked candidate folders or inner map folders', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const output = exportEditedProject(project, f.options), input = reviewInput(output, project);
  assert.throws(() => reviewCandidate({ ...input, candidateId: '../map' }, f.options), e => e.code === 'INVALID_CANDIDATE');
  assert.throws(() => reviewCandidate({ ...input, mapName: '../map' }, f.options), e => e.code === 'INVALID_MAP');
  assert.throws(() => reviewCandidate(input, { ...f.options, outputRoot: f.root }), e => e.code === 'GAME_WRITE_FORBIDDEN');
  const mapDir = path.join(output.candidateDir, 'map'); fs.renameSync(mapDir, mapDir + '-saved');
  fs.symlinkSync(path.join(f.root, 'map'), mapDir, 'junction');
  assert.throws(() => reviewCandidate(input, f.options), e => e.code === 'UNSAFE_CANDIDATE');
  const next = exportEditedProject(project, f.options), nextInput = reviewInput(next, project);
  fs.renameSync(next.candidateDir, next.candidateDir + '-saved'); fs.symlinkSync(f.root, next.candidateDir, 'junction');
  assert.throws(() => reviewCandidate(nextInput, f.options), e => e.code === 'UNSAFE_CANDIDATE');
});
test('review catches baseline or reference snapshot tampering and changes during the review', fixtureOptions, t => {
  const f = objectFixture(t), imported = createSyncProject({ ...f.options, mapName: 'fixture' }), { project } = imported;
  project.blocked.push([4, 4]); const output = exportEditedProject(project, f.options), input = reviewInput(output, project);
  const baselineProject = fs.readFileSync(imported.projectPath); fs.appendFileSync(imported.projectPath, ' ');
  assert.equal(reviewCandidate(input, f.options).status, 'blocked'); fs.writeFileSync(imported.projectPath, baselineProject);
  const reference = path.join(output.candidateDir, 'reference', f.csvRelative), originalReference = fs.readFileSync(reference);
  fs.appendFileSync(reference, ' '); assert.equal(reviewCandidate(input, f.options).status, 'blocked'); fs.writeFileSync(reference, originalReference);
  for (const changedPath of [f.walkPath, path.join(output.candidateDir, 'map/fixture.map')]) {
    const original = fs.readFileSync(changedPath), read = fs.readFileSync; let changed = false;
    fs.readFileSync = function(file, ...args) {
      const bytes = read.call(fs, file, ...args);
      if (!changed && path.resolve(String(file)) === path.resolve(reference)) { changed = true; fs.appendFileSync(changedPath, ' '); }
      return bytes;
    };
    try { const review = reviewCandidate(input, f.options); assert.equal(changed, true); assert.equal(review.status, 'blocked'); assert.ok(review.issues.some(i => i.includes('검토 도중'))); }
    finally { fs.readFileSync = read; fs.writeFileSync(changedPath, original); }
  }
});


// ZIP checks intentionally parse the archive independently of the writer.
function unzipStored(bytes) {
  const entries = new Map(), end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12);
  let cursor = bytes.readUInt32LE(end + 16); const centralStart = cursor;
  for (let n = 0; n < count; n++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50); assert.equal(bytes.readUInt16LE(cursor + 8), 0x800);
    assert.equal(bytes.readUInt16LE(cursor + 10), 0);
    const crc = bytes.readUInt32LE(cursor + 16), length = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'), offset = bytes.readUInt32LE(cursor + 42);
    assert.equal(bytes.readUInt32LE(offset), 0x04034b50); assert.equal(bytes.readUInt16LE(offset + 6), 0x800);
    assert.equal(bytes.readUInt32LE(offset + 14), crc); assert.equal(bytes.readUInt32LE(offset + 18), length);
    assert.equal(bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), name);
    const data = bytes.subarray(offset + 30 + nameLength, offset + 30 + nameLength + length);
    let calculated = 0xffffffff;
    for (const b of data) { calculated ^= b; for (let bit = 0; bit < 8; bit++) calculated = (calculated >>> 1) ^ ((calculated & 1) ? 0xedb88320 : 0); }
    assert.equal((calculated ^ 0xffffffff) >>> 0, crc, 'CRC mismatch: ' + name);
    assert.equal(entries.has(name), false); entries.set(name, data);
    cursor += 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  }
  assert.equal(cursor - centralStart, centralSize); assert.equal(cursor, end);
  return entries;
}
test('ZIP writer emits UTF-8 stored entries with valid CRC and rejects unsafe/duplicate/ZIP64 names', () => {
  const { createStoredZip, crc32 } = require('./zip.cjs');
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const entries = [{ name: 'map/한글.map', bytes: Buffer.from('native bytes\r\n') }, { name: 'empty.csv', bytes: Buffer.alloc(0) }];
  const archive = unzipStored(createStoredZip(entries));
  for (const entry of entries) assert.deepEqual(archive.get(entry.name), entry.bytes);
  for (const name of ['../outside', '/absolute', 'C:/game', 'a\\b', 'a//b', 'a/./b', 'bad\0path', 'x'.repeat(65536)]) assert.throws(() => createStoredZip([{ name, bytes: Buffer.alloc(0) }]));
  assert.throws(() => createStoredZip([entries[0], entries[0]]));
  assert.throws(() => createStoredZip(Array(65536).fill(entries[0])));
  assert.throws(() => createStoredZip(entries, new Date('invalid')));
});
test('candidate history includes earlier baselines, valid legacy reports and bounded newest records without writes', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  assert.deepEqual(listCandidates(compareIdentity(project), f.options), { ...compareIdentity(project), candidates: [], skipped: 0 });
  const first = exportEditedProject(project, f.options), second = exportEditedProject(project, f.options);
  fs.unlinkSync(path.join(second.candidateDir, 'review-manifest.json'));
  const next = createSyncProject({ ...f.options, mapName: 'fixture' });
  const third = exportEditedProject(next.project, f.options), input = compareIdentity(next.project);
  const bad = path.join(f.options.outputRoot, 'fixture-' + crypto.randomUUID()); fs.mkdirSync(bad); fs.writeFileSync(path.join(bad, 'review-manifest.json'), '{broken');
  const unrelated = path.join(f.options.outputRoot, 'another-' + crypto.randomUUID()); fs.mkdirSync(unrelated);
  const before = fileTreeHashes(f.temp), result = readWithoutWrites(() => listCandidates(input, f.options));
  assert.deepEqual(fileTreeHashes(f.temp), before); assert.equal(result.skipped, 1); assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates[0].candidateId, third.candidateId);
  const old = result.candidates.find(c => c.candidateId === first.candidateId), legacy = result.candidates.find(c => c.candidateId === second.candidateId);
  assert.equal(old.sameBaseline, false); assert.equal(old.reviewAvailable, true); assert.equal(legacy.reviewAvailable, false);
  assert.equal(result.candidates[0].sameBaseline, true); assert.ok(result.candidates.every(c => !Object.hasOwn(c, 'status')));
  // The history is metadata only: a missing apply file remains visible but cannot be downloaded.
  fs.unlinkSync(third.mapPath); assert.equal(listCandidates(input, f.options).candidates.length, 3);
  assert.throws(() => packageCandidate(reviewInput(third, next.project), f.options), e => e.code === 'CANDIDATE_BLOCKED' && e.review.status === 'blocked');
  const report = JSON.parse(fs.readFileSync(path.join(second.candidateDir, 'report.json'), 'utf8'));
  for (let i = 0; i < 103; i++) {
    const candidateId = crypto.randomUUID(), dir = path.join(f.options.outputRoot, 'fixture-' + candidateId);
    fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ ...report, candidateId, createdAt: new Date(Date.UTC(2040, 0, 1, 0, 0, i)).toISOString() }));
  }
  const bounded = listCandidates(input, f.options); assert.equal(bounded.candidates.length, 100); assert.equal(bounded.skipped, 1);
  assert.equal(bounded.candidates[0].createdAt, new Date(Date.UTC(2040, 0, 1, 0, 0, 102)).toISOString());
});
test('candidate package contains only exact apply files and review text, preserving all source and candidate files', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  project.blocked.push([1, 1]); const output = exportEditedProject(project, f.options);
  const before = fileTreeHashes(f.temp), packaged = readWithoutWrites(() => packageCandidate(reviewInput(output, project), f.options));
  assert.deepEqual(fileTreeHashes(f.temp), before); assert.equal(packaged.filename, 'fixture-' + output.candidateId + '.zip'); assert.equal(packaged.review.status, 'ready');
  const entries = unzipStored(packaged.bytes);
  assert.deepEqual([...entries.keys()], [...output.report.applyFiles, 'REVIEW.txt']);
  for (const relative of output.report.applyFiles) assert.deepEqual(entries.get(relative), fs.readFileSync(path.join(output.candidateDir, relative)));
  const note = entries.get('REVIEW.txt').toString('utf8');
  assert.match(note, /gameApplied: false/); assert.match(note, /runtimeVerified: false/); assert.ok(note.includes(output.candidateId));
  for (const row of packaged.review.files) assert.ok(note.includes(row.candidateSha256) && note.includes(row.sourceSha256));
  assert.ok([...entries.keys()].every(name => !name.startsWith('reference/') && !name.includes('editor-project') && !name.includes('manifest')));
});
test('candidate package rejects stale sources, corrupt or missing apply files and missing review metadata', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  project.blocked.push([1, 1]); const output = exportEditedProject(project, f.options), input = reviewInput(output, project);
  for (const file of [output.mapPath, path.join(output.candidateDir, f.walkRelative), f.walkPath, f.mapPath, path.join(output.candidateDir, 'editor-project.json')]) {
    const original = fs.readFileSync(file); fs.appendFileSync(file, '\r\nmodified');
    assert.throws(() => packageCandidate(input, f.options), e => e.code === 'CANDIDATE_BLOCKED' && e.status === 409 && e.review.status === 'blocked');
    fs.writeFileSync(file, original);
  }
  fs.unlinkSync(output.mapPath);
  assert.throws(() => packageCandidate(input, f.options), e => e.code === 'CANDIDATE_BLOCKED');
  fs.writeFileSync(output.mapPath, fs.readFileSync(f.mapPath)); fs.unlinkSync(path.join(output.candidateDir, 'review-manifest.json'));
  assert.throws(() => packageCandidate(input, f.options));
});
test('history and packaging refuse traversal, links, malformed metadata and oversized candidate data', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const output = exportEditedProject(project, f.options), input = reviewInput(output, project);
  assert.throws(() => listCandidates({ mapName: '../fixture', baselineId: input.baselineId }, f.options));
  assert.throws(() => packageCandidate({ ...input, candidateId: '../escape' }, f.options));
  assert.throws(() => packageCandidate(input, { ...f.options, outputRoot: f.root }), /게임/);
  const metadataPath = path.join(output.candidateDir, 'review-manifest.json'), metadata = fs.readFileSync(metadataPath);
  fs.writeFileSync(metadataPath, 'null'); assert.equal(listCandidates(compareIdentity(project), f.options).skipped, 1); fs.writeFileSync(metadataPath, metadata);
  const linkDir = path.join(f.options.outputRoot, 'fixture-' + crypto.randomUUID()); fs.symlinkSync(f.root, linkDir, 'junction');
  assert.equal(listCandidates(compareIdentity(project), f.options).skipped, 1);
  fs.symlinkSync(f.root, path.join(output.candidateDir, 'linked-game'), 'junction');
  assert.throws(() => packageCandidate(input, f.options), e => e.code === 'UNSAFE_CANDIDATE'); fs.unlinkSync(path.join(output.candidateDir, 'linked-game'));
  const tooBig = path.join(output.candidateDir, 'large.bin'); fs.writeFileSync(tooBig, ''); fs.truncateSync(tooBig, 128 * 1024 * 1024 + 1);
  const originalRead = fs.readFileSync; fs.readFileSync = function(file, ...args) { assert.notEqual(path.resolve(String(file)), path.resolve(tooBig), 'must reject size before reading'); return originalRead.call(this, file, ...args); };
  try { assert.throws(() => packageCandidate(input, f.options), e => e.code === 'CANDIDATE_BLOCKED' && e.status === 409); } finally { fs.readFileSync = originalRead; }
});
test('packaging rechecks sources and metadata after reading the ZIP byte snapshot', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  project.blocked.push([1, 1]); const output = exportEditedProject(project, f.options), input = reviewInput(output, project);
  const metadataPath = path.join(output.candidateDir, 'review-manifest.json');
  for (const target of [f.walkPath, metadataPath]) {
    const source = fs.readFileSync(target), originalRead = fs.readFileSync; let mapReads = 0;
    fs.readFileSync = function(file, ...args) {
      const value = originalRead.call(this, file, ...args);
      // First review reads the map twice, then package reads its captured bytes.
      if (path.resolve(String(file)) === path.resolve(output.mapPath) && ++mapReads === 3) fs.appendFileSync(target, '\r\n');
      return value;
    };
    try { assert.throws(() => packageCandidate(input, f.options), e => e.code === 'CANDIDATE_BLOCKED'); } finally { fs.readFileSync = originalRead; fs.writeFileSync(target, source); }
  }
});

test('applied DT_Walk source size is checked before review allocates its bytes', fixtureOptions, t => {
  const f = objectFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  project.blocked.push([1, 1]); const output = exportEditedProject(project, f.options);
  fs.truncateSync(f.walkPath, 128 * 1024 * 1024 + 1);
  const read = fs.readFileSync;
  fs.readFileSync = function(file, ...args) {
    assert.notEqual(path.resolve(String(file)), path.resolve(f.walkPath), 'oversized walk source must not be read');
    return read.call(this, file, ...args);
  };
  try { assert.throws(() => packageCandidate(reviewInput(output, project), f.options), error => error.code === 'CANDIDATE_BLOCKED' && error.status === 409); }
  finally { fs.readFileSync = read; }
});


function npcFixture(t) {
  const f = objectFixture(t), npcDir = 'RootDesk/MyDesk/DataSet/npc/';
  const csv = {
    'RootDesk/MyDesk/DataSet/quest/DT_QuestSequence.csv': 'SequenceGroupID,SequenceOrder\r\n100,1\r\n200,1\r\n30100,1\r\n300,1\r\n',
    [npcDir + 'DT_NpcSpawn.csv']: '\ufeffNpcSpawnID,MapName,NpcClassID,CellX,CellY,Enabled,Scale,FlipX,DialogID,#Note\r\nfixture_N1,fixture,101,1,1,True,0.875,True,100,"keep, quoted"\r\nfixture_N2,fixture,102,2,1,True,1,,200,\nother_N1,other,103,1,1,True,1,False,,last',
    [npcDir + 'DT_NpcClass.csv']: 'NpcClassID,#DevName,NpcName,NpcAppearanceID,BodyScale\r\n101,First,NAME1,9101,1.2\r\n102,Second,NAME2,9102,1\r\n103,Third,NAME3,9103,1.4\r\n',
    [npcDir + 'DT_NpcAppearance.csv']: 'NpcAppearanceID,Action,BaseDir,Ruid,FootPx\r\n9101,Idle,NE,,\r\n9101,Idle,SE,11111111111111111111111111111111,\r\n9102,Idle,SE,22222222222222222222222222222222,\r\n9103,Idle,SE,33333333333333333333333333333333,\r\n',
    'RootDesk/MyDesk/DataSet/locale/ST_NpcName.csv': 'Key,Source,Note,ko\r\nNAME1,First,,첫 NPC\r\nNAME2,Second,,둘째\r\nNAME3,Third,,셋째\r\n'
  };
  for (const [relative, text] of Object.entries(csv)) { const file = path.join(f.root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
  return { ...f, npcSpawnRelative: npcDir + 'DT_NpcSpawn.csv', npcSpawn: path.join(f.root, npcDir + 'DT_NpcSpawn.csv'), npcClass: path.join(f.root, npcDir + 'DT_NpcClass.csv'), npcAppearance: path.join(f.root, npcDir + 'DT_NpcAppearance.csv') };
}
const npcPatch = (updated = [], removed = [], added = []) => ({ version: 1, updated, removed, added });
test('NPC snapshot preview resolves name/Idle/body scale/flip at game coordinates without writing native entities', fixtureOptions, t => {
  const f = npcFixture(t), source = fileTreeHashes(f.root), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const scene = readWithoutWrites(() => previewEditedProject(project, f.options));
  assert.equal(scene.npcs.length, 2); assert.equal(scene.npcCatalog.length, 3); assert.equal(scene.npcEdits, null); assert.equal(scene.npcSource.stale, false);
  const npc = scene.npcs.find(n => n.entityId === 'fixture_N1'), sprite = scene.sprites.find(s => s.npcEntityId === npc.entityId);
  assert.equal(npc.name, '첫 NPC'); assert.equal(npc.ruid, '1'.repeat(32)); assert.equal(npc.bodyScale, 1.2); assert.equal(npc.flipX, true);
  assert.deepEqual(npc.cell, [1, 1]); assert.deepEqual(npc.position, [0, 17.92, 17.92 * 0.21875]); assert.deepEqual(sprite.scale, [1.2, 1.2]);
  const output = exportEditedProject(project, f.options); assert.equal(output.report.exactMapBytes, true); assert.deepEqual(output.report.applyFiles, ['map/fixture.map']);
  assert.deepEqual(output.report.npcChanges, { moved: 0, added: 0, removed: 0, updated: 0 });
  assert.equal(f.MapBuilder.read(output.mapPath).listEntities().some(e => e.name.startsWith('NpcPreview')), false);
  assert.deepEqual(fileTreeHashes(f.root), source);
});
test('NPC move/add/delete/flip/dialog emit only current-map CSV changes and exact original map; review and ZIP include NPC CSV', fixtureOptions, t => {
  const f = npcFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' }), original = structuredClone(project), id = crypto.randomUUID();
  project.gameNpcEdits = npcPatch([{ entityId: 'fixture_N1', cell: [3, 1], flipX: false, dialogId: '30100' }], ['fixture_N2'], [{ entityId: id, npcClassId: 103, cell: [2, 1], flipX: true, dialogId: '' }]);
  project.blocked.push([0, 0]);
  const before = fileTreeHashes(f.root), compared = compareEditedProject(project, f.options), out = exportEditedProject(project, f.options);
  assert.deepEqual(compared.comparison.npcs.moved.map(n => n.entityId), ['fixture_N1']); assert.equal(compared.comparison.npcs.updated.length, 1);
  assert.deepEqual(out.report.npcChanges, { moved: 1, added: 1, removed: 1, updated: 1 }); assert.equal(out.report.exactMapBytes, true);
  assert.deepEqual(out.report.applyFiles, ['map/fixture.map', f.walkRelative, f.npcSpawnRelative]);
  const parse = require('./npcs.cjs').spawnRows, sourceRows = parse(fs.readFileSync(f.npcSpawn)), rows = parse(fs.readFileSync(path.join(out.candidateDir, f.npcSpawnRelative)));
  assert.equal(rows.rows.find(r => r.spawnId === 'other_N1').raw, sourceRows.rows.find(r => r.spawnId === 'other_N1').raw);
  const changed = rows.rows.find(r => r.spawnId === 'fixture_N1'); assert.equal(changed.data.Scale, '0.875'); assert.equal(changed.data['#Note'], 'keep, quoted'); assert.equal(changed.data.DialogID, '30100');
  assert.ok(rows.rows.some(r => r.spawnId === 'fixture_Editor_' + id));
  const review = reviewCandidate(reviewInput(out, project), f.options); assert.equal(review.status, 'ready'); assert.equal(review.summary.npcsMoved, 1); assert.equal(review.summary.npcsUpdated, 1);
  assert.deepEqual([...unzipStored(packageCandidate(reviewInput(out, project), f.options).bytes).keys()], [...out.report.applyFiles, 'REVIEW.txt']);
  const undo = exportEditedProject(original, f.options); assert.equal(undo.report.unchanged, true); assert.equal(undo.report.exactMapBytes, true); assert.deepEqual(fileTreeHashes(f.root), before);
});
test('NPC no-op patches echo requested edits but retain original map and all CSV bytes', fixtureOptions, t => {
  const f = npcFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  project.gameNpcEdits = npcPatch([{ entityId: 'fixture_N1', cell: [1, 1], flipX: true, dialogId: '100' }]);
  const scene = previewEditedProject(project, f.options); assert.deepEqual(scene.npcEdits, project.gameNpcEdits);
  const out = exportEditedProject(project, f.options); assert.equal(out.report.unchanged, true); assert.equal(out.report.exactMapBytes, true); assert.equal(out.report.applyFiles.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(out.candidateDir, 'reference', f.npcSpawnRelative)), fs.readFileSync(f.npcSpawn));
});
test('NPC changed current-map rows/class/appearance are stale; other-map latest rows merge and whole applied CSV is reviewed', fixtureOptions, t => {
  const f = npcFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' }); project.gameNpcEdits = npcPatch([{ entityId: 'fixture_N1', cell: [3, 1] }]);
  const spawn = fs.readFileSync(f.npcSpawn, 'utf8'); fs.writeFileSync(f.npcSpawn, spawn.replace('other_N1,other,103,1,1', 'other_N1,other,103,4,4'));
  assert.equal(previewEditedProject(project, f.options).npcSource.stale, false);
  const out = exportEditedProject(project, f.options); assert.match(fs.readFileSync(path.join(out.candidateDir, f.npcSpawnRelative), 'utf8'), /other_N1,other,103,4,4/);
  fs.appendFileSync(f.npcSpawn, '\r\nother_N2,other,102,5,5,True,1,,,'); assert.equal(reviewCandidate(reviewInput(out, project), f.options).status, 'blocked'); fs.writeFileSync(f.npcSpawn, spawn);
  for (const file of [f.npcSpawn, f.npcClass, f.npcAppearance]) {
    const bytes = fs.readFileSync(file); fs.writeFileSync(file, file === f.npcSpawn ? spawn.replace('fixture_N1,fixture,101,1,1', 'fixture_N1,fixture,101,4,1') : bytes.toString().replace(file === f.npcClass ? ',1.2' : '11111111111111111111111111111111', file === f.npcClass ? ',1.3' : '44444444444444444444444444444444'));
    assert.equal(previewEditedProject(project, f.options).npcSource.stale, true); assert.throws(() => exportEditedProject(project, f.options), e => e.code === 'STALE_NPC_SOURCE'); fs.writeFileSync(file, bytes);
  }
});
test('NPC-only refresh preserves existing ground/object/blocked drafts and original baseline while binding a new immutable NPC source', fixtureOptions, t => {
  const f = npcFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  project.ground[0][2] = project.palette.findIndex(p => p.ruid === tile('물').ruid); project.blocked.push([0, 0]);
  const object = previewEditedProject(project, f.options).objects.find(o => o.canMove); project.gameObjectEdits = objectPatch([{ entityId: object.entityId, position: [object.position[0] + 1.28, object.position[1] - 0.64] }]);
  project.gameNpcEdits = npcPatch([{ entityId: 'fixture_N1', cell: [3, 1] }]); const before = structuredClone(project), baselineBefore = fileTreeHashes(path.join(f.options.baselineRoot, project.gameSync.baselineId));
  fs.writeFileSync(f.npcClass, fs.readFileSync(f.npcClass, 'utf8').replace(',1.2', ',1.3'));
  const fresh = refreshNpcProject(project, f.options); assert.deepEqual(project, before); assert.equal(fresh.project.gameNpcEdits, undefined); assert.match(fresh.project.gameNpcSync.sourceId, /^[a-f0-9-]{36}$/);
  for (const field of ['ground', 'gameObjectEdits', 'blocked', 'entities', 'gameSync']) assert.deepEqual(fresh.project[field], project[field]);
  assert.equal(fresh.scene.npcs[0].bodyScale, 1.3); assert.equal(fresh.scene.npcSource.stale, false);
  const baseline = previewBaselineProject({ ...compareIdentity(project), npcSourceId: fresh.project.gameNpcSync.sourceId }, f.options); assert.equal(baseline.scene.npcs[0].bodyScale, 1.3);
  assert.deepEqual(fileTreeHashes(path.join(f.options.baselineRoot, project.gameSync.baselineId)), baselineBefore);
  const foreign = createSyncProject({ ...f.options, mapName: 'fixture' }).project; foreign.gameNpcSync = fresh.project.gameNpcSync;
  assert.throws(() => previewEditedProject(foreign, f.options), e => e.code === 'NPC_SOURCE_MISMATCH');
  const sourceDir = path.join(f.options.baselineRoot, 'npc-' + fresh.project.gameNpcSync.sourceId); fs.appendFileSync(path.join(sourceDir, 'snapshot', 'RootDesk/MyDesk/DataSet/npc/DT_NpcClass.csv'), '\n');
  assert.throws(() => previewEditedProject(fresh.project, f.options), e => e.code === 'NPC_SOURCE_CORRUPT');
});
test('NPC edits reject new occupancy conflicts, duplicate IDs, unknown classes and bounds; blocked placement is warned per runtime contract', fixtureOptions, t => {
  const f = npcFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  for (const edit of [npcPatch([{ entityId: 'fixture_N1', cell: [2, 1] }]), npcPatch([{ entityId: 'fixture_N1', cell: [-1, 1] }]), npcPatch([{ entityId: 'fixture_N1', cell: [8, 1] }]), npcPatch([{ entityId: 'fixture_N1', cell: [1.5, 1] }]), npcPatch([{ entityId: 'fixture_N1', flipX: true }], ['fixture_N1']), npcPatch([], [], [{ entityId: crypto.randomUUID(), npcClassId: 999, cell: [3, 1], flipX: false, dialogId: '' }])]) {
    assert.throws(() => previewEditedProject({ ...project, gameNpcEdits: edit }, f.options), e => ['INVALID_NPC_EDIT', 'NPC_OCCUPIED'].includes(e.code));
  }
  const scene = previewEditedProject({ ...project, gameNpcEdits: npcPatch([{ entityId: 'fixture_N1', cell: [2, 2] }]) }, f.options); assert.ok(scene.warnings.some(w => w.includes('이동불가')));
});

test('NPC source refresh rejects linked storage and tampered pointers without overwriting any original snapshot', fixtureOptions, t => {
  const f = npcFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const sourceBefore = fileTreeHashes(f.root), fresh = refreshNpcProject(project, f.options);
  assert.throws(() => previewEditedProject({ ...project, gameNpcSync: { version: 1, sourceId: '../escape' } }, f.options), e => e.code === 'INVALID_NPC_SOURCE');
  const id = crypto.randomUUID(); fs.symlinkSync(f.root, path.join(f.options.baselineRoot, 'npc-' + id), 'junction');
  assert.throws(() => previewEditedProject({ ...project, gameNpcSync: { version: 1, sourceId: id } }, f.options), e => e.code === 'UNSAFE_CANDIDATE');
  const manifestPath = path.join(f.options.baselineRoot, 'npc-' + fresh.project.gameNpcSync.sourceId, 'manifest.json'), data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  data.mapName = 'another'; fs.writeFileSync(manifestPath, JSON.stringify(data));
  assert.throws(() => previewEditedProject(fresh.project, f.options), e => e.code === 'NPC_SOURCE_MISMATCH');
  assert.deepEqual(fileTreeHashes(f.root), sourceBefore);
});
test('NPC output review blocks appearance drift even during the final inspection; legacy candidates still review', fixtureOptions, t => {
  const f = npcFixture(t), { project } = createSyncProject({ ...f.options, mapName: 'fixture' });
  const legacy = exportEditedProject(project, f.options);
  project.gameNpcEdits = npcPatch([{ entityId: 'fixture_N1', flipX: false }]); const out = exportEditedProject(project, f.options), input = reviewInput(out, project);
  const bytes = fs.readFileSync(f.npcAppearance), changed = Buffer.from(bytes.toString().replace('1'.repeat(32), '4'.repeat(32)));
  fs.writeFileSync(f.npcAppearance, changed); assert.equal(reviewCandidate(input, f.options).status, 'blocked');
  assert.equal(reviewCandidate(reviewInput(legacy, project), f.options).status, 'ready'); fs.writeFileSync(f.npcAppearance, bytes);
  const read = fs.readFileSync; let switched = false;
  fs.readFileSync = function(file, ...args) {
    const value = read.call(this, file, ...args);
    if (!switched && path.resolve(String(file)) === path.resolve(path.join(out.candidateDir, 'reference', 'RootDesk/MyDesk/DataSet/npc/DT_NpcAppearance.csv'))) { switched = true; fs.writeFileSync(f.npcAppearance, changed); }
    return value;
  };
  try { assert.equal(reviewCandidate(input, f.options).status, 'blocked'); assert.equal(switched, true); }
  finally { fs.readFileSync = read; fs.writeFileSync(f.npcAppearance, bytes); }
});
test('NPC candidate parser preserves reordered columns, BOM, quotes, unchanged same-map records and other-map line endings', () => {
  const npc = require('./npcs.cjs'), spawn = Buffer.from('\ufeffMapName,NpcSpawnID,CellY,NpcClassID,CellX,Enabled,Scale,DialogID,FlipX,#Note\r\nother,other_id,1,101,1,True,1,,False,"A,B"\nfixture,keep,1,101,1,True,0.875,100,True,keep\r\nfixture,edit,1,101,2,True,1,,False,last');
  const files = { DT_NpcSpawn: { relative: 'RootDesk/MyDesk/DataSet/npc/DT_NpcSpawn.csv', bytes: spawn },
    DT_NpcClass: { bytes: Buffer.from('NpcClassID,NpcName,NpcAppearanceID,BodyScale\n101,A,9101,1.2\n') },
    DT_NpcAppearance: { bytes: Buffer.from('NpcAppearanceID,Action,BaseDir,Ruid\n9101,Idle,SE,' + '1'.repeat(32) + '\n') } };
  const profile = npc.analyzeNpcs(files, 'fixture'), project = { size: [8,8], blocked: [], ground: [], gameNpcEdits: npcPatch([{ entityId: 'edit', cell: [3,1] }], [], [{ entityId: crypto.randomUUID(), npcClassId: 101, cell:[4,1], flipX:false, dialogId:'' }]) };
  const edits = npc.inspectNpcs(project, profile, { ORIGIN_X:15,ORIGIN_Y:15,TILE_W:2.56,TILE_H:1.28,DEPTH_SCALE:0.21875 });
  const result = npc.buildNpcCandidate(spawn, edits), before = npc.spawnRows(spawn), after = npc.spawnRows(result.bytes);
  for (const id of ['keep','other_id']) assert.equal(after.rows.find(r=>r.spawnId===id).raw, before.rows.find(r=>r.spawnId===id).raw);
  assert.equal(result.bytes.toString().charCodeAt(0), 0xfeff); assert.equal(after.rows.find(r=>r.spawnId==='edit').cell[0],3);
});

function runtimeFixture(t) {
  const f=npcFixture(t), files={
    'actor/DT_MonsterSpawn.csv':'\ufeffMonsterSpawnID,MapName,MonsterClassID,CellX,CellY,Count,Spread,RespawnMinSec,RespawnMaxSec,FirstSpawnSec,Enabled,Scale,FlipX,#Note\r\nM1,fixture,201,3,3,2,1,3,0,0,True,0.3,True,"keep, original"\r\nM2,fixture,201,4,4,1,2,0,0,1,False,,,\nM_other,other,201,2,2,1,0,1,2,0,True,,,last',
    'actor/DT_MonsterClass.csv':'MonsterClassID,#DevName,MonsterName,MonsterAppearanceID,ModelID,BodyScale,BodyTint\r\n201,Monster,MONSTER1,9201,monster01,1.5,\r\n',
    'actor/DT_MonsterAppearance.csv':'MonsterAppearanceID,Action,BaseDir,Ruid\r\n9201,Idle,SE,44444444444444444444444444444444\r\n',
    'locale/ST_MonsterName.csv':'Key,Source,ko\r\nMONSTER1,Monster,몬스터\r\n',
    'world/DT_Portal.csv':'\ufeffPortalID,SrcMap,SrcX,SrcY,DestMap,DestX,DestY,DestFacing,Enabled,#Note\r\nP1,fixture,5,5,other,2,3,SE,True,"keep, portal"\r\nP2,fixture,6,5,other,3,3,NW,False,\nP_other,other,1,2,fixture,3,3,SE,True,last',
    'world/DT_Bounds.csv':'MapName,MinX,MaxX,MinY,MaxY,CenterX,CenterY,SpawnX,SpawnY\r\nfixture,0,7,0,7,4,4,3,6\r\nother,0,7,0,7,4,4,2,2\r\n',
    'config/DT_GameConfig.csv':'ConfigKey,ConfigValue,#Desc\r\nPortalSpriteRuid,55555555555555555555555555555555,portal\r\n'
  };
  for(const [relative,raw] of Object.entries(files)){const file=path.join(f.root,'RootDesk/MyDesk/DataSet',relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,raw.replaceAll('\\r','\r').replaceAll('\\n','\n').replaceAll('\\ufeff','\ufeff'));}
  return {...f,runtimeFile:name=>path.join(f.root,'RootDesk/MyDesk/DataSet',Object.keys(files).find(k=>k.endsWith('/'+name+'.csv')))};
}
const runtimePatch=(updated=[],removed=[],added=[])=>({version:1,updated,removed,added});
function mixedRuntime(project){
  project.gameMonsterEdits=runtimePatch([{entityId:'M1',cell:[4,3],count:3,respawnMinSec:5}],['M2'],[{entityId:crypto.randomUUID(),monsterClassId:201,cell:[4,4],count:1,spread:0,respawnMinSec:0,respawnMaxSec:0,firstSpawnSec:0,enabled:true}]);
  project.gamePortalEdits=runtimePatch([{entityId:'P1',cell:[5,6],destFacing:'NE'}],['P2'],[{entityId:crypto.randomUUID(),cell:[6,6],destMap:'other',destCell:[2,3],destFacing:'SW',enabled:true}]);
  project.gameSpawnEdits={version:1,cell:[3,7]};
  return project;
}
test('runtime no-op resolves authoritative visuals and startpoint without native map spawns',fixtureOptions,t=>{
 const f=runtimeFixture(t),{project}=createSyncProject({...f.options,mapName:'fixture'}),before=fileTreeHashes(f.root),scene=previewEditedProject(project,f.options);
 assert.equal(scene.monsters.length,2);assert.equal(scene.monsters[0].name,'몬스터');assert.equal(scene.monsters[0].bodyScale,1.5);assert.equal(scene.sprites.find(s=>s.monsterEntityId==='M1').flipX,false);
 assert.equal(scene.portals.length,2);assert.deepEqual(scene.spawn.cell,[3,6]);assert.equal(scene.runtimeSource.stale,false);
 project.gameMonsterEdits=runtimePatch([{entityId:'M1',cell:[3,3],count:2}]);project.gamePortalEdits=runtimePatch([{entityId:'P1',destFacing:'SE'}]);project.gameSpawnEdits={version:1,cell:[3,6]};
 const c=exportEditedProject(project,f.options);assert.equal(c.report.unchanged,true);assert.equal(c.report.exactMapBytes,true);assert.deepEqual(c.report.applyFiles,['map/fixture.map']);assert.deepEqual(fileTreeHashes(f.root),before);
});
test('runtime mixed edits surgically preserve raw rows and unused columns, review and ZIP include all five CSV types',fixtureOptions,t=>{
 const f=runtimeFixture(t),{project}=createSyncProject({...f.options,mapName:'fixture'}),before=fileTreeHashes(f.root);mixedRuntime(project);project.gameNpcEdits=npcPatch([{entityId:'fixture_N1',dialogId:'300'}]);project.blocked.push([0,0]);
 const compared=compareEditedProject(project,f.options);assert.equal(compared.comparison.monsters.moved.length,1);assert.equal(compared.comparison.portals.added.length,1);assert.ok(compared.comparison.spawn);
 const c=exportEditedProject(project,f.options);assert.equal(c.report.applyFiles.length,6);assert.equal(c.report.exactMapBytes,true);assert.equal(c.report.monsterChanges.updated,1);assert.equal(c.report.portalChanges.updated,1);
 const monster=fs.readFileSync(path.join(c.candidateDir,'RootDesk/MyDesk/DataSet/actor/DT_MonsterSpawn.csv'),'utf8');assert.ok(monster.startsWith('\ufeff'));assert.ok(monster.includes('5,0,0,True,0.3,True,"keep, original"'));assert.ok(monster.endsWith('M_other,other,201,2,2,1,0,1,2,0,True,,,last'));
 const identity={candidateId:c.candidateId,mapName:'fixture',baselineId:project.gameSync.baselineId};const review=reviewCandidate(identity,f.options);assert.equal(review.status,'ready',review.issues.join('\n'));assert.equal(review.summary.spawnChanged,1);assert.equal(review.summary.monstersMoved,1);assert.equal(packageCandidate(identity,f.options).bytes.readUInt32LE(0),0x04034b50);assert.equal(listCandidates(identity,f.options).candidates[0].applyFileCount,6);assert.deepEqual(fileTreeHashes(f.root),before);
});
test('runtime target drift blocks while newer other-map rows merge, and applied CSV is wholly guarded at review',fixtureOptions,t=>{
 const f=runtimeFixture(t),{project}=createSyncProject({...f.options,mapName:'fixture'});mixedRuntime(project);
 for(const [name,a,b] of [['DT_MonsterSpawn','M_other,other,201,2,2,1,','M_other,other,201,2,2,4,'],['DT_Portal','P_other,other,1,2,fixture,3,3,','P_other,other,1,2,fixture,4,3,'],['DT_Bounds','other,0,7,0,7,4,4,2,2','other,0,7,0,7,4,4,3,2']]){const file=f.runtimeFile(name);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(a,b));}
 const c=exportEditedProject(project,f.options),identity={candidateId:c.candidateId,mapName:'fixture',baselineId:project.gameSync.baselineId};assert.equal(reviewCandidate(identity,f.options).status,'ready');fs.appendFileSync(f.runtimeFile('DT_Portal'),'\r\n');assert.equal(reviewCandidate(identity,f.options).status,'blocked');
 fs.writeFileSync(f.runtimeFile('DT_MonsterSpawn'),fs.readFileSync(f.runtimeFile('DT_MonsterSpawn'),'utf8').replace('M1,fixture,201,3,3,2,','M1,fixture,201,3,3,4,'));assert.throws(()=>exportEditedProject(project,f.options),e=>e.code==='STALE_RUNTIME_SOURCE');
});
test('runtime refresh resets only its overlays and binds immutable sources to the same baseline',fixtureOptions,t=>{
 const f=runtimeFixture(t),{project}=createSyncProject({...f.options,mapName:'fixture'});mixedRuntime(project);project.gameNpcEdits=npcPatch([{entityId:'fixture_N1',dialogId:'300'}]);project.blocked.push([0,0]);project.ground[0][2]=project.palette.findIndex(p=>p.ruid===tile('물').ruid);const before=structuredClone(project),snapshot=fileTreeHashes(path.join(f.options.baselineRoot,project.gameSync.baselineId));
 fs.writeFileSync(f.runtimeFile('DT_MonsterClass'),fs.readFileSync(f.runtimeFile('DT_MonsterClass'),'utf8').replace('1.5','1.6'));const fresh=refreshRuntimeProject(project,f.options);assert.deepEqual(project,before);for(const k of ['gameMonsterEdits','gamePortalEdits','gameSpawnEdits'])assert.equal(fresh.project[k],undefined);for(const k of ['gameNpcEdits','ground','blocked','entities','gameSync'])assert.deepEqual(fresh.project[k],before[k]);assert.equal(fresh.scene.monsters[0].bodyScale,1.6);assert.equal(fresh.scene.runtimeSource.stale,false);
 assert.equal(previewBaselineProject({...compareIdentity(project),runtimeSourceId:fresh.project.gameRuntimeSync.sourceId},f.options).scene.monsters[0].bodyScale,1.6);assert.deepEqual(fileTreeHashes(path.join(f.options.baselineRoot,project.gameSync.baselineId)),snapshot);
 const foreign=createSyncProject({...f.options,mapName:'fixture'}).project;foreign.gameRuntimeSync=fresh.project.gameRuntimeSync;assert.throws(()=>previewEditedProject(foreign,f.options),e=>e.code==='RUNTIME_SOURCE_MISMATCH');
 const snapshotFile=path.join(f.options.baselineRoot,'runtime-'+fresh.project.gameRuntimeSync.sourceId,'snapshot/RootDesk/MyDesk/DataSet/actor/DT_MonsterClass.csv');fs.appendFileSync(snapshotFile,'\n');assert.throws(()=>previewEditedProject(fresh.project,f.options),e=>e.code==='RUNTIME_SOURCE_CORRUPT');
});
test('runtime new placements enforce occupancy, bounds, walkability and strict fields while preserving original blocked rows',fixtureOptions,t=>{
 const f=runtimeFixture(t),{project}=createSyncProject({...f.options,mapName:'fixture'});const check=(field,value,code)=>{const p=structuredClone(project);p[field]=value;assert.throws(()=>previewEditedProject(p,f.options),e=>e.code===code);};
 check('gameSpawnEdits',{version:1,cell:[2,2]},'BLOCKED_SPAWN');check('gameSpawnEdits',{version:1,cell:[1,1]},'OCCUPIED_SPAWN');check('gameSpawnEdits',{version:1,cell:[8,1]},'INVALID_RUNTIME_EDIT');
 check('gamePortalEdits',runtimePatch([{entityId:'P1',cell:[2,2]}]),'BLOCKED_PORTAL');check('gamePortalEdits',runtimePatch([{entityId:'P2',cell:[5,5],enabled:true}]),'PORTAL_OCCUPIED');check('gamePortalEdits',runtimePatch([{entityId:'P1',destMap:'missing'}]),'INVALID_RUNTIME_EDIT');
 check('gameMonsterEdits',runtimePatch([{entityId:'M1',cell:[2,2],spread:0}]),'NO_MONSTER_CELLS');check('gameMonsterEdits',runtimePatch([{entityId:'M1',count:201}]),'INVALID_RUNTIME_EDIT');check('gameMonsterEdits',runtimePatch([{entityId:'M1',flipX:true}]),'INVALID_RUNTIME_EDIT');
 const q=structuredClone(project);q.blocked.push([5,5]);q.gamePortalEdits=runtimePatch([{entityId:'P1',destFacing:'NW'}]);assert.doesNotThrow(()=>previewEditedProject(q,f.options));
});

test('runtime dependencies guard destination walk and bounds while unrelated walk rows stay mergeable',fixtureOptions,t=>{
 const f=runtimeFixture(t),{project}=createSyncProject({...f.options,mapName:'fixture'});project.gamePortalEdits=runtimePatch([{entityId:'P1',destFacing:'NE'}]);
 fs.appendFileSync(f.walkPath,'\r\nunrelated,1,1\r\n');assert.equal(previewEditedProject(project,f.options).runtimeSource.stale,false);assert.doesNotThrow(()=>exportEditedProject(project,f.options));
 fs.appendFileSync(f.walkPath,'other,2,3\r\n');assert.equal(previewEditedProject(project,f.options).runtimeSource.stale,true);assert.throws(()=>exportEditedProject(project,f.options),e=>e.code==='STALE_RUNTIME_SOURCE');
});
test('runtime refresh cannot silently substitute a new current-map walk baseline or follow linked source storage',fixtureOptions,t=>{
 const f=runtimeFixture(t),{project}=createSyncProject({...f.options,mapName:'fixture'}),baseline=path.join(f.options.baselineRoot,project.gameSync.baselineId),before=fileTreeHashes(baseline);
 fs.appendFileSync(f.walkPath,'\r\nfixture,0,0\r\n');assert.throws(()=>refreshRuntimeProject(project,f.options),e=>e.code==='STALE_RUNTIME_WALK');assert.deepEqual(fileTreeHashes(baseline),before);
 fs.writeFileSync(f.walkPath,fs.readFileSync(f.walkPath,'utf8').replace('\r\nfixture,0,0\r\n',''));const fresh=refreshRuntimeProject(project,f.options);const sourceDir=path.join(f.options.baselineRoot,'runtime-'+fresh.project.gameRuntimeSync.sourceId),snapshot=path.join(sourceDir,'snapshot');fs.renameSync(snapshot,path.join(sourceDir,'original-snapshot'));fs.symlinkSync(f.root,snapshot,'junction');assert.throws(()=>previewEditedProject(fresh.project,f.options),e=>e.code==='UNSAFE_CANDIDATE');
});
test('runtime review catches class/config dependency changes and export catches concurrent source writes',fixtureOptions,t=>{
 const f=runtimeFixture(t),{project}=createSyncProject({...f.options,mapName:'fixture'});mixedRuntime(project);const c=exportEditedProject(project,f.options),identity={candidateId:c.candidateId,mapName:'fixture',baselineId:project.gameSync.baselineId};
 const cls=f.runtimeFile('DT_MonsterClass'),old=fs.readFileSync(cls);fs.writeFileSync(cls,old.toString().replace('1.5','1.6'));assert.equal(reviewCandidate(identity,f.options).status,'blocked');fs.writeFileSync(cls,old);
 const write=fs.writeFileSync;let changed=false;fs.writeFileSync=function(file,...args){const out=write.call(fs,file,...args);if(!changed&&String(file).includes('reference')&&String(file).endsWith('DT_MonsterSpawn.csv')){changed=true;write.call(fs,cls,old.toString().replace('1.5','1.6'));}return out;};try{assert.throws(()=>exportEditedProject(project,f.options),e=>e.code==='REFERENCE_CHANGED_DURING_EXPORT');}finally{fs.writeFileSync=write;}assert.equal(changed,true);
});

test('runtime spawn candidates depend on current-map NPC occupancy but not unrelated NPC visuals or other-map rows',fixtureOptions,t=>{
 const f=runtimeFixture(t),{project}=createSyncProject({...f.options,mapName:'fixture'});project.gameSpawnEdits={version:1,cell:[3,7]};
 fs.writeFileSync(f.npcClass,fs.readFileSync(f.npcClass,'utf8').replace('1.2','1.3'));fs.writeFileSync(f.npcSpawn,fs.readFileSync(f.npcSpawn,'utf8').replace('other_N1,other,103,1,1','other_N1,other,103,2,1'));
 const candidate=exportEditedProject(project,f.options),identity={candidateId:candidate.candidateId,mapName:'fixture',baselineId:project.gameSync.baselineId};assert.equal(reviewCandidate(identity,f.options).status,'ready');
 fs.writeFileSync(f.npcSpawn,fs.readFileSync(f.npcSpawn,'utf8').replace('fixture_N1,fixture,101,1,1','fixture_N1,fixture,101,3,7'));assert.throws(()=>exportEditedProject(project,f.options),e=>e.code==='STALE_NPC_SOURCE');assert.equal(reviewCandidate(identity,f.options).status,'blocked');
});
test('runtime CSV surgical patch preserves reordered headers and refuses duplicate latest global IDs',()=>{
 const runtime=require('./runtime.cjs'),bytes=Buffer.from('\ufeffEnabled,#Note,MapName,MonsterSpawnID,MonsterClassID,CellX,CellY,Count,Spread,RespawnMinSec,RespawnMaxSec,FirstSpawnSec,Scale,FlipX\r\nTrue,"quoted, note",fixture,M1,201,1,1,1,0,3,0,0,0.5,True\r\nFalse,last,other,M2,201,3,3,1,0,0,0,0,,');
 const table={relative:'RootDesk/MyDesk/DataSet/actor/DT_MonsterSpawn.csv',bytes};const files={DT_MonsterSpawn:table,DT_MonsterClass:{relative:'class.csv',bytes:Buffer.from('MonsterClassID,MonsterName,MonsterAppearanceID,ModelID,BodyScale\n201,M,1,monster01,1\n')},DT_MonsterAppearance:{relative:'appearance.csv',bytes:Buffer.from('MonsterAppearanceID,Action,BaseDir,Ruid\n1,Idle,SE,11111111111111111111111111111111\n')},DT_Bounds:{relative:'bounds.csv',bytes:Buffer.from('MapName,MinX,MaxX,MinY,MaxY,SpawnX,SpawnY\nfixture,0,7,0,7,1,1\nother,0,7,0,7,1,1\n')},DT_Walk:{relative:'walk.csv',bytes:Buffer.from('MapName,CellX,CellY\n')}};
 const profile=runtime.analyzeRuntime(files,'fixture'),edit=runtime.inspectRuntime({blocked:[],gameMonsterEdits:runtimePatch([{entityId:'M1',count:2}])},profile,{TILE_W:2.56,TILE_H:1.28,ORIGIN_X:15,ORIGIN_Y:15,DEPTH_SCALE:.21875});
 const output=runtime.buildCandidates(edit,files)[0].bytes.toString();assert.ok(output.startsWith('\ufeffEnabled,#Note'));assert.ok(output.includes('True,"quoted, note",fixture,M1,201,1,1,2,0,3,0,0,0.5,True'));assert.ok(output.endsWith('False,last,other,M2,201,3,3,1,0,0,0,0,,'));
 const duplicate={...files,DT_MonsterSpawn:{...table,bytes:Buffer.from(bytes.toString()+'\nFalse,new,other,M2,201,4,4,1,0,0,0,0,,\n')}};assert.throws(()=>runtime.buildCandidates(edit,duplicate),e=>e.code==='UNSUPPORTED_RUNTIME');
});
