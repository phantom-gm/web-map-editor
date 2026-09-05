import type { RegStatus } from "./registry";
import { imageCacheKey, putCachedImage } from "./imageCache";
import { resolveTileImages } from "./imageResolver";

// 팔레트 타일 — **메모리 표현**. name = 파일명(확장자 제거), url = dataURL(표시/업로드),
// img = 캔버스 렌더용 HTMLImageElement(로드 완료된 것).
//   ⚠ url 은 **직렬화되지 않는다**(StoredTile 참조). 프로젝트 파일에는 ruid + px 만 들어간다.
export interface PaletteTile {
  name: string;
  url: string; // dataURL ("" = 이미지 미해결 → 폴백색 스와치). 메모리/IDB 캐시 전용.
  img: HTMLImageElement | null;
  hash?: string | null; // PNG 바이트 sha256 (레지스트리 해시 매칭용; import 시엔 없음)
  ruid?: string; // 레지스트리 판정 결과 RUID — 이미지의 진실원 식별자
  px?: [number, number]; // PNG 네이티브 픽셀 치수 — 파이프라인 배율 계산이 base64 대신 이걸 쓴다
  regStatus?: RegStatus; // registered | renamed | conflict | new
  category?: string; // 팔레트 분류용 — 스토리지=subcategory, 폴더 업로드=폴더명, 그 외="기타"
}

/** img 에서 픽셀 치수 추출. 로드 실패(null)면 undefined — 파이프라인이 레거시 폴백을 쓴다. */
function pxOf(img: HTMLImageElement | null): [number, number] | undefined {
  if (!img || !img.naturalWidth || !img.naturalHeight) return undefined;
  return [img.naturalWidth, img.naturalHeight];
}

export const DEFAULT_CATEGORY = "기타";

/** 폴더 업로드 시 파일이 속한 폴더명을 카테고리로. webkitRelativePath 없으면 기본값. */
function categoryFromFile(f: File): string {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || "";
  const parts = rel.split("/").filter(Boolean);
  // "folder/sub/tile.png" → 직속 폴더 "sub". 경로 없으면 기본 카테고리.
  return parts.length >= 2 ? parts[parts.length - 2] : DEFAULT_CATEGORY;
}

/** PNG 미보유 타일/셀의 대체 색(palette idx 기반). 캔버스·팔레트 스와치 공용. */
export const fallbackColor = (idx: number) => `hsl(${(idx * 47) % 360}deg 45% 42%)`;

function readDataURL(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** 파일 바이트의 sha256 hex. CLI(build_tile_registry.cjs)의 node:crypto sha256 과 동일. */
async function hashFile(f: File): Promise<string | null> {
  if (!crypto?.subtle) return null;
  try {
    const buf = await f.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/**
 * 리소스 스토리지 항목 → PaletteTile[]. 썸네일 URL 에서 이미지를 로드(가능하면)하고
 * ruid/regStatus 를 미리 채워 반환한다(이미 등록된 자산이므로 regStatus="registered").
 * 캔버스는 픽셀을 되읽지 않으므로 cross-origin 타인트는 문제되지 않는다 → crossOrigin 미설정.
 */
export async function tilesFromResources(
  items: Array<{ ruid: string; name: string; subcategory?: string; imageUrl: string | null }>,
): Promise<PaletteTile[]> {
  return Promise.all(
    items.map(async (it) => {
      const url = it.imageUrl ?? "";
      const img = url ? await loadImage(url).catch(() => null) : null;
      // 스토리지에서 온 이미지는 곧 RUID 캐시의 정본 — 받아온 김에 적재해 다음 열기부터 무네트워크.
      if (url && it.ruid) void putCachedImage(imageCacheKey({ ruid: it.ruid })!, url);
      return {
        name: it.name,
        url,
        img,
        hash: null,
        ruid: it.ruid,
        px: pxOf(img),
        regStatus: "registered" as RegStatus,
        category: it.subcategory || DEFAULT_CATEGORY,
      } satisfies PaletteTile;
    }),
  );
}

/** File[] → PaletteTile[]. img 로드 + 콘텐츠 해시까지 await 후 반환. 카테고리=속한 폴더명. */
export async function loadTiles(files: File[]): Promise<PaletteTile[]> {
  const out: PaletteTile[] = [];
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    const url = await readDataURL(f);
    const img = await loadImage(url).catch(() => null);
    const hash = await hashFile(f);
    const name = f.name.replace(/\.[^.]+$/, "");
    // 아직 RUID 가 없다(업로드 전) → 이름 키로 로컬 캐시. 업로드 후엔 RUID 키로 다시 잡힌다.
    void putCachedImage(imageCacheKey({ name })!, url);
    out.push({ name, url, img, hash, px: pxOf(img), category: categoryFromFile(f) });
  }
  return out;
}

/**
 * 저장된 팔레트(프로젝트 파일 / IndexedDB) → PaletteTile[]. 이미지는 **리졸버**가 해결한다
 *   (캐시 → /api/images → 폴백). v1 레거시 항목의 인라인 base64 도 리졸버가 처리한다.
 * 못 찾은 항목은 url="" · img=null 로 남아 폴백 스와치로 그려진다(작업은 계속 가능).
 */
export async function tilesFromStored(stored: StoredTileInput[]): Promise<PaletteTile[]> {
  const { urls } = await resolveTileImages(stored);
  return Promise.all(
    stored.map(async (s, i) => {
      const url = urls.get(i) ?? "";
      const img = url ? await loadImage(url).catch(() => null) : null;
      return {
        name: s.name,
        url,
        img,
        hash: s.hash ?? null,
        ruid: s.ruid,
        // 저장된 px 를 우선 신뢰(이미지가 없어도 파이프라인이 동작해야 한다). 없으면 방금 로드한 것에서.
        px: s.px ?? pxOf(img),
        regStatus: s.regStatus,
        category: s.category,
      } satisfies PaletteTile;
    }),
  );
}

/**
 * 직렬화 형태(프로젝트 파일 · IndexedDB 공용) — **이미지 바이트를 담지 않는다.**
 *   이미지의 진실원은 MSW 그룹 스토리지(ruid)이고, 여기엔 그 참조와 파생 치수(px)만 둔다.
 *   ⚠ url(base64) 을 다시 넣지 말 것 — 그게 map/*.json 78MB 사고의 원인이었다
 *     (docs/map/MAP_PROJECT_ASSET_REFERENCE_PLAN.md). 회귀는 vitest + convert_map 게이트가 잡는다.
 */
export interface StoredTile {
  name: string;
  hash?: string | null;
  ruid?: string;
  px?: [number, number];
  regStatus?: RegStatus;
  category?: string;
}

/** 읽기 전용 확장 — v1 프로젝트 파일에는 url(base64)이 들어 있다. 읽되 **다시 쓰지 않는다**. */
export interface StoredTileInput extends StoredTile {
  url?: string;
}

/** PaletteTile → 직렬화 형태. img·url 은 의도적으로 제외(위 주석). */
export function toStoredTile(t: PaletteTile): StoredTile {
  return {
    name: t.name,
    hash: t.hash ?? null,
    ruid: t.ruid,
    px: t.px,
    regStatus: t.regStatus,
    category: t.category,
  };
}
