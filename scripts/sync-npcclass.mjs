#!/usr/bin/env node
/*
 * sync-npcclass.mjs — 게임 DataSet → 에디터 카탈로그 seed 자동 생성.
 *
 * 목적: 게임 DataSet 을 **단일 소스**로 두고, 에디터의 `data/npcclass.seed.json`(몬스터/NPC
 *   드롭다운 + export 검증 기준)을 여기서 파생시킨다. 기획자는 CSV 만 편집하면 된다 — JSON 손편집 X.
 *
 * 소스 4개 (2026-09-06 재편 반영):
 *   npc/DT_NpcClass.csv         NpcClassID,     NpcName(→ST 키)      → type "Npc"
 *   monster/DT_MonsterClass.csv MonsterClassID, MonsterName(→ST 키)  → type "Monster"
 *   locale/ST_NpcName.csv       Key → ko        (실제 표시 이름)
 *   locale/ST_MonsterName.csv   Key → ko
 *
 *   ⚠ 예전엔 DataSet/DT_NpcClass.csv 한 장에 NPC·몬스터가 같이 있고 `NpcType` 컬럼으로 갈렸으며
 *     `NpcName` 이 표시 이름 그 자체였다. 지금은 (a) 테이블이 둘로 쪼개졌고 (b) 이름이 로컬라이즈
 *     테이블로 빠져 CSV 에는 **키**(`NPCNAME_101`)만 남았다. 셋 중 하나라도 옛 가정으로 읽으면
 *     드롭다운에 `NPCNAME_101` 같은 키가 뜨거나 NPC 가 전부 Monster 로 분류된다.
 *
 * 실행: `npm run sync:npc` (수동) 또는 predev/prebuild 훅(자동).
 *   ⚠ 배포(vercel)에는 legend_of_light 가 없다 → 소스 미발견 시 **커밋된 seed 를 유지하고 그냥 통과**한다.
 *      따라서 로컬에서 돌려 seed 를 커밋 → 그 커밋이 배포된다. (호스팅 CSV 런타임 fetch 는 별건)
 *
 * 경로: MSW_GAME_ROOT(.env.local 지원) 우선. 미설정 시 형제 legend_of_light 사용.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
import nextEnv from "@next/env";

const here = dirname(fileURLToPath(import.meta.url)); // web-map-editor/scripts
const ROOT = resolve(here, "..");
// predev/prebuild 는 Next 실행 전이므로 환경 파일도 여기서 먼저 읽는다.
nextEnv.loadEnvConfig(ROOT, process.env.npm_lifecycle_event === "predev");
const configuredRoot = process.env.MSW_GAME_ROOT?.trim();
const GAME_ROOT = resolve(ROOT, configuredRoot || "../legend_of_light");
const DATASET = join(GAME_ROOT, "RootDesk", "MyDesk", "DataSet");
const OUT = join(here, "..", "data", "npcclass.seed.json");

/**
 * 후보 경로 중 존재하는 첫 파일. 게임 DataSet 이 도메인 폴더로 재편되면서(npc/ monster/ locale/ …)
 *   예전 평면 경로가 깨졌는데, 미발견이 배포 환경의 **정상 상태**라 exit 0 으로 조용히 통과하게 돼
 *   있어 로컬에서도 한동안 아무도 모르게 동기화가 죽어 있었다. → 경로를 하나로 못박지 않는다.
 */
const pick = (...rel) => rel.map((r) => join(DATASET, ...r)).find((p) => existsSync(p)) ?? null;

const NPC_CSV = pick(["npc", "DT_NpcClass.csv"], ["DT_NpcClass.csv"]);
const MON_CSV = pick(["monster", "DT_MonsterClass.csv"], ["DT_MonsterClass.csv"]);
const NPC_ST = pick(["locale", "ST_NpcName.csv"], ["ST_NpcName.csv"]);
const MON_ST = pick(["locale", "ST_MonsterName.csv"], ["ST_MonsterName.csv"]);

// 명시한 로컬 경로가 잘못됐을 때 오래된 seed 로 성공한 척하지 않는다.
if (configuredRoot && (!NPC_CSV || !MON_CSV || !NPC_ST || !MON_ST)) {
  console.error("[sync:npc] MSW_GAME_ROOT 에 NPC/몬스터/이름 CSV 4개가 모두 필요합니다.");
  console.error("           기준 경로: " + DATASET);
  process.exit(1);
}

console.log("[sync:npc] 게임 경로: " + GAME_ROOT);

