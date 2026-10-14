'use strict';
const { parseCsv } = require('./npcs.cjs');
const CATALOG_TABLES = new Set(['DT_MonsterClass', 'DT_MonsterAppearance', 'ST_MonsterName', 'DT_Abnormality', 'ST_ABNName']);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const stableRows = rows => JSON.stringify(rows.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
function rows(files, name, required) {
  const file = files[name];
  return file ? parseCsv(file.bytes, required).rows.map(row => row.data) : null;
}
function monsterClassIds(profile, edit) {
  const records = edit?.monsters?.records;
  const active = records ? [...records.values()] : profile.monsters.filter(row => row.map === profile.mapName);
  return new Set(active.map(row => row.values.monsterClassId));
}
function trapEffectIds(profile, edit) {
  const records = edit?.records;
  const active = records ? [...records.values()] : profile.rows.filter(row => row.map === profile.mapName);
  return new Set(active.map(row => row.values.abnormalityId));
}
function dependencies(profile, edit) {
  const portals = edit?.portals?.records ? [...edit.portals.records.values()] : profile.portals.filter(row => row.map === profile.mapName);
  return { classIds: monsterClassIds(profile, edit), effectIds: trapEffectIds(profile.traps, edit?.traps), portalReferenced: portals.length > 0 };
}
function selectedClasses(files, ids) {
  return rows(files, 'DT_MonsterClass', ['MonsterClassID', 'MonsterAppearanceID'])?.filter(row => ids.has(Number(row.MonsterClassID))) ?? [];
}
function selectedEffects(files, ids) {
  return rows(files, 'DT_Abnormality', ['AbnormalityID', 'AbnormalityName'])?.filter(row => ids.has(Number(row.AbnormalityID))) ?? [];
}
/** Only dependencies of this map or its authored additions can invalidate a placement draft. */
function catalogSignature(files, name, { classIds = new Set(), effectIds = new Set() }) {
  if (!CATALOG_TABLES.has(name)) return undefined;
  const ids = name === 'DT_Abnormality' || name === 'ST_ABNName' ? effectIds : classIds;
  if (!ids.size) return 'unused';
  if (!files[name]) return null;
  if (name === 'DT_MonsterClass') {
    return stableRows(rows(files, name, ['MonsterClassID', 'MonsterName', 'MonsterAppearanceID', 'ModelID', 'BodyScale'])
      .filter(row => ids.has(Number(row.MonsterClassID))).map(row => ({
        MonsterClassID: Number(row.MonsterClassID), MonsterName: row.MonsterName,
        MonsterAppearanceID: row.MonsterAppearanceID, ModelID: row.ModelID,
        BodyScale: Number(row.BodyScale || 1), BodyTint: row.BodyTint || '',
      })));
  }
  if (name === 'DT_MonsterAppearance') {
    const appearances = new Set(selectedClasses(files, ids).map(row => row.MonsterAppearanceID));
    return stableRows(rows(files, name, ['MonsterAppearanceID', 'Action', 'BaseDir', 'Ruid'])
      .filter(row => appearances.has(row.MonsterAppearanceID) && row.Action === 'Idle' && row.BaseDir === 'SE')
      .map(row => ({ MonsterAppearanceID: row.MonsterAppearanceID, Action: row.Action, BaseDir: row.BaseDir, Ruid: row.Ruid })));
  }
  if (name === 'DT_Abnormality') {
    return stableRows(selectedEffects(files, ids).map(row => Object.fromEntries(Object.entries(row)
      .filter(([key]) => !key.startsWith('#')).map(([key, value]) => [key, key === 'AbnormalityID' || key === 'Duration'
        ? Number(value) : key === 'ApplyTarget' ? value.split(',').map(s => s.trim()).sort().join(',') : value]))));
  }
  const keys = new Set(name === 'ST_MonsterName' ? selectedClasses(files, ids).map(row => row.MonsterName)
    : selectedEffects(files, ids).map(row => row.AbnormalityName));
  return stableRows(rows(files, name, ['Key']).filter(row => keys.has(row.Key))
    .map(row => ({ Key: row.Key, name: row.ko || row.Source || row.Key })));
}
module.exports = { dependencies, trapEffectIds, catalogSignature };
