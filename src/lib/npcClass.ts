// NpcClass 카탈로그 — 몬스터/NPC 배치 시 npcClassId 드롭다운 소스이자 export 검증 기준.
// RUID 레지스트리(registry.ts)와 동일 패턴: 번들 seed 를 기본값으로 쓰고, 파일 불러오기로 교체 가능.
import seed from "../../data/npcclass.seed.json";

export type NpcType = "Monster" | "Npc" | string;

export interface NpcClassEntry {
  id: number;
  name: string;
  type: NpcType;
}

export interface NpcCatalog {
  entries: NpcClassEntry[];
  byId: Map<number, NpcClassEntry>;
}

/** DT_NpcClass 스냅샷(JSON)을 카탈로그로 파싱. { entries:[{id,name,type}] } 또는 배열 허용. */
export function parseNpcCatalog(json: unknown): NpcCatalog {
  const raw = json as { entries?: unknown } | unknown[];
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : [];
  const entries: NpcClassEntry[] = [];
  const byId = new Map<number, NpcClassEntry>();
  for (const item of list as Array<Record<string, unknown>>) {
    const id = Number(item?.id ?? item?.NpcClassID);
    if (!Number.isFinite(id)) continue;
    const name = String(item?.name ?? item?.NpcName ?? id);
    const type = String(item?.type ?? item?.NpcType ?? "Monster");
    const entry: NpcClassEntry = { id, name, type };
    entries.push(entry);
    byId.set(id, entry);
  }
  return { entries, byId };
}

/** 번들 seed 기반 기본 카탈로그. */
export function defaultNpcCatalog(): NpcCatalog {
  return parseNpcCatalog(seed);
}

/** "1002 — 거미 (Monster)" 표시용. */
export function npcClassLabel(e: NpcClassEntry): string {
  return `${e.id} — ${e.name} (${e.type})`;
}
