// object 엔티티를 게임 변환기(convert_map.cjs) 계약에 맞춰 export 형태로 보강한다.
//
// 필드는 두 부류다 — 섞으면 "무변경 저장이 게임을 바꾸는" 사고가 난다:
//   ① **저작 필드**(사람이 에디터에서 정한 값): tilesW/H · baseW/H · scaleMul · offsetX/Y · rotationDeg · blocks · layer ·
//      sortOffset · sortPadX · flipX … — export 는 **건드리지 않고 스프레드로 그대로 싣는다**. 화이트리스트로 바꾸려면 이 목록을
//      전부 넣을 것(게임 쪽이 새로 배선한 필드가 조용히 사라진다 — sortPadX 요청서 R1).
//   ② **파생 필드**(①에서 계산 — 게임 변환기가 읽는 것): scale · footprintCells · depthW/H · spriteW/H · offset · rotation.
//      항상 ①에서 **다시 만들고, 만들 값이 없으면 지운다**. 불러온 파일의 옛 값이 남으면 게임은 그 옛 값을 읽는다
//      (예: offsetX/Y 를 0 으로 되돌려도 옛 `offset` 이 남아 게임이 계속 밀린 자리에 그렸다 — 2026-09-28 실측).
//      예외는 scale 하나 — 팔레트 이미지가 없으면 계산할 수 없어 마지막 값을 둔다(없애면 게임이 네이티브 크기로 거대 배치한다).
import { footprintWH, renderWH, type MapEntity } from "../types/entity";
import { makeEntityImageLookup } from "./entityImage";
import type { PaletteTile } from "./palette";
import { blockingFootprintCells, portalCellSet } from "./walkCells";

// 게임 iso 타일 폭(px/셀). 에디터 미리보기(TW=64)와 달리 게임 빌드는 56px 타일을 쓴다.
// scale = 목표 footprint 픽셀(게임) / 스프라이트 네이티브 픽셀.
export const GAME_TILE_PX = 56;
// 에디터 화면 px(TW=64/타일) → 게임 world 단위(0.56 world/타일) 변환. offset 을 같은 시각량으로 맞춘다.
const EDITOR_TILE_PX = 64;
// offset 을 **천분의 일 world** 로 셀 때 1px 가 몇인가 = 0.56 × 1000 / 64 = 8.75 — 정수 나눗셈이라 **정확**하다.
//   ⚠ `px × (0.56/64) × 1000` 로 계산하지 말 것 — 0.56/64 가 부동소수로 부정확해서 .5 경계(짝수 px 의 절반값)에서 반올림이
//     뒤집힌다. 실측(2026-09-28): 무변경 저장이 전 맵 offset 239개를 −0.087 → −0.088 로 바꿨다(옛 저장값은 정확 산술과 670/674 일치).
const GAME_TILE_MILLI = 560; // = 게임 타일 폭 0.56 world × 1000
const OFFSET_MILLI_PER_PX = GAME_TILE_MILLI / EDITOR_TILE_PX; // 8.75 (정확)

/**
 * object 스프라이트 배율(export `scale`) — 이미지 렌더 기준폭(renderWH=baseW) × 배율(scaleMul) ÷ 네이티브 폭, 소수 셋째 자리.
 *   이미지가 없으면(naturalWidth ≤ 0) null. export 와 정렬 게이트 표시(sortGate)가 같은 값을 써야 해서 여기 한 곳에 둔다.
 *   ⚠ 식의 연산 순서를 바꾸지 말 것 — 저장된 값과 한 비트라도 달라지면 무변경 저장이 scale 을 흔든다.
 */
export function objectExportScale(e: MapEntity, naturalWidth: number): number | null {
  if (!(naturalWidth > 0)) return null;
  const [fw] = renderWH(e);
  const mul = e.scaleMul && e.scaleMul > 0 ? e.scaleMul : 1;
  const scale = ((fw * GAME_TILE_PX) / naturalWidth) * mul;
  return Math.round(scale * 1000) / 1000;
}

