'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');

// Next does not watch the compiler loaded outside its bundle. In development,
// reload its local dependency graph together so new edit fields are accepted
// without restarting the server. Keep installed packages and game builders cached.
function loadGameSyncCore(editorRoot, { reload = false } = {}) {
  const entry = path.join(editorRoot, 'scripts', 'game-sync', 'core.cjs');
  const requireCore = createRequire(entry);
  if (reload) {
    const roots = ['scripts/game-sync', 'src/lib'].map(dir => path.resolve(editorRoot, dir) + path.sep);
    const local = filename => roots.some(root => filename.startsWith(root));
    // Include partially loaded dependencies after a failed compilation too.
    const stale = new Set(Object.keys(requireCore.cache).filter(id => id !== __filename && local(id)));
    // Removing cache entries alone leaves old instances in parent.children.
    for (const module of Object.values(requireCore.cache)) {
      if (module) module.children = module.children.filter(child => !stale.has(child.id));
    }
    for (const id of stale) delete requireCore.cache[id];
  }
  return requireCore(entry);
}

module.exports = { loadGameSyncCore };
