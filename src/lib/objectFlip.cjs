'use strict';
// Absolute renderer state, independent of pivot, Transform, cells and sorting.
function parseObjectFlips(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10000) throw new Error('좌우반전 목록을 확인하세요.');
  const seen = new Set();
  return value.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        Object.keys(row).sort().join(',') !== 'entityId,flipX' ||
        typeof row.entityId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.entityId) ||
        seen.has(row.entityId) || typeof row.flipX !== 'boolean') throw new Error('좌우반전 대상과 값을 확인하세요.');
    seen.add(row.entityId);
    return { entityId: row.entityId, flipX: row.flipX };
  });
}
module.exports = { parseObjectFlips };
