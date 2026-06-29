// 셀 좌표 ↔ Map 키 단일 소스. 생성/파싱을 한 곳에서 정의해 store·canvas·IO 중복 제거.
export type CellKey = `${number},${number}`;

export const cellKey = (gx: number, gy: number): CellKey => `${gx},${gy}`;

export function parseCellKey(k: string): [number, number] {
  const c = k.indexOf(",");
  return [Number(k.slice(0, c)), Number(k.slice(c + 1))];
}
