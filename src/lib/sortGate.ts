// 멀티셀 오브젝트의 **정렬 게이트** — 게임이 캐릭터 z 를 이 오브젝트 앞/뒤로 보정하는 범위(AA-4).
//   요청서: legend_of_light/docs/map/depth/260928_웹맵에디터_sortPadX_요청.md
//   게임 정본: IsoPlayerDepthLogic:SortGateSpan(가로) + Load 의 게이트 사각형(세로) · 빌드 게이트 미러: scripts/depth_check.cjs deriveGeom.
//
// 게이트 경계 안 칸의 캐릭터는 건물 앞으로 당겨지고(수 칸 앞으로 점프) 바로 바깥 칸은 원래 자리라, 경계가 **걷는 길**을
//   지나면 경계 안 뒤 칸 캐릭터가 경계 밖 앞 칸 캐릭터를 통째로 덮는다(여관 입구 신고). 경계는 없앨 수 없고 옮길 수만 있다 —
//   sortPadX 가 그 손잡이다. 캔버스는 선택한 오브젝트의 이 경계를 세로선 두 개로 보여 준다(요청서 R3).
import { TH, TW } from "./grid";
import { GAME_TILE_PX, objectExportScale } from "./entityExport";
import { footprintWH, renderWH, type MapEntity } from "../types/entity";

/**
 * 게이트가 있는 오브젝트인가 — auto 레이어(above/below 는 고정 평면이라 깊이 메타가 없다) · 지면 점유 멀티셀
 * (1×1 은 게임 캐시에서 빠진다 — z 비교와 동치라 제약이 필요 없다). sortPadX 는 여기서만 의미가 있다.
 */
export function isSortGateTarget(e: MapEntity): boolean {
  if (e.kind !== "object") return false;
  if (e.layer === "above" || e.layer === "below") return false;
  const [w, h] = footprintWH(e);
  return w > 1 || h > 1;
}

/** 에디터 px(zoom 1), **앵커 셀 중심 기준**. x 는 오른쪽+, y 는 화면 아래+. */
export interface SortGatePx {
  x0: number; // 게이트 왼쪽 경계(sortPadX 포함)
  x1: number; // 게이트 오른쪽 경계
  baseX0: number; // 패딩 0 일 때의 경계 — 얼마나 옮겼는지 비교용
  baseX1: number;
  y0: number; // 게이트 위쪽(화면)
  y1: number; // 게이트 아래쪽(화면)
  pad: number; // 적용된 패딩(음수·숫자 아님 → 0 — 런타임과 같다)
}

/**
 * 정렬 게이트 사각형. 런타임 산식을 에디터 px 로 옮긴 것이다(게임 1u = 에디터 25px — 타일 2.56u = 64px):
 *   게임  halfW = BaseW × 0.64 × ScaleX / 2,  ScaleX = scale × (32/7)       → 에디터 px = baseW × TW × scale × (TW/56) / 2
 *   게임  가로 = pos.x ± (halfW + TILE_W × (0.5 + pad))                      → 에디터 = offsetX ± (halfW + TW × (0.5 + pad))
 *   게임  세로 = pos.y ∓ (halfH + TILE_H / 2)  (pos = 스프라이트 바닥 중앙)  → 에디터 = offsetY ± (halfH + TH / 2)
 * scale 은 export 가 쓰는 값과 같아야 한다 — 이미지가 있으면 objectExportScale, 없으면 파일의 scale(게임이 지금 쓰는 값),
 *   그것도 없으면 네이티브 가정(56/64 × 배율). offset 은 export 의 천분의 일 반올림을 따르지 않는다(최대 0.06px — 안 보인다).
 * 대상이 아니면(1×1·above/below·오브젝트 아님) null.
 */
export function sortGatePx(e: MapEntity, naturalWidth: number): SortGatePx | null {
  if (!isSortGateTarget(e)) return null;
  const mul = e.scaleMul && e.scaleMul > 0 ? e.scaleMul : 1;
  const fileScale = (i: 0 | 1) => (Array.isArray(e.scale) ? e.scale[i] : e.scale);
  const exact = objectExportScale(e, naturalWidth);
  const sx = exact ?? fileScale(0) ?? (GAME_TILE_PX / TW) * mul;
  const sy = exact ?? fileScale(1) ?? (GAME_TILE_PX / TW) * mul;
  const [bw, bh] = renderWH(e);
  const unitPx = TW * (TW / GAME_TILE_PX); // scale 1 · BaseW 1 인 스프라이트의 에디터 px 폭
  const halfW = (bw * unitPx * sx) / 2;
  const halfH = (bh * unitPx * sy) / 2;
  const raw = e.sortPadX ?? 0;
  const pad = Number.isFinite(raw) && raw > 0 ? raw : 0;
  const cx = e.offsetX ?? 0;
  const by = e.offsetY ?? 0;
  const half = halfW + TW * (0.5 + pad);
  const baseHalf = halfW + TW * 0.5;
  const hy = halfH + TH / 2;
  return { x0: cx - half, x1: cx + half, baseX0: cx - baseHalf, baseX1: cx + baseHalf, y0: by - hy, y1: by + hy, pad };
}
