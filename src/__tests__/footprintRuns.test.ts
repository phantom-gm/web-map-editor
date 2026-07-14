import { describe, it, expect } from "vitest";
import {
  entityFootprintCells,
  footprintRuns,
  footprintWH,
  migrateEntity,
  playerBehind,
  validRects,
  type MapEntity,
} from "../types/entity";
import { exportEntities } from "../lib/entityExport";
import { useEditorStore } from "../store/editorStore";

// 오목(ㄴ/ㄷ/T자) footprint run 분해 — 게임 IsoObjectDepthLogic 판정의 캐논 미러.
// Spec: legend_of_light/docs/map/depth/아이소메트릭_깊이정렬_런분해_설계.md
const obj = (p: Partial<MapEntity>): MapEntity => ({ id: "x", kind: "object", gx: 0, gy: 0, ...p });

// 설계 §1 의 검증 픽스처: 8×8 그리드, ㄴ자 건물.
//   가로팔 (2,2)~(5,3) / 세로팔 (2,2)~(3,5) → 바운딩 박스 (2,2)~(5,5), 앵커 (5,5).
//   안쪽 코너 = (3,3) → 노치(개구부)는 (4,4),(4,5),(5,4),(5,5) 영역.
const L_SHAPE = obj({
  gx: 2,
  gy: 2,
  footprintRects: [
    [0, 0, 4, 2], // 가로팔: (2,2)~(5,3)
    [0, 0, 2, 4], // 세로팔: (2,2)~(3,5)
  ],
});

/** 설계 §1 의 정답식(다이어그램). 앞 = x>5 OR y>5 OR (x>3 AND y>3) */
const expectFront = (x: number, y: number) => x > 5 || y > 5 || (x > 3 && y > 3);

describe("footprintRuns — ㄴ자 오목 footprint", () => {
  it("바운딩 박스(footprintWH)는 run 들을 전부 덮는다 → 게이트·z정렬이 그대로 동작", () => {
    expect(footprintWH(L_SHAPE)).toEqual([4, 4]); // (2,2)~(5,5)
    expect(footprintRuns(L_SHAPE)).toEqual([
      { gx: 2, gy: 2, ax: 5, ay: 3 },
      { gx: 2, gy: 2, ax: 3, ay: 5 },
    ]);
  });

  it("점유 셀은 run 의 합집합 — 노치는 비고, 겹치는 코너는 dedup", () => {
    const cells = entityFootprintCells(L_SHAPE);
    const key = (x: number, y: number) => cells.some(([cx, cy]) => cx === x && cy === y);
    expect(cells).toHaveLength(12); // 4×2 + 2×4 − 2×2(겹침) = 8 + 8 − 4
    expect(new Set(cells.map(([x, y]) => `${x},${y}`)).size).toBe(12); // dedup 확인
    expect(key(5, 2)).toBe(true); // 가로팔 끝
    expect(key(2, 5)).toBe(true); // 세로팔 끝
    expect(key(4, 4)).toBe(false); // ★ 노치 — 점유 안 함(포치 안으로 걸어 들어갈 수 있다)
    expect(key(5, 5)).toBe(false); // 노치
  });

  it("footprintRects 미설정이면 단일 직사각 — 기존 동작 그대로(하위호환)", () => {
    const plain = obj({ gx: 2, gy: 2, tilesW: 4, tilesH: 4 });
    expect(footprintRuns(plain)).toEqual([{ gx: 2, gy: 2, ax: 5, ay: 5 }]);
    expect(footprintWH(plain)).toEqual([4, 4]);
    expect(entityFootprintCells(plain)).toHaveLength(16); // 구멍 없음
  });
});

