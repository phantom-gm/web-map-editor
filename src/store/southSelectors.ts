// 남쪽 침범 판정(southIntrusion)의 스토어 selector — 컨텍스트(설 수 없는 칸)와 집계를 **버전 카운터로 memo** 한다.
//   `blocked` 는 스토어가 제자리 변이하고 `blockedVer` 만 올리므로 참조 비교로는 변화를 못 본다 → (entitiesVer, blockedVer) 가 키다
//   (엔티티·이동불가를 바꾸는 모든 액션이 카운터를 올린다 — undo/redo·loadProject·clearAll 포함).
//   같은 키면 **같은 객체**를 돌려줘 zustand 구독이 재렌더를 일으키지 않는다(매번 새 객체면 getSnapshot 경고 + 렌더 폭주).
//   캔버스(마우스 이동마다 draw)·인스펙터·상태바가 이 하나를 나눠 쓴다 — 2026-09-26 리뷰 후속 #3(void 구독 제거)·#4(프레임당 재계산 제거).
import type { EditorState } from "./editorStore";
import { buildStandCtx, judgeSouth, type StandCtx } from "../lib/southIntrusion";

type SouthSource = Pick<EditorState, "entities" | "blocked" | "entitiesVer" | "blockedVer">;
interface Memo<T> {
  ev: number;
  bv: number;
  value: T;
}
const hit = <T>(m: Memo<T> | null, s: SouthSource): m is Memo<T> => !!m && m.ev === s.entitiesVer && m.bv === s.blockedVer;

let standMemo: Memo<StandCtx> | null = null;
/** 설 수 없는 칸 컨텍스트 — 엔티티·이동불가가 바뀔 때만 다시 만든다. */
export function selectStandCtx(s: SouthSource): StandCtx {
  if (hit(standMemo, s)) return standMemo.value;
  standMemo = { ev: s.entitiesVer, bv: s.blockedVer, value: buildStandCtx(s.entities, s.blocked) };
  return standMemo.value;
}

export interface SouthCounts {
  block: number;
  watch: number;
}
let countsMemo: Memo<SouthCounts> | null = null;
/** 상태바용 집계 — 차단(빌드 게이트가 막음)·경고 건수. */
export function selectSouthCounts(s: SouthSource): SouthCounts {
  if (hit(countsMemo, s)) return countsMemo.value;
  const stand = selectStandCtx(s);
  const value: SouthCounts = { block: 0, watch: 0 };
  for (const e of s.entities) {
    const r = judgeSouth(e, stand);
    if (r) value[r.level]++;
  }
  countsMemo = { ev: s.entitiesVer, bv: s.blockedVer, value };
  return value;
}
