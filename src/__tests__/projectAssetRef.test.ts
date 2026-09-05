import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../store/editorStore";
import { toStoredTile, type PaletteTile } from "../lib/palette";
import { PROJECT_VERSION } from "../lib/projectIO";

// 회귀 가드 — 프로젝트 파일에 **이미지 바이트가 절대 다시 들어가지 않게** 한다.
//   배경: v1 은 palette[].url 에 base64 PNG 를 인라인했다. ferendel.json 이 78.6MB(97%가 base64)로
//   불어나 GitHub 100MB 한도에 근접했고 git pack 이 720MB 가 됐다.
//   계약: legend_of_light/docs/map/MAP_PROJECT_ASSET_REFERENCE_PLAN.md §5, §7.4
const B64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg";

const tile = (p: Partial<PaletteTile>): PaletteTile =>
  ({ name: "t", url: "", img: null, ...p }) as PaletteTile;

describe("toStoredTile — 직렬화에서 이미지 제외", () => {
  it("url(base64)을 내보내지 않는다", () => {
    const s = toStoredTile(tile({ name: "침엽수_B", url: B64, ruid: "abc", px: [397, 720] }));
    expect("url" in s).toBe(false);
    expect(JSON.stringify(s)).not.toContain("data:image");
  });

  it("참조(ruid)와 치수(px)는 보존한다 — 파이프라인이 이걸로 배율을 만든다", () => {
    const s = toStoredTile(tile({ name: "n", url: B64, ruid: "r1", px: [128, 256], category: "object" }));
    expect(s.ruid).toBe("r1");
    expect(s.px).toEqual([128, 256]);
    expect(s.category).toBe("object");
  });
});

describe("exportProject — v2 참조 포맷", () => {
  beforeEach(() => useEditorStore.getState().newProject());

  it("version 2 로 저장한다", () => {
    expect(useEditorStore.getState().exportProject().version).toBe(PROJECT_VERSION);
    expect(PROJECT_VERSION).toBe(2);
  });

  it("팔레트에 base64 가 있어도 산출 JSON 에 data: 문자열이 0개", () => {
    useEditorStore.setState({
      palette: [
        tile({ name: "a", url: B64, ruid: "r1", px: [64, 64] }),
        tile({ name: "b", url: B64, ruid: "r2", px: [128, 128] }),
      ],
      ground: new Map([["1,1", 0], ["2,2", 1]]),
    });
    const json = JSON.stringify(useEditorStore.getState().exportProject());
    expect(json).not.toContain("data:image");
    expect(json).not.toContain("base64");
  });

  it("팔레트 240개여도 산출물이 작다 (구 포맷은 78MB 였다)", () => {
    const palette = Array.from({ length: 240 }, (_, i) =>
      tile({ name: `t${i}`, url: B64, ruid: `ruid${i}`, px: [397, 720], category: "background" }),
    );
    useEditorStore.setState({ palette });
    const bytes = JSON.stringify(useEditorStore.getState().exportProject()).length;
    expect(bytes).toBeLessThan(200 * 1024); // 참조만이면 항목당 ~100B 수준
  });
});
