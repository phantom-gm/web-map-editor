// 에디터 밖에서 고친 **파생값** 감지 — 저장이 게임 데이터를 조용히 되돌리는 것을 막는다(sortPadX 요청서 R1 과 같은 축).
//
// 게임이 읽는 파일(legend_of_light/map/<맵>.json)은 이 에디터의 프로젝트 파일 그 자체라, 게임 쪽이 json 의 파생 필드
// (depthW·offset·scale …)를 직접 고치는 일이 생긴다. 에디터는 저장할 때 파생 필드를 저작 필드에서 **다시 만들므로**
// 그 손수정은 저장 한 번에 되돌아간다 — 에러 없이, 다음 빌드에서 게임이 바뀐다. 실측(2026-09-28):
//   · ferendelmotel 판매대 3 — depthW/H 4(게임 커밋 7af4b946 "플레이어까지 가리던 원인")인데 지면 점유는 1×1 → 저장하면 1 로
//   · ferenforest4 침엽수 — offset 이 10px 값인데 Y 이동 15 / scale 이 배율 0.2·0.15 값인데 배율 0.25 → 저장하면 커진다
// 그래서 **파일을 연 순간**의 차이를 기억해 두고(loadDrift), 저장 직전에 아직 바뀌게 될 것만 확인받는다(pendingDrift).
//   열 때 기준으로 대조하므로 사용자가 에디터에서 직접 바꾼 값은 경고하지 않는다.
import { entityLabel, renderWH, type MapEntity } from "../types/entity";
import { exportEntities, GAME_TILE_PX } from "./entityExport";
import { makeEntityImageLookup } from "./entityImage";
import type { PaletteTile } from "./palette";

/** 게임 변환기가 읽는 오브젝트 파생 필드. npc scale 은 뺀다 — 런타임이 DT_NpcSpawn.Scale 을 적용하지 않는다(게임 MS-22). */
export const DRIFT_FIELDS = ["depthW", "depthH", "offset", "rotation", "scale", "footprintCells"] as const;
export type DriftField = (typeof DRIFT_FIELDS)[number];

export interface DriftItem {
  id: string;
  label: string; // entityLabel — 사람에게 보일 위치·이름
  field: DriftField;
  stored: unknown; // 파일에 있던 값(게임이 지금 쓰는 값)
  next: unknown; // 저장하면 써질 값(undefined = 필드가 사라짐)
  keep: string; // 게임 값을 유지하려면 바꿀 저작값
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const key = (d: Pick<DriftItem, "id" | "field" | "stored">) => `${d.id}\u0000${d.field}\u0000${JSON.stringify(d.stored)}`;

/** 게임 값을 유지하려면 어떤 저작값으로 바꾸면 되는가 — 파생 산식의 역. */
function keepHint(e: MapEntity, field: DriftField, stored: unknown, naturalWidth: number): string {
  switch (field) {
    case "depthW":
    case "depthH":
      return `지면 점유 ${field === "depthW" ? "W" : "H"} 를 ${String(stored)} 로${e.blocks === true ? "(충돌 범위도 같이 바뀝니다)" : ""}`;
    case "offset": {
      const [x, y] = Array.isArray(stored) ? (stored as number[]) : [0, 0];
      // exportOffset 의 역 — 1px = 8.75 천분의 일 world, y 부호 반전.
      return `X/Y 이동을 (${Math.round((x * 1000) / 8.75)}, ${Math.round((-y * 1000) / 8.75)})px 로`;
    }
    case "rotation":
      return `기울기를 ${String(stored)}° 로`;
    case "scale": {
      const [fw] = renderWH(e);
      const perMul = naturalWidth > 0 ? (fw * GAME_TILE_PX) / naturalWidth : 0; // 배율 1 일 때의 scale(반올림 전)
      return perMul > 0 && typeof stored === "number" ? `배율을 ${Math.round((stored / perMul) * 1000) / 1000} 로` : "배율을 게임 값에 맞게";
    }
    case "footprintCells":
      return "충돌 칸이 저작 점유 기준으로 다시 계산됩니다 — 지면 점유·충돌 설정을 확인";
  }
}

/**
 * 지금 저장하면 파생 필드가 파일 값과 달라지는 항목 — 오브젝트만. 파일에 없던 필드(옛 파일 이관)는 손수정이 아니라 뺀다.
 * scale 은 팔레트 이미지가 있을 때만 다시 계산되므로(없으면 export 가 마지막 값을 둔다) 그때만 잡힌다.
 */
export function exportDrift(entities: MapEntity[], palette: PaletteTile[]): DriftItem[] {
  const out = exportEntities(entities, palette);
  const imageOf = makeEntityImageLookup(palette);
  const items: DriftItem[] = [];
  entities.forEach((e, i) => {
    if (e.kind !== "object") return;
    const ex = out[i] as unknown as Record<string, unknown>;
    const src = e as unknown as Record<string, unknown>;
    for (const field of DRIFT_FIELDS) {
      const stored = src[field];
      if (stored === undefined) continue;
      const next = ex[field];
      if (same(stored, next)) continue;
      items.push({ id: e.id, label: entityLabel(e), field, stored, next, keep: keepHint(e, field, stored, imageOf(e)?.naturalWidth ?? 0) });
    }
  });
  return items;
}

/**
 * 저장 직전 — 파일을 열 때 있던 차이(loaded) 중 **아직** 바뀌게 될 것만. 사용자가 저작값을 맞춰 게임 값이 유지되면 빠지고,
 * 열 때 없던 차이(사용자가 에디터에서 직접 바꾼 값)는 애초에 대상이 아니다.
 */
export function pendingDrift(loaded: DriftItem[], entities: MapEntity[], palette: PaletteTile[]): DriftItem[] {
  if (loaded.length === 0) return [];
  const atLoad = new Set(loaded.map(key));
  return exportDrift(entities, palette).filter((d) => atLoad.has(key(d)));
}

/** 저장 확인창 문구. */
export function driftMessage(items: DriftItem[], max = 10): string {
  const fmt = (v: unknown) => (v === undefined ? "(사라짐)" : JSON.stringify(v));
  const lines = items.slice(0, max).map((d) => `• ${d.label}: ${d.field} ${fmt(d.stored)} → ${fmt(d.next)} — 유지하려면 ${d.keep}`);
  const more = items.length > max ? `\n…외 ${items.length - max}건` : "";
  return (
    `에디터 밖에서 고친 값 ${items.length}건 — 저장하면 에디터 저작값 기준으로 바뀌어 다음 게임 빌드에 반영됩니다.\n` +
    `게임 값을 유지하려면 취소하고 해당 오브젝트의 저작값을 바꾸세요:\n${lines.join("\n")}${more}`
  );
}
