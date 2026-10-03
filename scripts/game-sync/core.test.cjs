'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSyncProject, inspectSyncProject, exportEditedProject, previewEditedProject, previewBaselineProject, compareEditedProject, reviewCandidate, validateStorageRoot, _test } = require('./core.cjs');

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
