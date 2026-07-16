import { describe, it, expect } from "vitest";
import { footprintWH, renderWH, migrateEntity, type MapEntity } from "../types/entity";
import { exportEntities } from "../lib/entityExport";
import { entityWarnings } from "../lib/validate";
import { useEditorStore } from "../store/editorStore";
import type { PaletteTile } from "../lib/palette";

// 오브젝트 이미지 크기(renderWH=baseW) 와 점유/충돌(footprintWH=tilesW) 분리 회귀 테스트.
// W×H(점유) 를 바꿔도 이미지 렌더 기준은 그대로여야 한다.
describe("오브젝트 크기/점유 분리", () => {
  const obj = (p: Partial<MapEntity>): MapEntity => ({ id: "x", kind: "object", gx: 0, gy: 0, ...p });

  it("baseW 가 있으면 renderWH 는 baseW 를 쓰고 tilesW 변경에 영향받지 않는다", () => {
    const e = obj({ baseW: 3, baseH: 1, tilesW: 5, tilesH: 4 });
    expect(renderWH(e)).toEqual([3, 1]); // 이미지 = 배치 시 고정
    expect(footprintWH(e)).toEqual([5, 4]); // 점유(충돌) = 현재 W×H
  });

  it("migrateEntity 는 baseW 없는 레거시 object 를 현재 tilesW/tilesH 로 1회 고정한다", () => {
    const m = migrateEntity(obj({ tilesW: 3, tilesH: 2 }));
    expect(m.baseW).toBe(3);
    expect(m.baseH).toBe(2);
    // 이후 점유만 바꿔도 renderWH 는 고정된 base 유지
    expect(renderWH({ ...m, tilesW: 8, tilesH: 8 })).toEqual([3, 2]);
  });

  it("monster/npc 는 baseW 를 부여하지 않아 기존처럼 tilesW 가 이미지도 결정한다", () => {
    const mob = migrateEntity(obj({ kind: "monster", tilesW: 2, tilesH: 1 }));
    expect(mob.baseW).toBeUndefined();
    expect(renderWH(mob)).toEqual([2, 1]); // tilesW 폴백
  });

  it("1타일 미만 baseW 를 클램프하지 않는다 — 64px 미만 에셋의 픽셀 1:1 보존", () => {
    const small = obj({ baseW: 30 / 64, baseH: 30 / 64, tilesW: 1, tilesH: 1 });
    expect(renderWH(small)[0]).toBeCloseTo(0.469); // 1 로 커지면 안 됨
    expect(footprintWH(small)).toEqual([1, 1]); // 점유는 1×1
  });
});

// 깊이(y-정렬) footprint = round(baseW) 정사각. 충돌(tilesW/H)과 분리 — export 계산값.
//   큰 건물의 정렬선이 시각 베이스를 덮어, 포치에 선 플레이어가 건물 위로 보이게 하는 G0 수정.
describe("깊이 footprint export (depthW/depthH)", () => {
  const obj = (p: Partial<MapEntity>): MapEntity => ({ id: "x", kind: "object", gx: 0, gy: 0, ...p });
  const exp1 = (e: MapEntity) => exportEntities([e], []).find((x) => x.kind === "object")!;

  it("baseW 보유 object → depthW=depthH=round(baseW) 정사각", () => {
    const e = exp1(obj({ baseW: 4.6, baseH: 9.2, tilesW: 1, tilesH: 1 }));
    expect(e.depthW).toBe(5); // round(4.6)
    expect(e.depthH).toBe(5); // 정사각 — baseH(전체높이)는 안 쓴다
  });

  it("깊이 footprint 는 충돌(tilesW/H)과 독립 — W×H 를 바꿔도 depth 는 baseW 기준", () => {
    const e = exp1(obj({ baseW: 3, baseH: 1, tilesW: 5, tilesH: 4 }));
    expect(e.depthW).toBe(3);
    expect(e.depthH).toBe(3);
    expect(footprintWH(e)).toEqual([5, 4]); // 충돌 점유는 그대로
  });

  it("1타일 미만 baseW 는 depth 1 로 클램프(음수·0 footprint 금지)", () => {
    const e = exp1(obj({ baseW: 30 / 64, baseH: 30 / 64, tilesW: 1, tilesH: 1 }));
    expect(e.depthW).toBe(1); // max(1, round(0.469))
    expect(e.depthH).toBe(1);
  });

  it("baseW 없는 레거시/몬스터 → depthW 미emit(build_map 이 현행 tilesW/H 유지)", () => {
    expect(exp1(obj({ tilesW: 5, tilesH: 1 })).depthW).toBeUndefined();
    const mob = exportEntities([obj({ kind: "monster", tilesW: 2, tilesH: 1 })], []).find((x) => x.kind === "monster")!;
    expect(mob.depthW).toBeUndefined();
  });
});

