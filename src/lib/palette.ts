import type { RegStatus } from "./registry";

// 팔레트 타일 — 업로드한 PNG. name = 파일명(확장자 제거), url = dataURL(export/표시),
// img = 캔버스 렌더용 HTMLImageElement(로드 완료된 것).
export interface PaletteTile {
  name: string;
  url: string; // dataURL ("" = JSON import 로 PNG 없음 → 폴백색 스와치)
  img: HTMLImageElement | null;
  hash?: string | null; // PNG 바이트 sha256 (레지스트리 해시 매칭용; import 시엔 없음)
  ruid?: string; // 레지스트리 판정 결과 RUID
  regStatus?: RegStatus; // registered | renamed | conflict | new
  category?: string; // 팔레트 분류용 — 스토리지=subcategory, 폴더 업로드=폴더명, 그 외="기타"
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
      return {
        name: it.name,
        url,
        img,
        hash: null,
        ruid: it.ruid,
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
    out.push({ name: f.name.replace(/\.[^.]+$/, ""), url, img, hash, category: categoryFromFile(f) });
  }
  return out;
}

/** 영속 저장에서 복원한 직렬화 타일(img 없음) → PaletteTile[]. url(dataURL)에서 img 재로드. */
export async function tilesFromStored(stored: StoredTile[]): Promise<PaletteTile[]> {
  return Promise.all(
    stored.map(async (s) => ({
      name: s.name,
      url: s.url,
      img: s.url ? await loadImage(s.url).catch(() => null) : null,
      hash: s.hash ?? null,
      ruid: s.ruid,
      regStatus: s.regStatus,
      category: s.category,
    })),
  );
}

/** IndexedDB 영속용 직렬화 형태 — HTMLImageElement(img) 는 제외. */
export interface StoredTile {
  name: string;
  url: string;
  hash?: string | null;
  ruid?: string;
  regStatus?: RegStatus;
  category?: string;
}

/** PaletteTile → 직렬화 형태(img 제거). */
export function toStoredTile(t: PaletteTile): StoredTile {
  return { name: t.name, url: t.url, hash: t.hash ?? null, ruid: t.ruid, regStatus: t.regStatus, category: t.category };
}
