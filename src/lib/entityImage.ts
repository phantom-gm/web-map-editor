// 팔레트에서 엔티티(object/monster/npc) 에셋 이미지를 찾는 공용 조회기.
// ruid 우선, name 차선. 포탈은 항상 null. 렌더(CanvasGrid)와 export(entityExport) 가 공유.
import type { MapEntity } from "../types/entity";
import type { PaletteTile } from "./palette";

export function makeEntityImageLookup(palette: PaletteTile[]): (e: MapEntity) => HTMLImageElement | null {
  const byRuid = new Map<string, HTMLImageElement>();
  const byName = new Map<string, HTMLImageElement>();
  for (const t of palette) {
    if (!t.img) continue;
    if (t.ruid) byRuid.set(t.ruid, t.img);
    if (t.name) byName.set(t.name, t.img);
  }
  return (e) =>
    e.kind !== "portal" ? (e.ruid && byRuid.get(e.ruid)) || (e.name && byName.get(e.name)) || null : null;
}
