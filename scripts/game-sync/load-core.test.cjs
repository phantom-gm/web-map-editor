'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadGameSyncCore } = require('./load-core.cjs');

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'editor-core-reload-'));
  fs.mkdirSync(path.join(root, 'scripts/game-sync'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/lib'), { recursive: true });
  const entry = path.join(root, 'scripts/game-sync/core.cjs');
  const edits = path.join(root, 'scripts/game-sync/object-edits.cjs');
  const offsets = path.join(root, 'src/lib/offsets.cjs');
  const external = path.join(root, 'external.cjs');
  fs.writeFileSync(entry, "module.exports = { inspect: require('./object-edits.cjs'), external: require('../../external.cjs') };\n");
  fs.writeFileSync(edits, "module.exports = require('../../src/lib/offsets.cjs');\n");
  fs.writeFileSync(offsets, "module.exports = input => { if (input.visualOffsets) throw Error('unsupported edit field'); return 0; };\n");
  fs.writeFileSync(external, 'module.exports = {};\n');
  t.after(() => {
    const local = id => id.startsWith(root + path.sep);
    for (const mod of Object.values(require.cache)) {
      if (mod) mod.children = mod.children.filter(child => !local(child.id));
    }
    for (const id of Object.keys(require.cache).filter(local)) delete require.cache[id];
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('editor-core-reload-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, entry, edits, offsets, external };
}

test('development replaces an already imported compiler and nested edit validators', async t => {
  const f = fixture(t);
  const old = (await import(pathToFileURL(f.entry).href)).default;
  const input = { moved: [1], visualOffsets: [{ offset: [0, 0.04] }] };
  const saved = JSON.stringify(input);
  assert.throws(() => old.inspect(input), /unsupported edit field/);
  fs.writeFileSync(f.offsets, 'module.exports = input => input.visualOffsets[0].offset[1];\n');
  const current = loadGameSyncCore(f.root, { reload: true });
  assert.equal(current.inspect(input), 0.04);
  assert.equal(JSON.stringify(input), saved);
  assert.equal(current.external, old.external, 'external modules stay cached');
  fs.writeFileSync(f.offsets, 'module.exports = input => input.visualOffsets[0].offset[1] * 100;\n');
  const next = loadGameSyncCore(f.root, { reload: true });
  assert.equal(next.inspect(input), 4);
  assert.equal(current.inspect(input), 0.04, 'in-flight users keep a complete module generation');
  const parent = require.cache[f.entry].parent;
  for (let i = 0; i < 4; i++) loadGameSyncCore(f.root, { reload: true });
  assert.equal(parent.children.filter(child => child.id === f.entry).length, 1, 'old module references do not accumulate');
});

test('normal loading retains Node caching outside development', t => {
  const f = fixture(t);
  const first = loadGameSyncCore(f.root);
  fs.writeFileSync(f.offsets, 'module.exports = () => 9;\n');
  assert.equal(loadGameSyncCore(f.root), first);
  assert.equal(loadGameSyncCore(f.root).inspect({}), 0);
  assert.equal(loadGameSyncCore(f.root, { reload: true }).inspect({}), 9);
});

test('a failed load can recover without reusing partially loaded validators', t => {
  const f = fixture(t);
  fs.writeFileSync(f.entry, "require('./object-edits.cjs'); throw Error('build interrupted');\n");
  assert.throws(() => loadGameSyncCore(f.root, { reload: true }), /build interrupted/);
  fs.writeFileSync(f.offsets, 'module.exports = () => 4;\n');
  fs.writeFileSync(f.entry, "module.exports = { inspect: require('./object-edits.cjs') };\n");
  assert.equal(loadGameSyncCore(f.root, { reload: true }).inspect({}), 4);
});
