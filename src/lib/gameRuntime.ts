/** Data-driven runtime placements; legacy authoring entities remain untouched. */
export type RuntimeCell = [number, number];
export type RuntimeKind = "monster" | "portal" | "spawn" | "trap";
export interface RuntimeSelection { kind: RuntimeKind; entityId: string }
export interface GameRuntimeSync { version: 1; sourceId: string }
export interface MonsterFields {
  monsterClassId: number; cell: RuntimeCell; count: number; spread: number;
  respawnMinSec: number; respawnMaxSec: number; firstSpawnSec: number; enabled: boolean;
}
export interface PortalFields { cell: RuntimeCell; destMap: string; destCell: RuntimeCell; destFacing: "NE" | "SE" | "SW" | "NW"; enabled: boolean }
export interface RuntimeEdits<T> { version: 1; updated: ({entityId: string} & Partial<T>)[]; removed: string[]; added: ({entityId: string} & T)[] }
export type GameMonsterEdits = RuntimeEdits<MonsterFields>;
export type GamePortalEdits = RuntimeEdits<PortalFields>;
export interface TrapFields { cell: RuntimeCell; maxCell: RuntimeCell; abnormalityId: number }
export type GameTrapEdits = RuntimeEdits<TrapFields>;
export interface GameTrapDescriptor extends TrapFields { entityId: string; trapId: string; name: string; position: [number,number,number]; sourceCell: RuntimeCell | null; source: TrapFields | null; canEdit: boolean; reason?: string }
export interface GameTrapEffect { abnormalityId: number; name: string; durationMs: number; canAdd: boolean; isComa: boolean }
export interface GameSpawnEdits { version: 1; cell: RuntimeCell }
export interface GameRuntimeEdits { monsters: GameMonsterEdits | null; portals: GamePortalEdits | null; spawn: GameSpawnEdits | null; traps?: GameTrapEdits | null }
export interface GameRuntimeSource { sourceId: string | null; stale: boolean; changedFiles: string[]; refreshAvailable: boolean }
export interface GameMonsterDescriptor extends MonsterFields {
  entityId: string; spawnId: string; name: string; ruid: string; bodyScale: number;
  position: [number, number, number]; sourceCell: RuntimeCell | null; source: MonsterFields | null; canEdit: boolean; reason?: string;
}
export interface GamePortalDescriptor extends PortalFields {
  entityId: string; portalId: string; position: [number, number, number];
  sourceCell: RuntimeCell | null; source: PortalFields | null; canEdit: boolean; reason?: string;
}
export interface RuntimeBounds { minX: number; maxX: number; minY: number; maxY: number }
export interface GameSpawnDescriptor {
  cell: RuntimeCell; sourceCell: RuntimeCell; position: [number,number,number];
  bounds: RuntimeBounds; canEdit: boolean; reason?: string;
}
export interface GameMonsterClass { monsterClassId: number; name: string; ruid: string; bodyScale: number; canAdd: boolean; reason?: string }
export interface GameMapDestination { mapName: string; name?: string; bounds: RuntimeBounds; spawnCell: RuntimeCell; canTarget: boolean; blocked?: RuntimeCell[]; reason?: string }

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const record = (v: unknown): v is Record<string,unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const validRuntimeCell = (v: unknown): v is RuntimeCell => Array.isArray(v) && v.length === 2 && v.every(n => Number.isSafeInteger(n) && n >= 0);
const monsterKeys = ["monsterClassId","cell","count","spread","respawnMinSec","respawnMaxSec","firstSpawnSec","enabled"] as const;
const portalKeys = ["cell","destMap","destCell","destFacing","enabled"] as const;
export function parseGameRuntimeSync(v: unknown): GameRuntimeSync | undefined {
  if (v === undefined) return undefined;
  if (!record(v) || v.version !== 1 || typeof v.sourceId !== "string" || !uuid.test(v.sourceId)) throw new Error("몬스터·포털·시작점 원본 연결 정보가 올바르지 않습니다.");
  return {version:1,sourceId:v.sourceId};
}
export function parseMonsterPatch(v: unknown): Partial<MonsterFields> {
  if (!record(v) || Object.keys(v).some(k => !(monsterKeys as readonly string[]).includes(k))) throw new Error("몬스터 스포너 변경 항목을 확인하세요.");
  const result: Partial<MonsterFields> = {};
  for (const key of monsterKeys) {
    if (!(key in v)) continue;
    const value = v[key];
    if (key === "cell") { if (!validRuntimeCell(value)) throw new Error("스포너 위치는 0 이상의 정수 칸이어야 합니다."); result.cell = [...value]; }
    else if (key === "enabled") { if (typeof value !== "boolean") throw new Error("스포너 활성 값을 확인하세요."); result.enabled = value; }
    else {
      const integer = key === "monsterClassId" || key === "count" || key === "spread";
      if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || value < ((key === "monsterClassId" || key === "count") ? 1 : 0)) throw new Error("몬스터 종류·수량·범위·시간 값을 확인하세요.");
      if ((key === "count" && value > 200) || (!integer && value > 31536000)) throw new Error("수량은 200 이하, 시간은 1년 이하로 입력하세요.");
      result[key] = value;
    }
  }
  return result;
}
export function parsePortalPatch(v: unknown): Partial<PortalFields> {
  if (!record(v) || Object.keys(v).some(k => !(portalKeys as readonly string[]).includes(k))) throw new Error("포털 변경 항목을 확인하세요.");
  const result: Partial<PortalFields> = {};
  for (const key of portalKeys) {
    if (!(key in v)) continue;
    const value = v[key];
    if (key === "cell" || key === "destCell") { if (!validRuntimeCell(value)) throw new Error("포털 위치는 0 이상의 정수 칸이어야 합니다."); result[key] = [...value]; }
    else if (key === "destMap") { if (!id(value)) throw new Error("도착 맵 이름을 확인하세요."); result.destMap = value; }
    else if (key === "destFacing") { if (!["NE","SE","SW","NW"].includes(String(value))) throw new Error("도착 방향을 확인하세요."); result.destFacing = value as PortalFields["destFacing"]; }
    else { if (typeof value !== "boolean") throw new Error("포털 활성 값을 확인하세요."); result.enabled = value; }
  }
  return result;
}
function parseEdits<T extends MonsterFields | PortalFields | TrapFields>(v: unknown, parsePatch: (v: unknown) => Partial<T>, keys: readonly string[]): RuntimeEdits<T> | undefined {
  if (v === undefined) return undefined;
  if (!record(v) || v.version !== 1 || Object.keys(v).some(k => !["version","updated","removed","added"].includes(k)) || !Array.isArray(v.updated) || !Array.isArray(v.removed) || !Array.isArray(v.added)) throw new Error("런타임 배치 편집 정보 형식이 올바르지 않습니다.");
  const seen = new Set<string>();
  const take = (v: unknown) => { if (!id(v) || seen.has(v)) throw new Error("배치 ID가 올바르지 않거나 중복되었습니다."); seen.add(v); return v; };
  const updated = v.updated.map(row => {
    if (!record(row)) throw new Error("변경 항목을 확인하세요.");
    const {entityId,...fields} = row, patch = parsePatch(fields);
    if (!Object.keys(patch).length) throw new Error("변경 항목이 비어 있습니다.");
    return {entityId:take(entityId),...patch};
  });
  const removed = v.removed.map(take);
  const added = v.added.map(row => {
    if (!record(row) || typeof row.entityId !== "string" || !uuid.test(row.entityId)) throw new Error("추가 배치 ID를 확인하세요.");
    const {entityId,...fields} = row, parsed = parsePatch(fields);
    if (keys.some(k => !(k in parsed))) throw new Error("추가 배치의 필수 설정을 입력하세요.");
    return {entityId:take(entityId),...parsed} as {entityId:string} & T;
  });
  return updated.length || removed.length || added.length ? {version:1,updated,removed,added} : undefined;
}
export const parseGameMonsterEdits = (v: unknown): GameMonsterEdits | undefined => parseEdits(v,parseMonsterPatch,monsterKeys);
export const parseGamePortalEdits = (v: unknown): GamePortalEdits | undefined => parseEdits(v,parsePortalPatch,portalKeys);
export function parseGameSpawnEdits(v: unknown): GameSpawnEdits | undefined {
  if (v === undefined) return undefined;
  if (!record(v) || v.version !== 1 || Object.keys(v).some(k => !["version","cell"].includes(k)) || !validRuntimeCell(v.cell)) throw new Error("시작점 위치를 확인하세요.");
  return {version:1,cell:[...v.cell]};
}
export function parseTrapPatch(v: unknown): Partial<TrapFields> {
  if (!record(v) || Object.keys(v).some(k=>!["cell","maxCell","abnormalityId"].includes(k))) throw new Error("함정 편집 항목을 확인하세요.");
  const result:Partial<TrapFields>={};
  for(const key of ["cell","maxCell"] as const) if(key in v){if(!validRuntimeCell(v[key]))throw new Error("함정 범위는 0 이상의 정수 칸이어야 합니다.");result[key]=[...v[key]];}
  if("abnormalityId" in v){if(typeof v.abnormalityId!=="number"||!Number.isSafeInteger(v.abnormalityId)||v.abnormalityId<1)throw new Error("상태이상 번호를 확인하세요.");result.abnormalityId=v.abnormalityId;}
  return result;
}
export const parseGameTrapEdits=(v:unknown):GameTrapEdits|undefined=>parseEdits(v,parseTrapPatch,["cell","maxCell","abnormalityId"]);
export interface RuntimeProjectFields { gameMonsterEdits?: GameMonsterEdits; gamePortalEdits?: GamePortalEdits; gameSpawnEdits?: GameSpawnEdits; gameTrapEdits?: GameTrapEdits; gameRuntimeSync?: GameRuntimeSync }
export function parseRuntimeProject(value: RuntimeProjectFields): RuntimeProjectFields {
  return {gameMonsterEdits:parseGameMonsterEdits(value.gameMonsterEdits),gamePortalEdits:parseGamePortalEdits(value.gamePortalEdits),
    gameSpawnEdits:parseGameSpawnEdits(value.gameSpawnEdits),gameTrapEdits:parseGameTrapEdits(value.gameTrapEdits),gameRuntimeSync:parseGameRuntimeSync(value.gameRuntimeSync)};
}
export function runtimeEditsKey(value: RuntimeProjectFields): string {
  return JSON.stringify([parseGameMonsterEdits(value.gameMonsterEdits)??null,parseGamePortalEdits(value.gamePortalEdits)??null,parseGameSpawnEdits(value.gameSpawnEdits)??null,parseGameTrapEdits(value.gameTrapEdits)??null]);
}
export function runtimeSourceKey(value: RuntimeProjectFields): string { return JSON.stringify([value.gameRuntimeSync??null,runtimeEditsKey(value)]); }
export function updateRuntimeEdit<T>(edits: RuntimeEdits<T> | undefined, entityId: string, patch: Partial<T>): RuntimeEdits<T> {
  const current = edits ?? {version:1,updated:[],removed:[],added:[]};
  if (current.removed.includes(entityId)) throw new Error("삭제한 배치는 수정할 수 없습니다.");
  if (current.added.some(item => item.entityId === entityId)) return {...current,added:current.added.map(item => item.entityId === entityId ? {...item,...patch} : item)};
  const previous = current.updated.find(item => item.entityId === entityId);
  const next = {entityId,...previous,...patch};
  return {...current,updated:previous ? current.updated.map(item => item.entityId === entityId ? next : item) : [...current.updated,next]};
}
export function removeRuntimeEdit<T>(edits: RuntimeEdits<T> | undefined, entityId: string): RuntimeEdits<T> | undefined {
  const current = edits ?? {version:1,updated:[],removed:[],added:[]};
  const added = current.added.some(item => item.entityId === entityId);
  const result = {...current,updated:current.updated.filter(item=>item.entityId!==entityId),added:current.added.filter(item=>item.entityId!==entityId),
    removed:added || current.removed.includes(entityId) ? current.removed : [...current.removed,entityId]};
  return result.updated.length || result.added.length || result.removed.length ? result : undefined;
}
export function runtimeCellInBounds(cell: RuntimeCell, bounds: RuntimeBounds): boolean {
  return validRuntimeCell(cell) && cell[0] >= bounds.minX && cell[0] <= bounds.maxX && cell[1] >= bounds.minY && cell[1] <= bounds.maxY;
}
