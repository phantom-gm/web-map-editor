import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../store/editorStore";

// footprint 는 앵커(gx,gy=앞tip)에서 −방향(북서)으로 뻗는다. 경계 검사도 −방향이어야 한다.
// 회귀: 예전 경계가 gx+w>W(+방향 가정)라, 넓은 오브젝트(다리)가 맵 오른쪽 절반으로 못 갔다.
describe("오브젝트 이동 경계 (−방향 footprint)", () => {
  beforeEach(() => {
    const st = useEditorStore.getState();
    st.newProject();
    useEditorStore.setState({ size: [60, 60] });
  });

  const placeWide = (w: number, h: number, gx: number, gy: number) => {
    // 스토어에 직접 넓은 오브젝트 주입(팔레트 이미지 없이 경계만 테스트)
    const id = "bridge";
    useEditorStore.setState((s) => ({
      entities: [...s.entities, { id, kind: "object", gx, gy, ruid: "r", tilesW: w, tilesH: h }],
    }));
    return id;
  };

  it("넓은 오브젝트가 맵 오른쪽 끝(gx=W−1)까지 이동된다 — 구 gx+w>W 회귀 방지", () => {
    const id = placeWide(10, 3, 30, 30);
    useEditorStore.getState().moveEntityTo(id, 59, 30); // 오른쪽 끝
    expect(useEditorStore.getState().entities.find((e) => e.id === id)!.gx).toBe(59);
  });

  it("gx=51(구 로직이 막던 지점)로 이동된다", () => {
    const id = placeWide(10, 3, 30, 30);
    useEditorStore.getState().moveEntityTo(id, 51, 30);
    expect(useEditorStore.getState().entities.find((e) => e.id === id)!.gx).toBe(51);
  });

  it("뒤코너가 맵 밖으로 나가는 왼쪽 이동은 막는다 (gx < w−1)", () => {
    const id = placeWide(10, 3, 30, 30);
    useEditorStore.getState().moveEntityTo(id, 8, 30); // 뒤코너 8−9=−1 → 막힘
    expect(useEditorStore.getState().entities.find((e) => e.id === id)!.gx).toBe(30); // 안 움직임
    useEditorStore.getState().moveEntityTo(id, 9, 30); // 뒤코너 9−9=0 → OK
    expect(useEditorStore.getState().entities.find((e) => e.id === id)!.gx).toBe(9);
  });
});
