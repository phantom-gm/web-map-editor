import { describe, it, expect } from "vitest";
import { cellToWorld } from "../lib/iso";

// 게임 IsoProjectLogic 과 정합해야 하는 셀→world 투영(맵 export 좌표의 근간).
describe("iso 엔진 미러(IsoProjectLogic 정합)", () => {
  it("cellToWorld(15,15) = (0,0)", () => {
    const [x, y] = cellToWorld(15, 15);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });
  it("cellToWorld(16,15) = (+TW/2, -TH/2)", () => {
    const [x, y] = cellToWorld(16, 15);
    expect(x).toBeCloseTo(0.28);
    expect(y).toBeCloseTo(-0.14);
  });
});
