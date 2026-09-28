// 멀티셀 오브젝트의 **정렬 게이트** — 게임이 캐릭터 z 를 이 오브젝트 앞/뒤로 보정하는 범위(AA-4).
//   요청서: legend_of_light/docs/map/depth/260928_웹맵에디터_sortPadX_요청.md
//   게임 정본: IsoPlayerDepthLogic:SortGateSpan · 빌드 게이트 미러: scripts/depth_check.cjs deriveGeom.
import { footprintWH, type MapEntity } from "../types/entity";

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
