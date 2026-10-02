'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSyncProject, inspectSyncProject, exportEditedProject, previewEditedProject, validateStorageRoot, _test } = require('./core.cjs');

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
  for (const [field, value] of [['blocked', []], ['size', [9, 9]], ['entities', []], ['groundOrigin', [1, 0]]]) {
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
  const renderFields = sprite => Object.fromEntries(Object.entries(sprite).filter(([name]) => !['id', 'ground'].includes(name)));
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
