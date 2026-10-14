'use strict';
// World XY only: +Y is up. Independent of cell movement, resource pivot and Z.
const MAX_VISUAL_OFFSET = 40.96;
function parseObjectVisualOffsets(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10000) throw new Error('이미지 미세 조정 목록을 확인하세요.');
  const seen = new Set();
  const rows = value.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        Object.keys(row).sort().join(',') !== 'entityId,offset' ||
        typeof row.entityId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.entityId) || seen.has(row.entityId) ||
        !Array.isArray(row.offset) || row.offset.length !== 2 ||
        row.offset.some(n => !Number.isFinite(n) || Math.abs(n) > MAX_VISUAL_OFFSET)) {
      throw new Error('이미지 미세 조정의 대상과 좌표를 확인하세요.');
    }
    seen.add(row.entityId);
    return { entityId: row.entityId, offset: [...row.offset] };
  });
  return rows.filter(row => row.offset.some(n => n !== 0));
}
module.exports = { MAX_VISUAL_OFFSET, parseObjectVisualOffsets };