describe("playerBehind — 8×8 전 셀 대조 (설계 §1 잠금)", () => {
  it("ㄴ자: 정답식과 오판 0 (건물 셀 제외 52칸)", () => {
    const mismatches: string[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const inside = entityFootprintCells(L_SHAPE).some(([cx, cy]) => cx === x && cy === y);
        if (inside) continue; // 건물 셀은 정답식의 정의역 밖
        const front = !playerBehind(L_SHAPE, x, y);
        if (front !== expectFront(x, y)) mismatches.push(`(${x},${y}) got=${front ? "앞" : "뒤"}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("★ SE 노치(여관 포치)는 깊이 판정이 바운딩 박스와 동일 — run 분해의 이득은 '충돌'이다", () => {
    // 반직관적이지만 실측이다(설계 §1-b, 64칸 전수 비교 차이 0칸):
    //   노치가 앞(카메라 쪽)이면, 노치 셀은 단일 직사각에선 inside 예외로 front,
    //   run 분해에선 어느 run 에도 안 뒤라서 front — 결론이 같다.
    // 그래서 포치에서 run 분해가 사주는 것은 깊이가 아니라 **충돌**이다(아래 별도 테스트).
    const single = obj({ gx: 2, gy: 2, tilesW: 4, tilesH: 4 });
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(playerBehind(L_SHAPE, x, y)).toBe(playerBehind(single, x, y));
      }
    }
  });

  it("★ 노치가 뒤/옆(NW)이면 깊이 판정이 실제로 갈린다 — run 분해의 존재 증명", () => {
    // NW 노치 ㄴ자: 오른팔 (4,2)~(5,5) + 아랫팔 (2,4)~(5,5). 바운딩 박스는 (2,2)~(5,5) 로 같다.
    //   노치 (3,3) 에 선 플레이어: 두 팔이 전부 남동쪽(카메라 쪽)에 있으므로 **건물이 덮어야** 맞다.
    //   단일 직사각: (3,3) 이 inside → front (오판, 플레이어가 벽을 뚫고 앞에 보인다)
    //   run 분해:    어느 run 에도 안 들어감 → 오른팔(ax5,ay5) 기준 3≤5 AND 3≤5 → behind ✅
    const nwNotch = obj({
      gx: 2,
      gy: 2,
      footprintRects: [
        [2, 0, 2, 4], // 오른팔 (4,2)~(5,5)
        [0, 2, 4, 2], // 아랫팔 (2,4)~(5,5)
      ],
    });
    const single = obj({ gx: 2, gy: 2, tilesW: 4, tilesH: 4 });
    expect(footprintWH(nwNotch)).toEqual([4, 4]); // 바운딩 박스 동일
    expect(playerBehind(single, 3, 3)).toBe(false); // 구 = 오판(플레이어가 앞)
    expect(playerBehind(nwNotch, 3, 3)).toBe(true); // 신 = 정답(건물이 덮음)
  });

  it("★ 충돌: 포치는 걸어 들어갈 수 있고 벽은 막힌다 — 단일 직사각으론 불가능", () => {
    const cells = entityFootprintCells(L_SHAPE);
    const has = (x: number, y: number) => cells.some(([cx, cy]) => cx === x && cy === y);
    expect(has(4, 4)).toBe(false); // 포치 = 통과 가능
    expect(has(5, 5)).toBe(false); // 포치
    expect(has(5, 2)).toBe(true); // 벽 = 차단
    expect(has(2, 5)).toBe(true); // 벽 = 차단
    // 단일 4×4 였다면 16칸 전부 차단 → 포치까지 막혀 들어갈 수 없다.
    expect(entityFootprintCells(obj({ gx: 2, gy: 2, tilesW: 4, tilesH: 4 }))).toHaveLength(16);
  });

  it("run 결합은 OR — AND 로 바꾸면 오판이 생긴다(회귀 방지 반례)", () => {
    // (1,4): 세로팔(ax=3,ay=5) 기준 1≤3 AND 4≤5 → 뒤. 가로팔(ax=5,ay=3) 기준 4>3 → 안 뒤.
    //   OR  → behind ✅ (세로팔 서쪽이라 울타리가 덮어야 맞다, 정답식도 x=1,y=4 → 앞 아님)
    //   AND → front  ❌ (오판)
    expect(playerBehind(L_SHAPE, 1, 4)).toBe(true);
    expect(expectFront(1, 4)).toBe(false);
  });

  it("inside 예외가 behind 보다 먼저 — 통과 가능 장식물 위에 선 플레이어는 보인다", () => {
    expect(playerBehind(L_SHAPE, 2, 2)).toBe(false); // 두 run 이 겹치는 코너 셀
    expect(playerBehind(L_SHAPE, 5, 2)).toBe(false); // 가로팔 위
    expect(playerBehind(L_SHAPE, 2, 5)).toBe(false); // 세로팔 위
  });

  it("회귀: 단일 직사각(1×H 세로 울타리)의 동/서 판정은 그대로", () => {
    const fence = obj({ gx: 3, gy: 1, tilesW: 1, tilesH: 5 }); // (3,1)~(3,5)
    expect(playerBehind(fence, 4, 2)).toBe(false); // 동쪽 옆 → 플레이어 앞 (헤드라인 버그 수정분)
    expect(playerBehind(fence, 2, 2)).toBe(true); // 서쪽 옆 → 울타리가 덮음
    expect(playerBehind(fence, 3, 6)).toBe(false); // 남쪽 끝 아래 → 플레이어 앞
  });
});

describe("export — footprintRects 통과 + footprintCells union 파생", () => {
  it("blocks=true 면 footprintCells 가 union(12칸, 노치 제외)으로 나가고 rects 도 통과한다", () => {
    const e = { ...L_SHAPE, blocks: true, ruid: "r1" };
    const [out] = exportEntities([e], []);
    expect(out.footprintRects).toEqual([
      [0, 0, 4, 2],
      [0, 0, 2, 4],
    ]);
    expect(out.footprintCells).toHaveLength(12); // 노치 4칸 빠짐 — 포치로 걸어 들어갈 수 있다
    const rel = (out.footprintCells ?? []).map(([dx, dy]) => `${dx},${dy}`);
    expect(rel).not.toContain("2,2"); // 노치(절대 (4,4)) = 앵커 상대 (2,2)
    expect(rel).toContain("3,0"); // 가로팔 끝
    expect(rel).toContain("0,3"); // 세로팔 끝
  });
});

describe("불변식 방어 — /review 지적 (바운딩 박스는 저장이 아니라 파생)", () => {
  it("migrateEntity 가 로드 시 tilesW/H 를 run 의 바운딩 박스로 재파생한다(저장값을 믿지 않는다)", () => {
    // 어긋난 project.json (tilesW=9 인데 run 의 바운딩은 4×4) — 예전엔 그대로 통과해
    //   export 가 tilesW=9 를 내보내고 게임만 조용히 틀어졌다.
    const stale = migrateEntity(
      obj({ gx: 2, gy: 2, tilesW: 9, tilesH: 1, footprintRects: [[0, 0, 4, 2], [0, 0, 2, 4]] }),
    );
    expect([stale.tilesW, stale.tilesH]).toEqual([4, 4]);
  });

  it("음수 오프셋 run 은 무효 — 앵커가 바운딩 박스 뒤-위 코너라는 규약을 지킨다", () => {
    // dx<0 이면 footprintWH 가 max 만 보므로 바운딩이 실제 점유보다 작아진다(게이트가 조용히 어긋남).
    const bad = obj({ gx: 5, gy: 5, tilesW: 2, tilesH: 2, footprintRects: [[-1, 0, 2, 2]] });
    expect(validRects(bad)).toBeNull(); // 유효 run 없음 → 단일 직사각으로 폴백
    expect(footprintWH(bad)).toEqual([2, 2]); // tilesW/H 폴백(음수 run 을 반영하지 않는다)
  });

  it("run 을 늘려도 점유가 맵 밖으로 나가지 않는다(앵커 클램프)", () => {
    const st = useEditorStore.getState();
    st.newProject(); // 20×20
    useEditorStore.setState({
      palette: [{ name: "t", url: "", img: { naturalWidth: 64, naturalHeight: 64 } as HTMLImageElement, ruid: "r1", category: "object" }],
      activeIdx: 0,
    });
    useEditorStore.getState().placeEntity("object", 19, 19); // 맵 우하단 끝
    const id = useEditorStore.getState().entities[0].id;
    useEditorStore.getState().setFootprintRects(id, [[0, 0, 4, 4]]); // 4×4 로 확장
    const e = useEditorStore.getState().entities[0];
    const [W, H] = useEditorStore.getState().size;
    expect(e.gx + (e.tilesW ?? 1)).toBeLessThanOrEqual(W); // 경계 안
    expect(e.gy + (e.tilesH ?? 1)).toBeLessThanOrEqual(H);
    for (const [gx, gy] of entityFootprintCells(e)) {
      expect(gx).toBeLessThan(W);
      expect(gy).toBeLessThan(H);
    }
  });
});

describe("setFootprintRects — 바운딩 박스(tilesW/H) 동기 강제", () => {
  it("run 을 바꾸면 tilesW/H 가 바운딩 박스로 자동 갱신된다(게이트·z정렬이 실제 점유보다 작아지는 것 방지)", () => {
    const st = useEditorStore.getState();
    st.newProject();
    useEditorStore.setState({
      palette: [{ name: "t", url: "", img: { naturalWidth: 64, naturalHeight: 64 } as HTMLImageElement, ruid: "r1", category: "object" }],
      activeIdx: 0,
    });
    useEditorStore.getState().placeEntity("object", 2, 2);
    const id = useEditorStore.getState().entities[0].id;

    useEditorStore.getState().setFootprintRects(id, [
      [0, 0, 4, 2],
      [0, 0, 2, 4],
    ]);
    let e = useEditorStore.getState().entities[0];
    expect([e.tilesW, e.tilesH]).toEqual([4, 4]); // 바운딩 박스 — run 이 4×2/2×4 여도
    expect(entityFootprintCells(e)).toHaveLength(12);

    // 빈 목록 → 단일 직사각으로 복귀(footprintRects 제거)
    useEditorStore.getState().setFootprintRects(id, []);
    e = useEditorStore.getState().entities[0];
    expect(e.footprintRects).toBeUndefined();
    expect(entityFootprintCells(e)).toHaveLength(16); // 4×4 전부 점유
  });
});
