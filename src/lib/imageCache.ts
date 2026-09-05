// 타일 이미지 로컬 캐시 — IndexedDB(idb-keyval), **RUID 단위**.
//
// 왜 RUID 단위인가: 프로젝트 파일(map/*.json)에서 base64 를 뺀 뒤(v2), 이미지의 진실원은 MSW 그룹
//   스토리지다. 로컬 캐시는 그 사본이고, RUID 는 내용-불변 식별자라 **맵이 달라도 같은 항목을 공유**한다
//   (구: 맵마다 base64 사본 → 7개 맵에서 17.3MB 중복). 캐시는 언제 지워도 /api/images 로 복구된다.
//
// 계약: MAP_PROJECT_ASSET_REFERENCE_PLAN.md §7.1
import { get as idbGet, set as idbSet, delMany, keys as idbKeys } from "idb-keyval";

const PREFIX = "wme-img:";

/**
 * 캐시 키. RUID 가 있으면 그것(전역 유일·맵 간 공유), 없으면 로컬 전용 이름 키.
 *   RUID 없는 타일 = 아직 스토리지에 업로드되지 않은 신규 타일 → 이 PC 에서만 복원 가능하다.
 *   (업로드해서 RUID 를 받으면 그때부터 어느 PC 에서나 복원된다.)
 */
export function imageCacheKey(t: { ruid?: string; name?: string }): string | null {
  if (t.ruid) return PREFIX + t.ruid;
  if (t.name) return PREFIX + "name:" + t.name;
  return null;
}

/** 캐시된 dataURL. 없거나 IDB 실패면 null(호출측이 네트워크로 폴백). */
export async function getCachedImage(key: string): Promise<string | null> {
  try {
    return (await idbGet<string>(key)) ?? null;
  } catch {
    return null;
  }
}

/** dataURL 캐시. 실패는 무시 — 캐시는 최적화지 진실원이 아니다. */
export async function putCachedImage(key: string, dataUrl: string): Promise<void> {
  try {
    await idbSet(key, dataUrl);
  } catch {
    /* 용량 초과 등 — 다음에 다시 받으면 된다 */
  }
}

/** 캐시 전체 비우기(문제 진단용). 팔레트 메타는 건드리지 않는다. */
export async function clearImageCache(): Promise<number> {
  try {
    const all = await idbKeys();
    const mine = all.filter((k): k is string => typeof k === "string" && k.startsWith(PREFIX));
    await delMany(mine);
    return mine.length;
  } catch {
    return 0;
  }
}
