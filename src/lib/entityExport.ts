// object 엔티티를 게임 변환기(convert_map.cjs) 계약에 맞춰 export 형태로 보강한다.
//  - scale: 스프라이트 배율 (게임이 네이티브 크기로 배치해 거대해지는 버그 방지)
//  - footprintCells: 충돌(blocks) 시 앵커 상대 오프셋 목록
// 라이브 상태(store)는 blocks 만 갖고, scale/footprintCells 는 tilesW/tilesH·이미지에서 export 시 계산.
import { entityFootprintCells, footprintWH, type MapEntity } from "../types/entity";
import { makeEntityImageLookup } from "./entityImage";
import type { PaletteTile } from "./palette";

// 게임 iso 타일 폭(px/셀). 에디터 미리보기(TW=64)와 달리 게임 빌드는 56px 타일을 쓴다.
// scale = 목표 footprint 픽셀(게임) / 스프라이트 네이티브 픽셀.
const GAME_TILE_PX = 56;

/** object 엔티티에 scale/footprintCells 부착(그 외 kind·이미지 없음은 원본 그대로). */
export function exportEntities(entities: MapEntity[], palette: PaletteTile[]): MapEntity[] {
  const imageOf = makeEntityImageLookup(palette);
  return entities.map((e) => {
    if (e.kind !== "object") return e;
    const out: MapEntity = { ...e };

    // 충돌 footprint — blocks 일 때만. 앵커(gx,gy) 기준 상대 오프셋.
    if (e.blocks) {
      out.footprintCells = entityFootprintCells(e).map(([gx, gy]) => [gx - e.gx, gy - e.gy] as [number, number]);
    }

    // scale — 에디터가 footprint 폭에 맞춰 축소한 배율을 게임 타일 기준으로. 종횡비 보존(균일).
    const img = imageOf(e);
    const nw = img?.naturalWidth ?? 0;
    if (nw > 0) {
      const [fw] = footprintWH(e);
      const scale = (fw * GAME_TILE_PX) / nw; // 폭 기준 균일 배율(높이는 종횡비 유지)
      out.scale = Math.round(scale * 1000) / 1000;
    }
    return out;
  });
}
