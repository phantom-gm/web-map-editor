// 팔레트 **메타** 영속 — IndexedDB(idb-keyval). 저장은 디바운스(연속 추가/폴더 업로드 시 1회만 쓰기).
//   담기는 것: 이름 · RUID · px · 카테고리 · 등록상태 (= StoredTile). 이미지 바이트는 없다.
//   이미지는 imageCache 가 **RUID 키로 따로** 캐시한다 — 맵이 달라도 같은 항목을 공유하고,
//   프로젝트 파일(v2)과 저장 형태가 같아져 로드 경로가 하나로 합쳐진다(tilesFromStored).
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
