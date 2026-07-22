#!/usr/bin/env node
/*
 * sync-npcclass.mjs — 게임 DT_NpcClass.csv → 에디터 카탈로그 seed 자동 생성.
 *
 * 목적: DT_NpcClass.csv 를 **단일 소스**로 두고, 에디터의 `data/npcclass.seed.json`(몬스터/NPC
 *   드롭다운 + export 검증 기준)을 여기서 파생시킨다. 기획자는 CSV 만 편집하면 된다 — JSON 손편집 X.
 *
 * 실행: `npm run sync:npc` (수동) 또는 predev/prebuild 훅(자동).
 *   ⚠ 배포(vercel)에는 legend_of_light 가 없다 → CSV 미발견 시 **커밋된 seed 를 유지하고 그냥 통과**한다.
 *      따라서 로컬에서 돌려 seed 를 커밋 → 그 커밋이 배포된다. (호스팅 CSV 런타임 fetch 는 별건)
 *
 * 경로 전제: web-map-editor 와 legend_of_light 가 같은 상위 폴더의 형제 디렉터리.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)); // web-map-editor/scripts
const CSV = join(here, "..", "..", "legend_of_light", "RootDesk", "MyDesk", "DataSet", "DT_NpcClass.csv");
const OUT = join(here, "..", "data", "npcclass.seed.json");

if (!existsSync(CSV)) {
  console.warn(`[sync:npc] DT_NpcClass.csv 없음 — 커밋된 seed 유지, 건너뜀 (${CSV})`);
  process.exit(0); // 배포 환경(legend_of_light 부재)에서 정상 통과
}

const text = readFileSync(CSV, "utf8").replace(/^﻿/, "");
const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
if (lines.length === 0) {
  console.error("[sync:npc] CSV 가 비어 있음 — 중단");
  process.exit(1);
}
const header = lines[0].split(",").map((h) => h.trim());
const iId = header.indexOf("NpcClassID");
const iName = header.indexOf("NpcName");
const iType = header.indexOf("NpcType");
if (iId < 0) {
  console.error("[sync:npc] NpcClassID 컬럼 없음 — DT_NpcClass.csv 형식 아님");
  process.exit(1);
}

const entries = lines
  .slice(1)
  .map((line) => {
    const c = line.split(",");
    return {
      id: Number((c[iId] ?? "").trim()),
      name: (iName >= 0 ? c[iName] ?? "" : "").trim(),
      type: (iType >= 0 ? c[iType] ?? "Monster" : "Monster").trim() || "Monster",
    };
  })
  .filter((e) => Number.isFinite(e.id));

const out = {
  _comment:
    "⚠ 자동 생성 파일 (scripts/sync-npcclass.mjs) — DT_NpcClass.csv 에서 파생. 손편집 금지. " +
    "기획자는 게임 DT_NpcClass.csv 만 편집하고 `npm run sync:npc`(또는 dev/build)로 갱신한다. " +
    "배포 에디터는 재배포 전까지 이 seed 를 쓰므로, 즉시 반영은 'NPC목록' 버튼으로 CSV 직접 로드.",
  version: 2,
  generatedFrom: "legend_of_light/RootDesk/MyDesk/DataSet/DT_NpcClass.csv",
  entries,
};

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`[sync:npc] ${entries.length}종 → data/npcclass.seed.json (${entries.map((e) => e.id).join(",")})`);
