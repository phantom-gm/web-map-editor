import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore, objectDefaultsFor, pickObjectTweaks } from "../store/editorStore";
import type { PaletteTile } from "../lib/palette";
import type { MapEntity } from "../types/entity";

// 요청서 R3 — 같은 RUID 를 새로 놓을 때 마지막 저작값(offset·배율·기울기·점유·충돌·레이어)이 기본으로 채워진다.
//   가로등 12개가 전부 17px 였던 것은 "한 번 놓고 복사"였다 — 값을 한 번 정하면 맵 전체에 일관되게 퍼지게.
const objTile = (name: string, ruid: string): PaletteTile =>
  ({
    name,
    category: "object",
    ruid,
    regStatus: undefined,
    img: { naturalWidth: 64, naturalHeight: 96 } as unknown as HTMLImageElement,
  }) as unknown as PaletteTile;

function place(gx: number, gy: number): MapEntity {
  useEditorStore.getState().placeEntity("object", gx, gy);
  const ents = useEditorStore.getState().entities;
  return ents[ents.length - 1];
}

describe("objectDefaults (R3)", () => {
  beforeEach(() => {
    useEditorStore.getState().newProject();
    useEditorStore.setState({ palette: [objTile("가로등_A", "r-lamp"), objTile("바위_B", "r-rock")], activeIdx: 0, objectDefaults: {} });
  });

  it("저작(updateEntity)한 값이 같은 RUID 의 다음 배치에 기본으로 채워진다", () => {
    const a = place(3, 3);
    expect(a.offsetY).toBeUndefined();
    useEditorStore.getState().updateEntity(a.id, { offsetY: 11, scaleMul: 0.8 });
    const b = place(7, 7);
    expect(b.offsetY).toBe(11);
    expect(b.scaleMul).toBe(0.8);
    expect(b.id).not.toBe(a.id);
  });

  it("다른 RUID 에는 번지지 않는다", () => {
    const a = place(3, 3);
    useEditorStore.getState().updateEntity(a.id, { offsetY: 11 });
    useEditorStore.setState({ activeIdx: 1 });
    const rock = place(5, 5);
    expect(rock.ruid).toBe("r-rock");
    expect(rock.offsetY).toBeUndefined();
  });

  it("세션 기억이 없으면 지금 맵의 같은 RUID 중 **마지막** 오브젝트의 값을 쓴다(재로드 뒤에도 일관)", () => {
    useEditorStore.setState({
      entities: [
        { id: "old", kind: "object", gx: 1, gy: 1, ruid: "r-lamp", offsetY: 17 },
        { id: "new", kind: "object", gx: 2, gy: 2, ruid: "r-lamp", offsetY: 9, blocks: true, layer: "below" },
      ],
      objectDefaults: {},
    });
    const c = place(8, 8);
    expect(c.offsetY).toBe(9);
    expect(c.blocks).toBe(true);
    expect(c.layer).toBe("below");
  });

  it("sortOffset·flipX·이름·좌표는 옮기지 않는다 — 에셋 성질이 아니다", () => {
    const a = place(3, 3);
    useEditorStore.getState().updateEntity(a.id, { offsetY: 11, sortOffset: 2, flipX: true, name: "가로등(왼쪽)" });
    const b = place(7, 7);
    expect(b.offsetY).toBe(11);
    expect(b.sortOffset).toBeUndefined();
    expect(b.flipX).toBeUndefined();
    expect(b.name).toBe("가로등_A");
    expect([b.gx, b.gy]).toEqual([7, 7]);
  });

  it("undefined 로 지운 값은 기억에서도 빠진다(0 으로 되돌린 offset 이 다시 살아나지 않는다)", () => {
    const a = place(3, 3);
    useEditorStore.getState().updateEntity(a.id, { offsetY: 17 });
    useEditorStore.getState().updateEntity(a.id, { offsetY: undefined });
    expect(useEditorStore.getState().objectDefaults["r-lamp"].offsetY).toBeUndefined();
    const b = place(7, 7);
    expect(b.offsetY).toBeUndefined();
  });

  it("점유(tilesW/H) 기본값은 경계 클램프보다 먼저 적용된다 — 앵커가 맵 안에 남는다", () => {
    const a = place(3, 3);
    useEditorStore.getState().updateEntity(a.id, { tilesW: 3, tilesH: 2 });
    const b = place(0, 0); // 앵커 하한 = (fw−1, fh−1) = (2, 1)
    expect([b.tilesW, b.tilesH]).toEqual([3, 2]);
    expect([b.gx, b.gy]).toEqual([2, 1]);
  });

  it("objectDefaultsFor / pickObjectTweaks — 순수 함수", () => {
    const e: MapEntity = { id: "x", kind: "object", gx: 0, gy: 0, ruid: "r", offsetX: 3, offsetY: 11, sortOffset: 1, name: "n" };
    expect(pickObjectTweaks(e)).toEqual({ offsetX: 3, offsetY: 11 });
    expect(objectDefaultsFor("r", { r: { offsetY: 5 } }, [e])).toEqual({ offsetY: 5 });
    expect(objectDefaultsFor("r", {}, [e])).toEqual({ offsetX: 3, offsetY: 11 });
    expect(objectDefaultsFor("none", {}, [e])).toBeNull();
    expect(objectDefaultsFor(undefined, {}, [e])).toBeNull();
  });
});
