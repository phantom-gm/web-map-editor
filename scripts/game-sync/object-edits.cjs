'use strict';
// Native object edits remain separate from the legacy authoring entities array.
// Every structured mutation goes through the game's MapBuilder public methods.
const { parseObjectSorting, objectAnchor, SURFACE_EPSILON } = require('../../src/lib/objectSorting.cjs');
const TF = 'MOD.Core.TransformComponent';
const SR = 'MOD.Core.SpriteRendererComponent';
const DEPTH = 'script.IsoDepthMetaComponent';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const clone = value => JSON.parse(JSON.stringify(value));
const near = (a, b) => Math.abs(a - b) <= 1e-7;
function fail(code, message) { const error = new Error(message); error.name = 'GameSyncError'; error.code = code; throw error; }
function vector(v, fallback) { return fallback.map((n, i) => Number(v?.[['x', 'y', 'z', 'w'][i]] ?? n)); }
function sortInfo(mb, name) {
  const m = mb.component(name, DEPTH), sr = mb.component(name, SR);
  return { order: sr.OrderInLayer ?? 0, footprint: m ? [m.GX, m.GY, m.W, m.H] : null,
    bounds: [m?.BaseW || 0, m?.BaseH || 0], padX: m?.SortPadX || 0 };
}
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
        position, sourcePosition: [...position], sortInfo: sortInfo(mb, item.path), canMove: reasons.length === 0,
        canDelete: reasons.length === 0, canDuplicate: reasons.length === 0 && !cloneReason,
        ...(reasons.length || cloneReason ? { reason: [...reasons, cloneReason].filter(Boolean).join(' ') } : {}),
        ...(collisionNote ? { collisionNote } : {}) } });
  }
  return { records, entities };
}
function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail('INVALID_OBJECT_EDITS', label + ' 형식이 유효하지 않습니다.');
}
function validateResource(resource) {
  exactKeys(resource, ['ruid', 'name', 'metadata'], '서버 소재');
  const m = resource.metadata;
  if (!/^[a-f0-9]{32}$/.test(resource.ruid || '') || typeof resource.name !== 'string' || !resource.name.trim() || resource.name.length > 256 ||
      !m || !Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 1 || m.height < 1 || m.width > 32768 || m.height > 32768 ||
      !Number.isFinite(m.pixelsPerUnit) || m.pixelsPerUnit <= 0 || !Array.isArray(m.pivot) || m.pivot.length !== 2 || !m.pivot.every(Number.isFinite)) fail('INVALID_OBJECT_RESOURCE', '서버 소재의 크기·기준점 정보를 확인할 수 없습니다.');
}
function addResourcePrototypes(mb, profile, resources, constants) {
  for (const resource of resources) {
    const id = 'resource_' + resource.id, name = 'Obj_Resource_' + resource.id;
    if (mb.find(name) || profile.records.has(id)) fail('ENTITY_COLLISION', '소재 이름이 원본과 겹칩니다.');
    mb.sprite(name, { ruid: resource.ruid, pos: [0, 0, 0], order: 0 });
    mb.upsertComponent(name, DEPTH, { '@type': DEPTH, GX: constants.ORIGIN_X, GY: constants.ORIGIN_Y, W: 1, H: 1, StaticZ: 0, StaticOrder: 0 });
    const native = clone(mb.find(name));
    profile.records.set(id, { resource, item: { id, name, path: native.path }, native,
      descriptor: { entityId: id, prototypeId: id, spriteId: native.id, name: resource.name, ruid: resource.ruid,
        position: [0, 0, 0], sourcePosition: [0, 0, 0], canMove: true, canDelete: true, canDuplicate: true,
        libraryOnly: true, resourceId: resource.id, scale: 1 } });
    mb.remove(name); // Library prototypes never enter the original map or candidate by themselves.
  }
}
function moveTarget(record, position, constants) {
  if (!Array.isArray(position) || position.length !== 2 || position.some(v => !Number.isFinite(v) || Math.abs(v) > 1e6)) fail('INVALID_OBJECT_POSITION', '오브젝트 위치는 유한한 [x,y] 게임 좌표여야 합니다.');
  const original = record.descriptor.sourcePosition;
  const dx = position[0] - original[0], dy = position[1] - original[1];
  const gx = dx / constants.TILE_W - dy / constants.TILE_H;
  const gy = -dx / constants.TILE_W - dy / constants.TILE_H;
  const dgx = Math.round(gx), dgy = Math.round(gy);
  if (record.resource) return { position: [position[0], position[1], original[2] + dy * constants.DEPTH_SCALE], dgx, dgy };
  if (!near(gx, dgx) || !near(gy, dgy)) fail('OBJECT_GRID_REQUIRED', '오브젝트는 원래 오프셋을 유지하며 정수 셀 단위로 이동해야 합니다.');
  const sx = (dgx - dgy) * constants.TILE_W / 2, sy = -(dgx + dgy) * constants.TILE_H / 2;
  return { position: dgx === 0 && dgy === 0 ? [...original] : [original[0] + sx, original[1] + sy, original[2] + sy * constants.DEPTH_SCALE], dgx, dgy };
}
function inspectObjectEdits(value, profile, constants) {
  const empty = { moved: [], removed: [], added: [], sorting: [], changed: false };
  if (value === undefined) return empty;
  exactKeys(value, ['version', 'moved', 'removed', 'added', ...(value.resources !== undefined ? ['resources'] : []), ...(value.sorting !== undefined ? ['sorting'] : [])], '오브젝트 편집');
  if (value.version !== 1 || !['moved', 'removed', 'added'].every(k => Array.isArray(value[k]))
    || value.moved.length + value.removed.length + value.added.length > 10000) fail('INVALID_OBJECT_EDITS', '오브젝트 편집 버전 또는 배열이 유효하지 않습니다.');
  const used = new Set(), existing = new Set(profile.entities.map(e => e.id));
  const result = { moved: [], removed: [], added: [], sorting: [], constants, changed: false };
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
    if (record.resource) fail('INVALID_OBJECT_EDITS', '소재 자체는 이동할 수 없습니다. 배치한 대상을 선택하세요.');
    if (target.dgx || target.dgy) result.moved.push({ entityId: row.entityId, record, ...target });
  }
  for (const id of value.removed) { once(id); const record = get(id, 'canDelete'); if (record.resource) fail('INVALID_OBJECT_EDITS', '소재 자체는 삭제 대상이 아닙니다.'); result.removed.push({ entityId: id, record }); }
  for (const row of value.added) {
    exactKeys(row, ['entityId', 'prototypeId', 'position', ...(row.scale !== undefined ? ['scale'] : []), ...(row.depthOffset !== undefined ? ['depthOffset'] : [])], '추가'); once(row.entityId);
    if (!UUID.test(row.entityId || '') || existing.has(row.entityId)) fail('INVALID_OBJECT_ID', '추가 오브젝트 ID는 원본과 겹치지 않는 UUID여야 합니다.');
    const record = get(row.prototypeId, 'canDuplicate'), target = moveTarget(record, row.position, constants);
    if (row.scale !== undefined && (!record.resource || !Number.isFinite(row.scale) || row.scale < 0.01 || row.scale > 100)) fail('INVALID_OBJECT_SCALE', '새 서버 소재의 크기는 1~10000% 범위여야 합니다.');
    if (row.depthOffset !== undefined && (!record.resource || !Number.isFinite(row.depthOffset) || Math.abs(row.depthOffset) > 100)) fail('INVALID_OBJECT_DEPTH', '새 서버 소재의 앞뒤 보정값을 확인하세요.');
    if (record.resource) target.position[2] += row.depthOffset ?? 0;
    result.added.push({ entityId: row.entityId, prototypeId: row.prototypeId, record, ...target, ...(record.resource ? { scale: row.scale ?? 1, depthOffset: row.depthOffset ?? 0 } : {}) });
  }
  let sorting;
  try { sorting = parseObjectSorting(value.sorting); } catch (e) { fail('INVALID_OBJECT_SORTING', e.message); }
  const removed = new Set(result.removed.map(e => e.entityId));
  const additions = new Map(result.added.map(e => [e.entityId, e]));
  const settings = new Map(sorting.map(e => [e.entityId, e.setting]));
  const target = id => {
    const record = additions.get(id)?.record || profile.records.get(id);
    if (!record || removed.has(id) || (record.resource && !additions.has(id))) fail('INVALID_OBJECT_SORTING', '정렬 대상이나 받치는 가구가 없습니다. 먼저 연결을 해제하세요.');
    if (!record.descriptor.canMove) fail('PROTECTED_OBJECT', '보호된 오브젝트의 정렬은 바꿀 수 없습니다.');
    return record;
  };
  for (const row of sorting) {
    const record = target(row.entityId);
    if (row.setting.mode === 'surface') {
      const support = target(row.setting.supportId), mode = settings.get(row.setting.supportId)?.mode;
      const order = support.native.jsonString['@components'].find(c => c['@type'] === SR).OrderInLayer ?? 0;
      if (mode === 'surface' || mode === 'wall' || (!mode && order !== 0)) fail('INVALID_OBJECT_SUPPORT', '받치는 대상은 바닥 가구여야 합니다. 벽 장식이나 다른 소품은 선택할 수 없습니다.');
    }
    result.sorting.push({ ...row, record, added: additions.has(row.entityId) });
  }
  result.changed = result.moved.length + result.removed.length + result.added.length + result.sorting.length > 0;
  return result;
}
function changedComponents(edit) {
  const components = clone(edit.record.native.jsonString['@components']);
  const tf = components.find(c => c['@type'] === TF);
  tf.Position = { ...tf.Position, x: edit.position[0], y: edit.position[1], z: edit.position[2] };
  if (edit.record.resource) tf.Scale = { ...(tf.Scale || {}), x: edit.scale, y: edit.scale, z: 1 };
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
  const byId = new Map(edits.added.map(e => [e.entityId, 'Obj_Editor_' + e.entityId]));
  for (const row of edits.sorting || []) if (!byId.has(row.entityId)) byId.set(row.entityId, row.record.item.path);
  const pathFor = id => byId.get(id) || mb.listEntities().find(e => e.id === id)?.path;
  // Floor/wall first; a surface uses the final support Z and never contributes a second footprint.
  for (const row of [...(edits.sorting || [])].sort((a,b) => Number(a.setting.mode === 'surface') - Number(b.setting.mode === 'surface'))) {
    const name = pathFor(row.entityId), before = clone(mb.find(name)), s = row.setting;
    const tf = clone(mb.component(name, TF)), sr = mb.component(name, SR);
    const prior = mb.component(name, DEPTH) || { '@type': DEPTH };
    const anchor = objectAnchor([tf.Position.x, tf.Position.y], edits.constants);
    const order = s.mode === 'wall' ? -998 : 0;
    const meta = { ...clone(prior), GX: anchor[0], GY: anchor[1], W: 1, H: 1, BaseW: 0, BaseH: 0,
      ScaleX: Math.abs(tf.Scale?.x ?? 1), ScaleY: Math.abs(tf.Scale?.y ?? 1), SortPadX: 0, StaticOrder: order };
    if (s.mode === 'floor') Object.assign(meta, { GX: anchor[0] + s.offset[0], GY: anchor[1] + s.offset[1],
      W: s.size[0], H: s.size[1], BaseW: s.bounds[0], BaseH: s.bounds[1], SortPadX: s.padX });
    if (s.mode === 'surface') tf.Position.z = mb.component(pathFor(s.supportId), TF).Position.z - SURFACE_EPSILON;
    meta.StaticZ = tf.Position.z;
    mb.patchComponent(name, TF, { Position: tf.Position });
    mb.patchComponent(name, SR, { OrderInLayer: order });
    mb.upsertComponent(name, DEPTH, meta);
    // Verify the narrow mutation whitelist, including newly added depth metadata.
    const expected = before.jsonString['@components'];
    expected.find(c => c['@type'] === TF).Position = tf.Position;
    expected.find(c => c['@type'] === SR).OrderInLayer = order;
    const index = expected.findIndex(c => c['@type'] === DEPTH);
    if (index >= 0) expected[index] = meta; else expected.push(meta);
    before.componentNames = expected.map(c => c['@type']).join(',');
    if (stable(mb.find(name)) !== stable(before)) fail('PRESERVATION_FAILED', '정렬 설정이 허용된 값 이외의 항목을 변경했습니다.');
    const actualPath = mb.find(name).path;
    const old = edited.findIndex(e => e[0] === actualPath);
    if (old >= 0) edited.splice(old, 1);
    edited.push([actualPath, stable(before)]);
  }
  return edited;
}
function objectScene(mb, profile, edits) {
  const removed = new Set(edits.removed.map(e => e.entityId));
  const objects = [];
  for (const [id, record] of profile.records) {
    if (record.resource || removed.has(id)) continue;
    const native = mb.find(record.item.path);
    objects.push({ ...record.descriptor, spriteId: native.id, position: vector(mb.component(record.item.path, TF)?.Position, [0, 0, 0]) });
  }
  for (const edit of edits.added) {
    const name = 'Obj_Editor_' + edit.entityId, native = mb.find(name);
    objects.push({ ...edit.record.descriptor, entityId: edit.entityId, prototypeId: edit.prototypeId, spriteId: native.id,
      position: vector(mb.component(name, TF)?.Position, [0, 0, 0]), sourcePosition: [...edit.record.descriptor.sourcePosition],
      ...(edit.record.resource ? { libraryOnly: false, scale: edit.scale, depthOffset: edit.depthOffset } : {}) });
  }
  for (const object of objects) {
    const row = (edits.sorting || []).find(e => e.entityId === object.entityId);
    if (row) object.sortSetting = clone(row.setting);
    const name = edits.added.some(e => e.entityId === object.entityId) ? 'Obj_Editor_' + object.entityId : profile.records.get(object.entityId).item.path;
    object.sortInfo = sortInfo(mb, name);
  }
  return { objects, objectPrototypes: [...profile.records.values()].map(r => r.descriptor) };
}
module.exports = { validateResource, addResourcePrototypes, analyzeObjects, inspectObjectEdits, applyObjectEdits, objectScene };
