// 팔레트 타일 이미지 리졸버 — 프로젝트 파일 v2(base64 없음)에서 이미지를 복원한다.
//
// 3단 폴백 (MAP_PROJECT_ASSET_REFERENCE_PLAN.md §7.1):
//   1) IndexedDB 이미지 캐시(RUID 키)  → 즉시, 오프라인 OK
//   2) POST /api/images (서버가 .mod → PNG)  → 받은 것은 캐시에 적재
//   3) 실패 → null → 호출측이 폴백 스와치(fallbackColor)를 그리고 팔레트에 ⚠ 표시
//
// v1(레거시) 파일은 항목에 url(base64)이 들어 있다 — 그 경우 네트워크 없이 그대로 쓰고,
//   **캐시에 적재**해 둔다. 그러면 그 파일을 v2 로 저장한 뒤에도 이미지가 그대로 보인다.
import { fetchImages } from "./apiClient";
import { getCachedImage, putCachedImage, imageCacheKey } from "./imageCache";

/** 리졸브 대상 — 프로젝트/영속 저장에서 읽은 팔레트 항목의 최소 형태. */
export interface ResolvableTile {
  name: string;
  ruid?: string;
  url?: string; // v1 레거시 base64. 있으면 네트워크 없이 사용.
}

export interface ResolveImagesResult {
  /** 타일 인덱스 → dataURL. 못 찾은 항목은 키가 없다. */
  urls: Map<number, string>;
  fromCache: number;
  fromServer: number;
  missing: number;
}

/**
 * 팔레트 항목들의 이미지 dataURL 을 해결한다. 네트워크는 **캐시에 없고 RUID 가 있는 것만** 1회 배치.
 * 서버 조회가 통째로 실패해도(오프라인 등) 캐시분은 그대로 반환한다 — 부분 성공이 전멸보다 낫다.
 */
export async function resolveTileImages(tiles: ResolvableTile[]): Promise<ResolveImagesResult> {
  const urls = new Map<number, string>();
  let fromCache = 0;
  let fromServer = 0;

  // 1) 레거시 인라인 base64 + IDB 캐시.
  const needRuid: string[] = [];
  const idxByRuid = new Map<string, number[]>();
  await Promise.all(
    tiles.map(async (t, i) => {
      const key = imageCacheKey(t);
      if (t.url && t.url.startsWith("data:")) {
        urls.set(i, t.url);
        fromCache++;
        if (key) void putCachedImage(key, t.url); // v1 → 캐시 승격(v2 저장 후에도 보이도록)
        return;
      }
      if (key) {
        const hit = await getCachedImage(key);
        if (hit) {
          urls.set(i, hit);
          fromCache++;
          return;
        }
      }
      if (t.ruid) {
        needRuid.push(t.ruid);
        const arr = idxByRuid.get(t.ruid);
        if (arr) arr.push(i);
        else idxByRuid.set(t.ruid, [i]);
      }
    }),
  );

  // 2) 서버 배치 — 캐시 미스 & RUID 보유분만.
  if (needRuid.length > 0) {
    try {
      const images = await fetchImages([...new Set(needRuid)]);
      for (const [ruid, dataUrl] of Object.entries(images)) {
        if (!dataUrl) continue;
        for (const i of idxByRuid.get(ruid) ?? []) {
          urls.set(i, dataUrl);
          fromServer++;
        }
        void putCachedImage(imageCacheKey({ ruid })!, dataUrl);
      }
    } catch {
      // 서버/네트워크 실패 — 캐시분만 반환(폴백 스와치로 계속 작업 가능).
    }
  }

  return { urls, fromCache, fromServer, missing: tiles.length - urls.size };
}