/** 에디터 offset(px, 오른쪽+/아래+) → export offset(world 천분의 일 반올림, 오른쪽+/위+). 둘 다 0 이면 null. */
export function exportOffset(offsetX: number | undefined, offsetY: number | undefined): [number, number] | null {
  const ox = offsetX ?? 0;
  const oy = offsetY ?? 0;
  if (ox === 0 && oy === 0) return null;
  // `|| 0` — 한 축만 0 일 때 y 부호 반전이 만드는 −0 을 +0 으로(파일엔 어차피 0 으로 써지지만 메모리 비교가 갈린다).
  const milli = (v: number) => (Math.round(v * OFFSET_MILLI_PER_PX) || 0) / 1000;
  return [milli(ox), milli(-oy)];
}

/** object 엔티티에 scale/footprintCells 부착(그 외 kind·이미지 없음은 원본 그대로). */
export function exportEntities(entities: MapEntity[], palette: PaletteTile[]): MapEntity[] {
  const imageOf = makeEntityImageLookup(palette);
  // 포탈 셀 — 오브젝트 충돌에서 제외한다(오브젝트 위에 포탈이 있으면 진입 가능해야 함). 재료는 walkCells 한 곳(남쪽 침범 판정과 공유).
  const portalCells = portalCellSet(entities);

  return entities.map((e) => {
    // npc — 스폰 경로(DT_NpcSpawn)로 가므로 object 파이프라인을 안 탄다. 그래서 **시각 계약이 통째로
    //   빠져 있었다**: 게임이 Transform.Scale=1 로 스폰 → 네이티브 픽셀 그대로 → 에디터보다 거대.
    //   실측(엘드릭 256×256, 점유 1×1): 에디터 1타일 vs 게임 약 4.6타일.
    //   → object 와 동일한 수식으로 scale 을 계산해 내보낸다(flipX 는 원본 필드 그대로 통과).
    //   ⚠ monster 는 제외 — 현재 모델에 구운 작은 스프라이트로 정상 동작 중이라 건드리면 회귀.
    if (e.kind === "npc") {
      const img = imageOf(e);
      const nw = img?.naturalWidth ?? 0;
      if (nw <= 0) return e; // 팔레트 이미지 미해석 → scale 계산 불가(검증이 경고). 원본 그대로.
      const out: MapEntity = { ...e };
      const [fw] = renderWH(e); // npc 는 baseW 가 없어 tilesW 로 폴백 = 저작 크기
      const mul = e.scaleMul && e.scaleMul > 0 ? e.scaleMul : 1;
      out.scale = Math.round(((fw * GAME_TILE_PX) / nw) * mul * 10000) / 10000;
      return out;
    }
    if (e.kind !== "object") return e;
    const out: MapEntity = { ...e };

    // 오브젝트는 기본적으로 통과 가능(충돌 없음). "충돌" 체크(blocks=true)한 것만 이동을 막는다.
    // footprint 셀 중 포탈이 놓인 셀은 충돌에서 제외 → 포탈 진입 가능. 절대 셀은 walkCells.blockingFootprintCells 가 정하고
    //   여기서는 변환기 계약대로 앵커 상대 오프셋으로만 바꾼다.
    if (e.blocks === true) {
      out.footprintCells = blockingFootprintCells(e, portalCells).map(([gx, gy]) => [gx - e.gx, gy - e.gy] as [number, number]);
    } else {
      delete out.footprintCells; // 충돌을 끈 뒤 남은 옛 목록 — 변환기는 blocks 로 거르지만 파생값은 저작 상태와 같아야 한다
    }

    // scale — 이미지 렌더 기준폭(renderWH=baseW) × 사용자 배율(scaleMul). 종횡비 보존(균일).
    //   ⚠ 점유 footprintWH 가 아닌 renderWH — W×H(점유) 조절이 게임 스프라이트 크기에 영향 없도록.
    //   이미지가 없으면 계산할 수 없어 **마지막 값을 둔다**(머리 주석 ②의 유일한 예외 — 검증이 이미지 미해석을 따로 경고한다).
    const scale = objectExportScale(e, imageOf(e)?.naturalWidth ?? 0);
    if (scale !== null) out.scale = scale;

    // depthW/depthH — 게임 y-정렬(깊이)용 **지면 점유 셀 수**. 저작값(tilesW/tilesH)을 그대로 내보낸다.
    //   계약: docs/map/depth/웹맵에디터_깊이footprint_export_요청.md (게임 파이프라인 요청)
    //   ⚠ 스프라이트에서 파생하지 말 것. 예전엔 round(baseW) 정사각으로 내보냈는데, 그건 사람이
    //   저작한 값이 아니라 스프라이트 네이티브 폭이라 정보량이 0이었다 — 가로 6칸 상점이 게임에서
    //   9×9 덩어리로 인식돼 뒤쪽 8줄을 삼키고 앞뒤 판정이 전부 틀어졌다(실측 64쌍 뒤집힘).
    //   tilesW/H = 에디터에서 사람이 그린 지면 점유 rect(= 캔버스 노란 rect). 깊이의 정답 소스다.
    //   충돌과의 분리는 여기가 아니라 `blocks` 플래그가 한다 — 나무는 tiles 2×2 + blocks=false 로
    //   "통과 가능하지만 깊이는 있음"이 된다. 그래서 depth 와 collision 을 같은 rect 로 둬도 안전.
    //   ⚠ depthW/H 는 **크기만** 이라 점유 방향(±)과 무관하다. 게임 build_map 은 이 크기 + 스프라이트
    //   발위치(offset)로 footprint 를 만들지, 에디터 앵커 방향을 쓰지 않는다. (캔버스 점유 표시는
    //   entityFootprintCells 가 앵커에서 −방향으로 뻗는다 — 스프라이트 정합용, 이 export 와 독립.)
    const [dw, dh] = footprintWH(e);
    out.depthW = dw;
    out.depthH = dh;

    // spriteW/spriteH — 스프라이트 실제 렌더 크기(효과 타일 = renderWH × scaleMul). 깊이와 무관한
    //   치수 데이터(게임이 비활성 메타로 보관 — 반투명 페이드 재도전 시 필요). 파생값이라 저작 아님.
    if (e.baseW !== undefined) {
      const [fw, fh] = renderWH(e);
      const mul = e.scaleMul && e.scaleMul > 0 ? e.scaleMul : 1;
      out.spriteW = Math.round(fw * mul * 1000) / 1000;
      out.spriteH = Math.round(fh * mul * 1000) / 1000;
    }

    // offset — 에디터 화면 px(오른쪽+/아래+) → 게임 world(오른쪽+/위+). y 부호 반전. 0 으로 되돌렸으면 **지운다**(옛 값 잔존 금지).
    const offset = exportOffset(e.offsetX, e.offsetY);
    if (offset) out.offset = offset;
    else delete out.offset;

    // rotation — 기울기(도) 그대로. build_map 이 Z축 회전(Quaternion)으로 적용. 0 으로 되돌렸으면 **지운다**.
    if (e.rotationDeg) out.rotation = e.rotationDeg;
    else delete out.rotation;

    // layer — 플레이어 대비 렌더 평면. auto(기본)=동적 z 정렬(작은 오브젝트에만 신뢰 가능).
    //   above/below=**고정 평면**(항상 위/아래). 여러 깊이 줄에 걸치는 큰 구조물(다리·큰 건물)은
    //   단일 z 로 자동정렬이 불가능하므로(데크는 플레이어 뒤, 난간은 앞 — 한 스프라이트 z 로 모순),
    //   조각별로 above/below 를 고정하는 게 프로덕션 방식이다. 예) 다리 데크=below, 가까운 난간=above.
    //   auto 는 emit 안 함(convert_map 이 auto 로 해석) → 데이터 최소화.
    if (e.layer === "above" || e.layer === "below") out.layer = e.layer;
    else delete out.layer;

    return out;
  });
}
