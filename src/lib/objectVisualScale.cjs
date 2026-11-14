'use strict';
// Multiplier relative to the imported transform; 1 preserves its aspect and signs.
function parseObjectVisualScales(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10000) throw new Error('배경 배율 목록을 확인하세요.');
  const seen = new Set();
  return value.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join(',') !== 'entityId,scale' ||
        typeof row.entityId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.entityId) || seen.has(row.entityId) ||
        !Number.isFinite(row.scale) || row.scale < 0.01 || row.scale > 100) throw new Error('배경 배율은 1~10000% 범위로 입력하세요.');
    seen.add(row.entityId);
    return { entityId: row.entityId, scale: row.scale };
  }).filter(row => row.scale !== 1);
}
module.exports = { parseObjectVisualScales };