// 배치 기본값(placeEntity) → export(exportEntities) 를 실제로 통과시켜, 에셋 네이티브 크기와 무관하게
// 게임 scale 이 일정(고정 PPU)한지 잠근다. ⚠ 수식을 테스트에 재구현하지 말 것 — 프로덕션 경로를 호출한다.
describe("배치 기본값 — 고정 PPU(픽셀 1:1)", () => {
  const tileOf = (name: string, nativeW: number, nativeH: number): PaletteTile => ({
    name,
    url: "",
    img: { naturalWidth: nativeW, naturalHeight: nativeH } as HTMLImageElement,
    ruid: `ruid-${name}`,
    category: "object",
  });

  /** 팔레트 타일을 골라 실제 스토어로 배치하고, 실제 export 를 거친 object 를 돌려준다. */
  const placeAndExport = (tile: PaletteTile): MapEntity => {
    const st = useEditorStore.getState();
    st.newProject();
    useEditorStore.setState({ palette: [tile], activeIdx: 0 });
    useEditorStore.getState().placeEntity("object", 5, 5);
    const s = useEditorStore.getState();
    const out = exportEntities(s.entities, s.palette).find((e) => e.kind === "object");
    if (!out) throw new Error("object 가 배치되지 않음");
    return out;
  };

  it("점유(tilesW/H)는 에셋 크기와 무관하게 항상 1×1 로 배치된다", () => {
    for (const nw of [30, 90, 100, 400]) {
      const e = placeAndExport(tileOf(`t${nw}`, nw, nw));
      expect(footprintWH(e)).toEqual([1, 1]);
    }
  });

  it("네이티브 폭이 달라도 게임 scale 은 동일 — 크기가 제각각이지 않다", () => {
    const scales = [30, 60, 90, 100, 256, 400].map((nw) => placeAndExport(tileOf(`t${nw}`, nw, nw)).scale);
    for (const s of scales) expect(s).toBeCloseTo(scales[0] as number);
    // 반올림 방식이었다면 90px→1타일 / 100px→2타일 로 두 배 가까이 벌어졌다(회귀 방지).
    expect(scales[2]).toBeCloseTo(scales[3] as number);
  });

  it("충돌(blocks) 체크 시 footprintCells 는 1칸 — 넓은 스프라이트는 W×H 를 직접 올려야 한다", () => {
    const e = placeAndExport(tileOf("wide", 400, 100));
    const st = useEditorStore.getState();
    st.updateEntity(e.id, { blocks: true });
    const s = useEditorStore.getState();
    const out = exportEntities(s.entities, s.palette).find((x) => x.kind === "object")!;
    expect(out.footprintCells).toEqual([[0, 0]]);
    // …그리고 그 상태를 검증이 경고로 잡아준다(막지는 않음 — 나무 밑동처럼 의도적일 수 있으므로).
    expect(entityWarnings(s.entities).join()).toContain("충돌 범위");
  });

  it("이미지 없는 팔레트 타일(RUID 매핑만)로는 오브젝트를 배치하지 않는다 — 잘못된 크기 영구 고정 방지", () => {
    const st = useEditorStore.getState();
    st.newProject();
    useEditorStore.setState({
      palette: [{ name: "ruid-only", url: "", img: null, ruid: "r1", category: "object" }],
      activeIdx: 0,
    });
    useEditorStore.getState().placeEntity("object", 5, 5);
    expect(useEditorStore.getState().entities).toHaveLength(0);
  });

  it("복사본은 점유(1×1)가 아니라 보이는 폭만큼 옆으로 — 큰 스프라이트가 포개지지 않는다", () => {
    const e = placeAndExport(tileOf("wide", 400, 100)); // 보이는 폭 = 400/64 ≈ 6.25타일
    const st = useEditorStore.getState();
    st.duplicateEntity(e.id);
    const [a, b] = useEditorStore.getState().entities;
    expect(b.gx - a.gx).toBe(7); // ceil(6.25) — 1 이면 거의 겹침(회귀)
  });
});