if (!NPC_CSV && !MON_CSV) {
  // ⚠ 여기서 죽으면 안 된다 — 배포(vercel)에는 legend_of_light 가 아예 없다. 커밋된 seed 로 간다.
  console.warn("[sync:npc] 게임 DataSet 없음 — 커밋된 seed 유지, 건너뜀");
  console.warn(`           기준 경로: ${DATASET}`);
  process.exit(0);
}

/** CSV → {header:string[], rows:string[][]}. BOM·CRLF·빈 줄 처리. */
function readCsv(path) {
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { header: [], rows: [] };
  return {
    header: lines[0].split(",").map((h) => h.trim()),
    rows: lines.slice(1).map((l) => l.split(",")),
  };
}

/** ST_*.csv (Key,Source,Note,ko,en) → Map<key, 표시이름>. ko 우선, 없으면 Source. */
function readStringTable(path) {
  const map = new Map();
  if (!path) return map;
  const { header, rows } = readCsv(path);
  const iKey = header.indexOf("Key");
  const iKo = header.indexOf("ko");
  const iSrc = header.indexOf("Source");
  if (iKey < 0) return map;
  for (const c of rows) {
    const key = (c[iKey] ?? "").trim();
    if (!key) continue;
    const name = (iKo >= 0 ? (c[iKo] ?? "").trim() : "") || (iSrc >= 0 ? (c[iSrc] ?? "").trim() : "");
    if (name) map.set(key, name);
  }
  return map;
}

/**
 * 클래스 테이블 → seed 엔트리. 이름 셀이 ST 키면 로컬라이즈 테이블로 해석하고, 아니면
 *   그 값을 그대로 쓴다(구 스키마 하위호환 — 이름이 CSV 에 직접 있던 시절).
 */
function collect(csvPath, idCol, nameCol, type, strings) {
  if (!csvPath) return [];
  const { header, rows } = readCsv(csvPath);
  const iId = header.indexOf(idCol);
  if (iId < 0) {
    console.error(`[sync:npc] ${idCol} 컬럼 없음 — ${csvPath} 형식 아님`);
    process.exit(1);
  }
  const iName = header.indexOf(nameCol);
  const out = [];
  for (const c of rows) {
    const id = Number((c[iId] ?? "").trim());
    if (!Number.isFinite(id)) continue;
    const raw = (iName >= 0 ? (c[iName] ?? "") : "").trim();
    out.push({ id, name: strings.get(raw) ?? raw, type });
  }
  return out;
}

const entries = [
  ...collect(NPC_CSV, "NpcClassID", "NpcName", "Npc", readStringTable(NPC_ST)),
  ...collect(MON_CSV, "MonsterClassID", "MonsterName", "Monster", readStringTable(MON_ST)),
].sort((a, b) => a.id - b.id);

if (entries.length === 0) {
  console.error("[sync:npc] 엔트리 0건 — 소스가 비었거나 컬럼명이 바뀌었다. 중단(기존 seed 보존)");
  process.exit(1);
}

// 표시 이름을 못 찾은 항목 경고 — 드롭다운에 ST 키(NPCNAME_101)가 그대로 뜨는 상태.
const unresolved = entries.filter((e) => /^[A-Z]+NAME_\d+$/.test(e.name));
if (unresolved.length > 0) {
  console.warn(`[sync:npc] ⚠ 이름 미해결 ${unresolved.length}건 — locale/ST_*Name.csv 에 행이 없다:`);
  console.warn(`           ${unresolved.map((e) => `${e.id}(${e.name})`).join(", ")}`);
}

const rel = (p) => (p ? p.slice(p.indexOf("legend_of_light")).split(sep).join("/") : null);
const out = {
  _comment:
    "⚠ 자동 생성 파일 (scripts/sync-npcclass.mjs) — 게임 DataSet 에서 파생. 손편집 금지. " +
    "기획자는 게임 CSV 만 편집하고 `npm run sync:npc`(또는 dev/build)로 갱신한다. " +
    "배포 에디터는 재배포 전까지 이 seed 를 쓰므로, 즉시 반영은 'NPC목록' 버튼으로 CSV 직접 로드.",
  version: 3,
  generatedFrom: [rel(NPC_CSV), rel(MON_CSV), rel(NPC_ST), rel(MON_ST)].filter(Boolean),
  entries,
};

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
const npcN = entries.filter((e) => e.type === "Npc").length;
console.log(`[sync:npc] ${entries.length}종 (NPC ${npcN} · 몬스터 ${entries.length - npcN}) → data/npcclass.seed.json`);
