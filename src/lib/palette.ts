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

/** File[] → PaletteTile[]. img 로드 + 콘텐츠 해시까지 await 후 반환. */
export async function loadTiles(files: File[]): Promise<PaletteTile[]> {
  const out: PaletteTile[] = [];
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    const url = await readDataURL(f);
    const img = await loadImage(url).catch(() => null);
    const hash = await hashFile(f);
    out.push({ name: f.name.replace(/\.[^.]+$/, ""), url, img, hash });
  }
  return out;
}
