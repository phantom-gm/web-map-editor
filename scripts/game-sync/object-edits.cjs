'use strict';
// Native object edits remain separate from the legacy authoring entities array.
// Every structured mutation goes through the game's MapBuilder public methods.
const TF = 'MOD.Core.TransformComponent';
const SR = 'MOD.Core.SpriteRendererComponent';
const DEPTH = 'script.IsoDepthMetaComponent';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const clone = value => JSON.parse(JSON.stringify(value));
const near = (a, b) => Math.abs(a - b) <= 1e-7;
function fail(code, message) { const error = new Error(message); error.name = 'GameSyncError'; error.code = code; throw error; }
function vector(v, fallback) { return fallback.map((n, i) => Number(v?.[['x', 'y', 'z', 'w'][i]] ?? n)); }
function analyzeObjects(mb, project, preview) {
  const entities = mb.listEntities(), records = new Map();
  const nativeByPath = new Map(entities.map(e => [e.path, mb.find(e.path)]));
  const references = entities.map(e => ({ id: e.id, text: JSON.stringify(nativeByPath.get(e.path)?.jsonString) }));
  const visible = new Set(preview.sprites.map(s => s.id));
  const root = entities.find(e => e.path.split('/').length === 3);
  const resourceNames = new Map((project.palette || []).filter(t => t.ruid && t.name).map(t => [t.ruid, t.name]));
  for (const item of entities.filter(e => e.name.startsWith('Obj_'))) {
    const native = nativeByPath.get(item.path), json = native.jsonString;
    const tf = mb.component(item.path, TF), sr = mb.component(item.path, SR), meta = mb.component(item.path, DEPTH);
    const position = vector(tf?.Position, [0, 0, 0]);
    const ruid = typeof sr?.SpriteRUID === 'string' ? sr.SpriteRUID : sr?.SpriteRUID?.DataId;
    const reasons = [];
    if (mb.getTileMapMode() !== 1) reasons.push('RectTile 맵만 오브젝트 편집을 지원합니다.');
    if (!root || item.path.slice(0, item.path.lastIndexOf('/')) !== root.path) reasons.push('중첩된 오브젝트는 보호합니다.');
    if (entities.some(e => e.path.startsWith(item.path + '/'))) reasons.push('자식 엔티티가 있는 오브젝트는 보호합니다.');
    if (!visible.has(item.id) || !tf || !sr || !position.every(Number.isFinite)) reasons.push('표시 또는 변환을 확인할 수 없는 오브젝트입니다.');
    const types = (json['@components'] || []).map(c => c['@type']);
    if (types.some(t => ![TF, SR, DEPTH].includes(t)) || new Set(types).size !== types.length) reasons.push('지원하지 않는 컴포넌트가 있어 보호합니다.');
    if (json.modelId !== 'mapobject' || (json.origin && (json.origin.entry_id !== 'mapobject'
      || json.origin.sub_entity_id != null || json.origin.replaced_model_id != null
      || (json.origin.root_entity_id != null && json.origin.root_entity_id !== item.id)))) reasons.push('모델 연결이 있는 오브젝트는 보호합니다.');
    if (meta && (!['GX', 'GY', 'W', 'H'].every(k => Number.isInteger(meta[k])) || meta.W < 1 || meta.H < 1
      || !Number.isFinite(meta.StaticZ) || !Number.isFinite(meta.StaticOrder)
      || !near(meta.StaticZ, position[2]) || meta.StaticOrder !== sr.OrderInLayer)) reasons.push('깊이 정렬 메타를 확인할 수 없습니다.');
    const tokens = [item.id, item.path, item.name];
    if (references.some(e => e.id !== item.id && tokens.some(token => e.text.includes(token)))) reasons.push('다른 엔티티가 참조하는 오브젝트는 보호합니다.');
    const authoring = (project.entities || []).filter(e => e.kind === 'object' && 'Obj_' + String(e.id).slice(0, 8) === item.name);
    const name = resourceNames.get(ruid) || authoring[0]?.name || item.name;
    const knownJson = new Set(['name', 'path', 'nameEditable', 'enable', 'visible', 'localize', 'displayOrder', 'pathConstraints', 'revision', 'modelId', '@components', '@version', 'origin']);
    const knownOrigin = new Set(['type', 'entry_id', 'sub_entity_id', 'root_entity_id', 'replaced_model_id']);
    const componentText = JSON.stringify(json['@components']);
    const componentReference = entities.some(e => componentText.includes(e.id) || componentText.includes(e.path));
    const cloneReason = Object.keys(json).some(k => !knownJson.has(k)) || Object.keys(json.origin || {}).some(k => !knownOrigin.has(k))
      || Object.keys(native).some(k => !['id', 'path', 'componentNames', 'jsonString'].includes(k))
      || (json.origin && json.origin.type !== 'Model') || (json['@version'] != null && json['@version'] !== 1) || componentReference
      ? '추가 메타가 있는 오브젝트는 복제할 수 없습니다.' : null;
    const collisionNote = meta || authoring.some(e => e.blocks === true)
      ? '선택하지 않은 이동불가 영역은 그대로 유지됩니다. 함께 수정하려면 해당 칸을 직접 선택해 묶음으로 편집하세요.' : undefined;
    records.set(item.id, { item, native: clone(native), meta: meta && clone(meta),
      descriptor: { entityId: item.id, prototypeId: item.id, spriteId: item.id, name, ruid: ruid || '',
        position, sourcePosition: [...position], canMove: reasons.length === 0,
        canDelete: reasons.length === 0, canDuplicate: reasons.length === 0 && !cloneReason,
        ...(reasons.length || cloneReason ? { reason: [...reasons, cloneReason].filter(Boolean).join(' ') } : {}),
        ...(collisionNote ? { collisionNote } : {}) } });
  }
  return { records, entities };
}
function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail('INVALID_OBJECT_EDITS', label + ' 형식이 유효하지 않습니다.');
}
function moveTarget(record, position, constants) {
  if (!Array.isArray(position) || position.length !== 2 || position.some(v => !Number.isFinite(v) || Math.abs(v) > 1e6)) fail('INVALID_OBJECT_POSITION', '오브젝트 위치는 유한한 [x,y] 게임 좌표여야 합니다.');
  const original = record.descriptor.sourcePosition;
  const dx = position[0] - original[0], dy = position[1] - original[1];
  const gx = dx / constants.TILE_W - dy / constants.TILE_H;
  const gy = -dx / constants.TILE_W - dy / constants.TILE_H;
  const dgx = Math.round(gx), dgy = Math.round(gy);
  if (!near(gx, dgx) || !near(gy, dgy)) fail('OBJECT_GRID_REQUIRED', '오브젝트는 원래 오프셋을 유지하며 정수 셀 단위로 이동해야 합니다.');
  const sx = (dgx - dgy) * constants.TILE_W / 2, sy = -(dgx + dgy) * constants.TILE_H / 2;
  return { position: dgx === 0 && dgy === 0 ? [...original] : [original[0] + sx, original[1] + sy, original[2] + sy * constants.DEPTH_SCALE], dgx, dgy };
}
function inspectObjectEdits(value, profile, constants) {
  const empty = { moved: [], removed: [], added: [], changed: false };
  if (value === undefined) return empty;
  exactKeys(value, ['version', 'moved', 'removed', 'added'], '오브젝트 편집');
  if (value.version !== 1 || !['moved', 'removed', 'added'].every(k => Array.isArray(value[k]))
    || value.moved.length + value.removed.length + value.added.length > 10000) fail('INVALID_OBJECT_EDITS', '오브젝트 편집 버전 또는 배열이 유효하지 않습니다.');
  const used = new Set(), existing = new Set(profile.entities.map(e => e.id));
  const result = { moved: [], removed: [], added: [], changed: false };
  const get = (id, capability) => {
    const record = typeof id === 'string' && profile.records.get(id);
    if (!record) fail('UNKNOWN_OBJECT', '원본 오브젝트를 찾을 수 없습니다: ' + id);
    if (!record.descriptor[capability]) fail('PROTECTED_OBJECT', record.descriptor.reason || '보호된 오브젝트입니다.');
    return record;
  };
  const once = id => { if (used.has(id)) fail('DUPLICATE_OBJECT_EDIT', '오브젝트 편집 ID가 중복되었습니다: ' + id); used.add(id); };
  for (const row of value.moved) {
    exactKeys(row, ['entityId', 'position'], '이동'); once(row.entityId);
    const record = get(row.entityId, 'canMove'), target = moveTarget(record, row.position, constants);
    if (target.dgx || target.dgy) result.moved.push({ entityId: row.entityId, record, ...target });
  }
  for (const id of value.removed) { once(id); result.removed.push({ entityId: id, record: get(id, 'canDelete') }); }
  for (const row of value.added) {
    exactKeys(row, ['entityId', 'prototypeId', 'position'], '추가'); once(row.entityId);
    if (!UUID.test(row.entityId || '') || existing.has(row.entityId)) fail('INVALID_OBJECT_ID', '추가 오브젝트 ID는 원본과 겹치지 않는 UUID여야 합니다.');
    const record = get(row.prototypeId, 'canDuplicate'), target = moveTarget(record, row.position, constants);
    result.added.push({ entityId: row.entityId, prototypeId: row.prototypeId, record, ...target });
  }
  result.changed = result.moved.length + result.removed.length + result.added.length > 0;
  return result;
}
function changedComponents(edit) {
  const components = clone(edit.record.native.jsonString['@components']);
  const tf = components.find(c => c['@type'] === TF);
  tf.Position = { ...tf.Position, x: edit.position[0], y: edit.position[1], z: edit.position[2] };
  const meta = components.find(c => c['@type'] === DEPTH);
  if (meta) { meta.GX += edit.dgx; meta.GY += edit.dgy; meta.StaticZ = edit.position[2]; }
  return components;
}
function applyObjectEdits(mb, edits, stable) {
  const edited = [];
  for (const edit of edits.moved) {
    const path = edit.record.item.path, components = changedComponents(edit);
    mb.patchComponent(path, TF, { Position: components.find(c => c['@type'] === TF).Position });
    const meta = components.find(c => c['@type'] === DEPTH);
    if (meta) mb.patchComponent(path, DEPTH, { GX: meta.GX, GY: meta.GY, StaticZ: meta.StaticZ });
    const expected = clone(edit.record.native); expected.jsonString['@components'] = components;
    if (stable(mb.find(path)) !== stable(expected)) fail('PRESERVATION_FAILED', '오브젝트 이동이 허용된 위치 이외의 값을 변경했습니다.');
    edited.push([path, stable(expected)]);
  }
  for (const edit of edits.removed) mb.remove(edit.record.item.path);
  for (const edit of edits.added) {
    const name = 'Obj_Editor_' + edit.entityId, json = edit.record.native.jsonString;
    if (mb.find(name)) fail('ENTITY_COLLISION', '추가 오브젝트 이름이 원본과 겹칩니다: ' + name);
    const options = Object.fromEntries(['modelId', 'nameEditable', 'enable', 'visible', 'localize', 'displayOrder', 'revision'].filter(k => Object.prototype.hasOwnProperty.call(json, k)).map(k => [k, json[k]]));
    // The original model origin points at its old GUID. Let MapBuilder create a
    // fresh origin matching the new GUID, while copying all original components.
    const components = changedComponents(edit);
    mb.entity(name, components, options);
    if (stable(mb.find(name).jsonString['@components']) !== stable(components)) fail('PRESERVATION_FAILED', '복제 오브젝트 컴포넌트가 달라졌습니다.');
    edited.push([mb.find(name).path, stable(mb.find(name))]);
  }
  return edited;
}
function objectScene(mb, profile, edits) {
  const removed = new Set(edits.removed.map(e => e.entityId));
  const objects = [];
  for (const [id, record] of profile.records) {
    if (removed.has(id)) continue;
    const native = mb.find(record.item.path);
    objects.push({ ...record.descriptor, spriteId: native.id, position: vector(mb.component(record.item.path, TF)?.Position, [0, 0, 0]) });
  }
  for (const edit of edits.added) {
    const name = 'Obj_Editor_' + edit.entityId, native = mb.find(name);
    objects.push({ ...edit.record.descriptor, entityId: edit.entityId, prototypeId: edit.prototypeId, spriteId: native.id,
      position: [...edit.position], sourcePosition: [...edit.record.descriptor.sourcePosition] });
  }
  return { objects, objectPrototypes: [...profile.records.values()].map(r => r.descriptor) };
}
module.exports = { analyzeObjects, inspectObjectEdits, applyObjectEdits, objectScene };
