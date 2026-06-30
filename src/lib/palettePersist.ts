// 팔레트 영속 — IndexedDB(idb-keyval). PNG dataURL 이 커질 수 있어 localStorage(5MB) 대신 사용.
// 저장은 디바운스(연속 추가/폴더 업로드 시 1회만 쓰기). img(HTMLImageElement)는 직렬화 불가라 제외.
import { get as idbGet, set as idbSet } from "idb-keyval";
import type { PaletteTile, StoredTile } from "./palette";
import { toStoredTile } from "./palette";

const KEY = "wme-palette-v1";
const SAVE_DELAY_MS = 400;

let timer: ReturnType<typeof setTimeout> | null = null;

/** 저장된 팔레트(직렬화 타일) 로드. 없으면 빈 배열. */
export async function loadStoredPalette(): Promise<StoredTile[]> {
  try {
    return (await idbGet<StoredTile[]>(KEY)) ?? [];
  } catch {
    return [];
  }
}

/** 팔레트를 디바운스 저장. 호출이 몰리면 마지막 것만 기록. */
export function saveStoredPalette(palette: PaletteTile[]): void {
  if (timer) clearTimeout(timer);
  const snapshot = palette.map(toStoredTile);
  timer = setTimeout(() => {
    void idbSet(KEY, snapshot).catch(() => {});
  }, SAVE_DELAY_MS);
}
