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
// 에디터 화면 px(TW=64/타일) → 게임 world 단위(0.56 world/타일) 변환. offset 을 같은 시각량으로 맞춘다.
const EDITOR_TILE_PX = 64;
const GAME_TILE_WORLD = 0.56;
const PX_TO_WORLD = GAME_TILE_WORLD / EDITOR_TILE_PX; // ≈ 0.00875

/** object 엔티티에 scale/footprintCells 부착(그 외 kind·이미지 없음은 원본 그대로). */
export function exportEntities(entities: MapEntity[], palette: PaletteTile[]): MapEntity[] {
  const imageOf = makeEntityImageLookup(palette);
  // 포탈 셀 — 오브젝트 충돌에서 제외한다(오브젝트 위에 포탈이 있으면 진입 가능해야 함).
  const portalCells = new Set<string>();
  for (const e of entities) if (e.kind === "portal") portalCells.add(`${e.gx},${e.gy}`);

  return entities.map((e) => {
    if (e.kind !== "object") return e;
    const out: MapEntity = { ...e };

    // 오브젝트는 기본적으로 통과 가능(충돌 없음). "충돌" 체크(blocks=true)한 것만 이동을 막는다.
    // footprint 셀 중 포탈이 놓인 셀은 충돌에서 제외 → 포탈 진입 가능.
    if (e.blocks === true) {
      out.footprintCells = entityFootprintCells(e)
        .filter(([gx, gy]) => !portalCells.has(`${gx},${gy}`))
        .map(([gx, gy]) => [gx - e.gx, gy - e.gy] as [number, number]);
    }

    // scale — 에디터가 footprint 폭에 맞춘 자동배율 × 사용자 배율(scaleMul). 종횡비 보존(균일).
    const img = imageOf(e);
    const nw = img?.naturalWidth ?? 0;
    if (nw > 0) {
      const [fw] = footprintWH(e);
      const mul = e.scaleMul && e.scaleMul > 0 ? e.scaleMul : 1;
      const scale = ((fw * GAME_TILE_PX) / nw) * mul;
      out.scale = Math.round(scale * 1000) / 1000;
    }

    // offset — 에디터 화면 px(오른쪽+/아래+) → 게임 world(오른쪽+/위+). y 부호 반전.
    const oxPx = e.offsetX ?? 0, oyPx = e.offsetY ?? 0;
    if (oxPx !== 0 || oyPx !== 0) {
      out.offset = [
        Math.round(oxPx * PX_TO_WORLD * 1000) / 1000,
        Math.round(-oyPx * PX_TO_WORLD * 1000) / 1000,
      ];
    }

    // rotation — 기울기(도) 그대로. build_map 이 Z축 회전(Quaternion)으로 적용.
    if (e.rotationDeg && e.rotationDeg !== 0) out.rotation = e.rotationDeg;

    return out;
  });
}
