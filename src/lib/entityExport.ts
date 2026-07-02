// object 엔티티를 게임 변환기(convert_map.cjs) 계약에 맞춰 export 형태로 보강한다.
//  - scale: 스프라이트 배율 (게임이 네이티브 크기로 배치해 거대해지는 버그 방지)
//  - footprintCells: 충돌(blocks) 시 앵커 상대 오프셋 목록
// 라이브 상태(store)는 blocks 만 갖고, scale/footprintCells 는 tilesW/tilesH·이미지에서 export 시 계산.
import { entityFootprintCells, footprintWH, type MapEntity } from "../types/entity";
import type { PaletteTile } from "./palette";

// 게임 iso 타일 폭(px/셀). 에디터 미리보기(TW=64)와 달리 게임 빌드는 56px 타일을 쓴다.
// scale = 목표 footprint 픽셀(게임) / 스프라이트 네이티브 픽셀.
const GAME_TILE_PX = 56;

/** ruid 우선, name 차선으로 팔레트 이미지의 네이티브 [w,h] 조회 맵. */
function nativeSizeLookup(palette: PaletteTile[]) {
  const byRuid = new Map<string, [number, number]>();
  const byName = new Map<string, [number, number]>();
  for (const t of palette) {
    const w = t.img?.naturalWidth ?? 0;
    const h = t.img?.naturalHeight ?? 0;
    if (w <= 0 || h <= 0) continue;
    if (t.ruid) byRuid.set(t.ruid, [w, h]);
    if (t.name) byName.set(t.name, [w, h]);
  }
  return (e: MapEntity): [number, number] | null =>
    (e.ruid ? byRuid.get(e.ruid) : undefined) ?? (e.name ? byName.get(e.name) : undefined) ?? null;
}

/** object 엔티티에 scale/footprintCells 부착(그 외 kind·이미지 없음은 원본 그대로). */
export function exportEntities(entities: MapEntity[], palette: PaletteTile[]): MapEntity[] {
  const nativeOf = nativeSizeLookup(palette);
  return entities.map((e) => {
    if (e.kind !== "object") return e;
    const out: MapEntity = { ...e };

    // 충돌 footprint — blocks 일 때만. 앵커(gx,gy) 기준 상대 오프셋.
    if (e.blocks) {
      out.footprintCells = entityFootprintCells(e).map(([gx, gy]) => [gx - e.gx, gy - e.gy] as [number, number]);
    }

    // scale — 에디터가 footprint 폭에 맞춰 축소한 배율을 게임 타일 기준으로. 종횡비 보존(균일).
    const nat = nativeOf(e);
    if (nat) {
      const [fw] = footprintWH(e);
      const scale = (fw * GAME_TILE_PX) / nat[0]; // 폭 기준 균일 배율(높이는 종횡비 유지)
      out.scale = Math.round(scale * 1000) / 1000;
    }
    return out;
  });
}
