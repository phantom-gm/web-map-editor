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

/**
 * DT_NpcClass CSV 텍스트(헤더+행) → parseNpcCatalog 이 읽는 raw 행 배열.
 * 게임 원본 `DT_NpcClass.csv` 를 에디터 'NPC목록' 로드에 **그대로** 넣을 수 있게 한다(JSON 변환 불필요).
 * 헤더에서 NpcClassID/NpcName/NpcType 컬럼 위치를 찾아 매핑 — 열 순서·추가 컬럼에 무관. BOM 제거.
 */
export function npcCsvToRows(
  csvText: string,
): Array<{ NpcClassID?: string; NpcName?: string; NpcType?: string }> {
  const lines = csvText.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const iId = header.indexOf("NpcClassID");
  const iName = header.indexOf("NpcName");
  const iType = header.indexOf("NpcType");
  if (iId < 0) return []; // NpcClassID 컬럼 없으면 DT_NpcClass CSV 가 아님
  return lines.slice(1).map((line) => {
    const c = line.split(",");
    return {
      NpcClassID: c[iId]?.trim(),
      NpcName: iName >= 0 ? c[iName]?.trim() : undefined,
      NpcType: iType >= 0 ? c[iType]?.trim() : undefined,
    };
  });
}

/** 번들 seed 기반 기본 카탈로그. (seed 는 scripts/sync-npcclass.mjs 가 DT_NpcClass.csv 에서 파생) */
export function defaultNpcCatalog(): NpcCatalog {
  return parseNpcCatalog(seed);
}

/** "1002 — 거미 (Monster)" 표시용. */
export function npcClassLabel(e: NpcClassEntry): string {
  return `${e.id} — ${e.name} (${e.type})`;
}
