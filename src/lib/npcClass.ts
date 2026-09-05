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

// ── CSV 직접 로드 ('NPC목록' 버튼) ────────────────────────────────────────────
//
// 게임 CSV 를 변환 없이 그대로 넣을 수 있게 한다. ⚠ 게임 DataSet 이 재편되면서 소스가
//   **한 장 → 네 장**이 됐다(2026-09-06 반영):
//     npc/DT_NpcClass.csv         NpcClassID,     NpcName(→ST 키)
//     monster/DT_MonsterClass.csv MonsterClassID, MonsterName(→ST 키)
//     locale/ST_NpcName.csv       Key → ko  (실제 표시 이름)
//     locale/ST_MonsterName.csv   Key → ko
//   구조 변화 3가지: (1) NPC·몬스터 표 분리 (2) `NpcType` 컬럼 소멸 → 종류는 **어느 표에서
//   왔는지**로 정한다 (3) 이름이 로컬라이즈 키가 됨 → ST 표로 풀어야 사람이 읽는 이름이 나온다.
//   옛 스키마(한 장 + NpcType + 직접 이름)도 계속 받는다 — 판별은 파일명이 아니라 **헤더**로 한다.

/** 로드에 넘기는 파일 하나. name 은 경고 메시지용(판별에는 쓰지 않는다). */
export interface CsvSource {
  name: string;
  text: string;
}

export interface CatalogLoadResult {
  entries: NpcClassEntry[];
  /** 사용자에게 보여줄 경고(무시된 파일·이름 미해결 등). 비어 있으면 완전 성공. */
  warnings: string[];
  stats: { npc: number; monster: number; names: number; unresolved: number };
}

interface Table {
  header: string[];
  rows: string[][];
}

/** CSV 텍스트 → 헤더+행. BOM·CRLF·빈 줄 처리. */
function parseCsv(text: string): Table {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { header: [], rows: [] };
  return {
    header: lines[0].split(",").map((h) => h.trim()),
    rows: lines.slice(1).map((l) => l.split(",")),
  };
}

const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

/** 표시 이름을 못 찾아 ST 키가 그대로 남은 값인가 (NPCNAME_101 / MONSTERNAME_1000 …). */
const looksLikeKey = (s: string) => /^[A-Z]+NAME_\d+$/.test(s);

/**
 * 게임 CSV 들을 합쳐 카탈로그 엔트리를 만든다. 파일 순서는 상관없다 — 헤더로 종류를 판별해
 * 클래스표(NPC/몬스터)와 이름표(ST)를 각각 모은 뒤 **마지막에** 이름을 해석한다.
 * 이름표가 없으면 ST 키가 그대로 남고 경고로 알린다(조용히 키가 노출되지 않게).
 */
export function buildCatalogFromCsv(sources: CsvSource[]): CatalogLoadResult {
  const names = new Map<string, string>(); // ST 키 → 표시 이름
  const classRows: Array<{ id: number; rawName: string; type: NpcType }> = [];
  const warnings: string[] = [];
  let npc = 0;
  let monster = 0;

  for (const src of sources) {
    const { header, rows } = parseCsv(src.text);
    if (header.length === 0) {
      warnings.push(`${src.name}: 내용이 비어 있어 건너뜀`);
      continue;
    }
    const iKey = header.indexOf("Key");
    const iNpcId = header.indexOf("NpcClassID");
    const iMonId = header.indexOf("MonsterClassID");

    // (a) 이름표 — ST_*.csv (Key,Source,Note,ko,en). ko 우선, 없으면 Source.
    if (iKey >= 0 && (header.includes("ko") || header.includes("Source"))) {
      const iKo = header.indexOf("ko");
      const iSrc = header.indexOf("Source");
      for (const r of rows) {
        const k = cell(r, iKey);
        if (!k) continue;
        const v = cell(r, iKo) || cell(r, iSrc);
        if (v) names.set(k, v);
      }
      continue;
    }

    // (b) NPC 클래스표. 옛 스키마에 NpcType 이 있으면 행마다 그 값을 쓴다(하위호환).
    if (iNpcId >= 0) {
      const iName = header.indexOf("NpcName");
      const iType = header.indexOf("NpcType");
      for (const r of rows) {
        const id = Number(cell(r, iNpcId));
        if (!Number.isFinite(id)) continue;
        const type = (iType >= 0 ? cell(r, iType) : "") || "Npc";
        classRows.push({ id, rawName: cell(r, iName), type });
        if (type === "Monster") monster++;
        else npc++;
      }
      continue;
    }

    // (c) 몬스터 클래스표 — 종류는 표 자체가 정한다(NpcType 컬럼이 없다).
    if (iMonId >= 0) {
      const iName = header.indexOf("MonsterName");
      for (const r of rows) {
        const id = Number(cell(r, iMonId));
        if (!Number.isFinite(id)) continue;
        classRows.push({ id, rawName: cell(r, iName), type: "Monster" });
        monster++;
      }
      continue;
    }

    warnings.push(`${src.name}: NpcClassID·MonsterClassID·Key 중 아무 컬럼도 없어 건너뜀`);
  }

  // 이름 해석은 **모든 파일을 읽은 뒤** — 이름표가 클래스표보다 나중에 와도 되게.
  const byId = new Map<number, NpcClassEntry>();
  for (const r of classRows) {
    const name = names.get(r.rawName) || r.rawName || String(r.id);
    byId.set(r.id, { id: r.id, name, type: r.type }); // 같은 id 는 나중 것이 이긴다
  }
  const entries = [...byId.values()].sort((a, b) => a.id - b.id);

  const unresolvedList = entries.filter((e) => looksLikeKey(e.name));
  if (unresolvedList.length > 0) {
    warnings.push(
      `이름 미해결 ${unresolvedList.length}건 — ST_NpcName.csv / ST_MonsterName.csv 도 함께 선택하세요` +
        ` (예: ${unresolvedList.slice(0, 3).map((e) => `${e.id}=${e.name}`).join(", ")})`,
    );
  }
  if (entries.length === 0) warnings.push("불러온 종류가 0건입니다 — 파일이 맞는지 확인하세요.");

  return { entries, warnings, stats: { npc, monster, names: names.size, unresolved: unresolvedList.length } };
}

/** 엔트리 배열 → 카탈로그. CSV 경로가 parseNpcCatalog(JSON)과 같은 형태로 합류하는 지점. */
export function catalogFromEntries(entries: NpcClassEntry[]): NpcCatalog {
  return { entries, byId: new Map(entries.map((e) => [e.id, e])) };
}

/** 번들 seed 기반 기본 카탈로그. (seed 는 scripts/sync-npcclass.mjs 가 DT_NpcClass.csv 에서 파생) */
export function defaultNpcCatalog(): NpcCatalog {
  return parseNpcCatalog(seed);
}

/** "1002 — 거미 (Monster)" 표시용. */
export function npcClassLabel(e: NpcClassEntry): string {
  return `${e.id} — ${e.name} (${e.type})`;
}
