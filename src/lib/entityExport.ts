// object 엔티티를 게임 변환기(convert_map.cjs) 계약에 맞춰 export 형태로 보강한다.
//  - scale: 스프라이트 배율 (게임이 네이티브 크기로 배치해 거대해지는 버그 방지)
//  - footprintCells: 충돌(blocks) 시 앵커 상대 오프셋 목록
// 라이브 상태(store)는 blocks 만 갖고, scale/footprintCells 는 tilesW/tilesH·이미지에서 export 시 계산.
import { entityFootprintCells, renderWH, type MapEntity } from "../types/entity";
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

    // scale — 이미지 렌더 기준폭(renderWH=baseW) × 사용자 배율(scaleMul). 종횡비 보존(균일).
    //   ⚠ 점유 footprintWH 가 아닌 renderWH — W×H(점유) 조절이 게임 스프라이트 크기에 영향 없도록.
    const img = imageOf(e);
    const nw = img?.naturalWidth ?? 0;
    if (nw > 0) {
      const [fw] = renderWH(e);
      const mul = e.scaleMul && e.scaleMul > 0 ? e.scaleMul : 1;
      const scale = ((fw * GAME_TILE_PX) / nw) * mul;
      out.scale = Math.round(scale * 1000) / 1000;
    }

    // depthW/depthH — y-정렬(깊이) 전용 footprint(월드 셀). 충돌 footprintCells(tilesW/H)와 분리.
    //   버그: 깊이 컷라인이 점유(tilesW/H=1×1)를 써서 큰 건물의 정렬선이 한 셀뿐 → 시각 베이스
    //   위/옆에 선 플레이어가 "뒤"로 오판돼 건물에 가려짐. 해법: 깊이 footprint 를 시각 베이스에
    //   맞춘다. 에디터 iso 에선 baseW(=네이티브폭/64) ≈ 정사각 베이스의 월드 폭(셀)이므로
    //   round(baseW) 를 W·H 로 쓴다(정사각 가정). baseH 는 지붕·벽 포함 전체 높이라 지면 깊이가
    //   아니어서 안 쓴다. 앵커 기준 뒤(북)로 뻗는 배치는 build_map 이 map-space 에서 처리.
    //   ⚠ baseW 보유(신규 export) object 만 — 레거시/몬스터/NPC 는 미emit(build_map 이 현행 유지).
    if (e.baseW !== undefined) {
      const [fw, fh] = renderWH(e);
      const d = Math.max(1, Math.round(fw));
      out.depthW = d;
      out.depthH = d;
      // spriteW/spriteH — 페이드 (B) 겹침 rect 용 실제 렌더 크기(효과 타일 = renderWH × scaleMul).
      //   depthW(정수 정사각)와 달리 float·비정사각 — 스프라이트 world 박스를 정확히 표현.
      const mul = e.scaleMul && e.scaleMul > 0 ? e.scaleMul : 1;
      out.spriteW = Math.round(fw * mul * 1000) / 1000;
      out.spriteH = Math.round(fh * mul * 1000) / 1000;
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

    // layer — export 계약: 미지정=auto(동적 기본). above/below 만 명시 emit,
    //   auto·미설정은 생략(convert_map 이 누락을 auto 로 해석). ⚠ below 를 생략하면 게임서 auto 가 됨.
    if (e.layer === "above" || e.layer === "below") out.layer = e.layer;
    else delete out.layer;

    return out;
  });
}
