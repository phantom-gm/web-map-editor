'use strict';
// Shared by project loading and the candidate compiler: one sorting schema.
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function reject() { throw new Error('정렬 설정을 확인하세요. 범위는 정수 칸, 가구 위 소품은 받치는 가구가 필요합니다.'); }
function keys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== expected.sort().join()) reject();
}
function pair(v, check) { return Array.isArray(v) && v.length === 2 && v.every(check); }
function parseObjectSorting(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10000) reject();
  const seen = new Set();
  return value.map(row => {
    keys(row, ['entityId', 'setting']);
    if (!id(row.entityId) || seen.has(row.entityId)) reject();
    seen.add(row.entityId);
    const s = row.setting;
    if (s?.mode === 'wall') keys(s, ['mode']);
    else if (s?.mode === 'surface') {
      keys(s, ['mode', 'supportId']);
      if (!id(s.supportId) || s.supportId === row.entityId) reject();
    } else if (s?.mode === 'floor') {
      keys(s, ['mode', 'offset', 'size', 'bounds', 'padX']);
      if (!pair(s.offset, n => Number.isInteger(n) && Math.abs(n) <= 10000)
        || !pair(s.size, n => Number.isInteger(n) && n >= 1 && n <= 256)
        || !pair(s.bounds, n => Number.isFinite(n) && n > 0 && n <= 10000)
        || !Number.isFinite(s.padX) || s.padX < 0 || s.padX > 100) reject();
    } else reject();
    return JSON.parse(JSON.stringify(row));
  });
}
function objectAnchor(position, constants) {
  return [Math.round(constants.ORIGIN_X + position[0] / constants.TILE_W - position[1] / constants.TILE_H),
    Math.round(constants.ORIGIN_Y - position[0] / constants.TILE_W - position[1] / constants.TILE_H)];
}
module.exports = { parseObjectSorting, objectAnchor, SURFACE_EPSILON: 0.0001 };
