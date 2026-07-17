import { describe, it, expect } from "vitest";
import { entityFootprintCells, footprintWH, renderWH, migrateEntity, type MapEntity } from "../types/entity";
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

// 깊이(y-정렬) footprint = 저작한 지면 점유 셀 수(tilesW/tilesH) 그대로.
//   계약: docs/map/depth/웹맵에디터_깊이footprint_export_요청.md
//   회귀 방지: 예전엔 round(baseW) 정사각 파생이라 정보량 0 → 게임이 6×1 상점을 9×9 로 인식해
//   뒤쪽 8줄을 삼켰다(실측 64쌍 앞뒤 뒤집힘). 스프라이트 파생으로 되돌아가면 이 테스트가 깨진다.
describe("깊이 footprint export (depthW/depthH) — 저작값", () => {
  const obj = (p: Partial<MapEntity>): MapEntity => ({ id: "x", kind: "object", gx: 0, gy: 0, ...p });
  const exp1 = (e: MapEntity) => exportEntities([e], []).find((x) => x.kind === "object")!;

  it("depthW/H = 저작한 점유 rect(tilesW/H) — 스프라이트 크기와 무관", () => {
    // 페른델잡화상점 실측 형태: 가로 6칸 세로 1칸인데 스프라이트 네이티브 폭은 23.22타일.
    const e = exp1(obj({ tilesW: 6, tilesH: 1, baseW: 23.21875, baseH: 16.921875, scaleMul: 0.4 }));
    expect(e.depthW).toBe(6);
    expect(e.depthH).toBe(1);
    expect(e.depthW).not.toBe(Math.round(23.21875)); // 수용기준 1 — 파생값이 아니어야 함
  });

  it("비정사각 depth 를 표현한다 — 강제로 같게 만들지 않는다(수용기준 2)", () => {
    const e = exp1(obj({ tilesW: 6, tilesH: 3, baseW: 9, baseH: 5 }));
    expect(e.depthW).toBe(6);
    expect(e.depthH).toBe(3);
    expect(e.depthH).not.toBe(e.depthW);
  });

  it("depthW×depthH = 캔버스 점유(노란 rect) 칸 수와 일치(수용기준 3)", () => {
    const src = obj({ tilesW: 4, tilesH: 2, baseW: 12.9, baseH: 8 });
    const e = exp1(src);
    // 캔버스가 그리는 점유 셀 = entityFootprintCells. export 한 depth rect 와 칸 수가 같아야 한다.
    expect(e.depthW! * e.depthH!).toBe(entityFootprintCells(src).length);
    expect(footprintWH(src)).toEqual([4, 2]);
  });

  it("스프라이트 파생 필드(spriteW/H)는 깊이와 독립 — 치수 데이터로만 유지", () => {
    const e = exp1(obj({ tilesW: 6, tilesH: 1, baseW: 10, baseH: 4, scaleMul: 0.5 }));
    expect(e.spriteW).toBe(5); // 10 × 0.5 — 렌더 크기
    expect(e.depthW).toBe(6); // 깊이는 저작값, spriteW 에 오염되지 않음
  });

  it("레거시(baseW 없음) object 도 depth 를 내보낸다 — 저작 rect 는 항상 있다", () => {
    const e = exp1(obj({ tilesW: 5, tilesH: 1 }));
    expect(e.depthW).toBe(5);
    expect(e.depthH).toBe(1);
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
