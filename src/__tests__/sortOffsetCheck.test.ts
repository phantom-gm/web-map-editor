import { describe, it, expect } from "vitest";
import { computeSortOffsets, isFrontOfRect, footprintRect, type FpRect } from "../lib/sortOffsetCheck";
import type { MapEntity } from "../types/entity";

// 요구서: docs/map/isometric/에디터_sortOffset_요구사항.md (R1~R4)
const obj = (p: Partial<MapEntity>): MapEntity => ({ id: "x", kind: "object", gx: 0, gy: 0, ...p });

describe("isFrontOfRect (요구서 §5)", () => {
  const r: FpRect = { gx: 45, gy: 28, ax: 54, ay: 32 };
  it("안=앞, 남/동=앞, 북/서=뒤", () => {
    expect(isFrontOfRect(r, 50, 30)).toBe(true); // 안
    expect(isFrontOfRect(r, 55, 30)).toBe(true); // 동
    expect(isFrontOfRect(r, 50, 33)).toBe(true); // 남
    expect(isFrontOfRect(r, 44, 30)).toBe(false); // 서
    expect(isFrontOfRect(r, 50, 27)).toBe(false); // 북
  });
});

describe("footprintRect (offset-정렬)", () => {
  it("다리_B(10×5, offset −72,7) → [45..54]×[28..32]", () => {
    const e = obj({ gx: 55, gy: 31, tilesW: 10, tilesH: 5, offsetX: -72, offsetY: 7 });
    expect(footprintRect(e)).toEqual({ gx: 45, gy: 28, ax: 54, ay: 32 });
  });
});

describe("computeSortOffsets — 다리 사례 (요구서 §6)", () => {
  // 갑판 10×5 + 난간 10×1, 같은 앵커(55,31)·offset. 난간이 앞줄(남쪽)이라 더 앞 → sortOffset +1 필요.
  const deck = obj({ id: "deck", name: "다리_B", gx: 55, gy: 31, tilesW: 10, tilesH: 5, offsetX: -72, offsetY: 7 });
  const rail = obj({ id: "rail", name: "난간", gx: 55, gy: 31, tilesW: 10, tilesH: 1, offsetX: -72, offsetY: 7 });

  it("난간에 sortOffset 1 을 부여하고 순환은 없다", () => {
    const res = computeSortOffsets([deck, rail]);
    expect(res.cycles).toEqual([]);
    expect(res.fixes).toEqual([{ id: "rail", name: "난간", from: 0, to: 1 }]);
  });

  it("방향이 맞다 — 갑판이 아니라 난간이 올라간다(R2: 반대로 벌리면 안 됨)", () => {
    const res = computeSortOffsets([deck, rail]);
    expect(res.fixes.find((f) => f.id === "deck")).toBeUndefined();
    expect(res.fixes.find((f) => f.id === "rail")?.to).toBe(1);
  });

  it("이미 난간이 앞(sortOffset 1)이면 수정 없음 (멱등)", () => {
    const res = computeSortOffsets([deck, { ...rail, sortOffset: 1 }]);
    expect(res.fixes).toEqual([]);
  });

  it("겹치지 않으면(먼 앵커) 건드리지 않는다", () => {
    const far = obj({ id: "rail", name: "난간", gx: 5, gy: 5, tilesW: 10, tilesH: 1 });
    expect(computeSortOffsets([deck, far]).fixes).toEqual([]);
  });
});

describe("computeSortOffsets — 순환 감지 (R4)", () => {
  it("서로 상대의 앞/뒤를 동시에 요구하면 cycle 경고, fix 없음", () => {
    // A 는 북서 넓게, B 는 남동 넓게 — 겹치는 영역에서 A앞/B뒤 칸과 B앞/A뒤 칸이 둘 다 생기게 배치.
    const A = obj({ id: "A", name: "A", gx: 10, gy: 12, tilesW: 3, tilesH: 1 }); // [8..10]×[12]
    const B = obj({ id: "B", name: "B", gx: 12, gy: 10, tilesW: 1, tilesH: 3 }); // [12]×[8..10]
    // 교차형(ㄴ)으로 겹치도록 좌표를 겹침 영역 만들기 위해 조정
    const A2 = obj({ id: "A", name: "A", gx: 12, gy: 12, tilesW: 5, tilesH: 3 }); // [8..12]×[10..12]
    const B2 = obj({ id: "B", name: "B", gx: 12, gy: 12, tilesW: 3, tilesH: 5 }); // [10..12]×[8..12]
    void A; void B;
    const res = computeSortOffsets([A2, B2]);
    // 두 rect 는 십자로 겹쳐 A앞/B뒤 와 B앞/A뒤 가 동시에 발생 → cycle
    expect(res.cycles.length).toBe(1);
    expect(res.fixes).toEqual([]);
  });
});

describe("computeSortOffsets — 작은 오브젝트가 건물 footprint 안 (화분 신고)", () => {
  // 6×6 상점 anchor(23,31) footprint [18..23]×[26..31]. 화분 1×1 을 앞줄 근처에 둔다.
  const shop = obj({ id: "shop", name: "잡화상점", gx: 23, gy: 31, tilesW: 6, tilesH: 6 });

  it("footprint 앞쪽 화분은 sortOffset 을 받아 건물 앞으로 (건물 뒤로 숨지 않음)", () => {
    const pot = obj({ id: "pot", name: "화분", gx: 20, gy: 31 });
    const res = computeSortOffsets([shop, pot]);
    const fix = res.fixes.find((f) => f.id === "pot");
    expect(fix).toBeDefined();
    expect(fix!.to).toBeGreaterThan(0);
    expect(fix!.to).toBeLessThanOrEqual(4); // 앞쪽이라 작은 값
  });

  it("footprint 깊숙이(뒤-서 코너) 오브젝트는 자동 미적용 + deepInside 경고", () => {
    // (18,26) = 건물 뒤-서 코너 → 필요 sortOffset 이 커짐 → 억지로 안 올리고 경고.
    const tree = obj({ id: "tree", name: "나무", gx: 18, gy: 26 });
    const res = computeSortOffsets([shop, tree]);
    expect(res.fixes.find((f) => f.id === "tree")).toBeUndefined();
    expect(res.deepInside.some((d) => d.id === "tree")).toBe(true);
  });

  it("건물에서 먼 화분은 건드리지 않음", () => {
    const far = obj({ id: "pot", name: "화분", gx: 2, gy: 2 });
    expect(computeSortOffsets([shop, far]).fixes.find((f) => f.id === "pot")).toBeUndefined();
  });
});
