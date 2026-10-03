'use strict';
// Render-order only: reuse the game's tested runtime mirror without changing map data or edit coordinates.
const fs = require('node:fs');
const path = require('node:path');
function applyActorDepth(scene, mb, root, actors) {
  const sprites = scene.sprites.filter(s => s.npcEntityId || s.monsterEntityId || s.portalEntityId);
  if (!sprites.length) return;
  const source = path.join(root, 'scripts/depth_check.cjs');
  if (!fs.existsSync(source)) { scene.warnings.push('액터 깊이 계산 원본이 없어 NPC·몬스터·포털의 가림 순서는 기본 좌표로 표시합니다.'); return; }
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(source));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('게임 외부의 깊이 계산 파일은 사용할 수 없습니다.');
  delete require.cache[require.resolve(source)];
  const depth = require(source);
  if (!['collectMetas','solvePlayerZ','depthZ','portalZ'].every(key => typeof depth[key] === 'function')) {
    throw new Error('게임 깊이 계산 API가 바뀌었습니다. 에디터 연결을 확인하세요.');
  }
  const metas = depth.collectMetas(mb.listEntities().map(e => mb.find(e.path)));
  const byId = new Map();
  for (const [kind, rows] of Object.entries(actors)) for (const row of rows ?? []) byId.set(kind + ':' + row.entityId, row);
  for (const sprite of sprites) {
    const kind = sprite.npcEntityId ? 'npcs' : sprite.monsterEntityId ? 'monsters' : 'portals';
    const id = sprite.npcEntityId || sprite.monsterEntityId || sprite.portalEntityId;
    const actor = byId.get(kind + ':' + id);
    if (!actor) continue;
    const [x,y] = actor.cell, [wx,wy] = sprite.position;
    const z = kind === 'portals' ? depth.portalZ(metas,x,y).z
      : depth.solvePlayerZ(metas,x,y,depth.depthZ(wy),{x:wx,y:wy}).z;
    if (!Number.isFinite(z)) throw new Error('NPC·몬스터·포털 깊이 계산 결과가 올바르지 않습니다.');
    // Keep descriptor and comparison positions at their logical foot coordinate.
    sprite.position = [wx,wy,z];
  }
}
module.exports = { applyActorDepth };
