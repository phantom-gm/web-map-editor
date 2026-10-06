import { useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import { objectAnchor, type ObjectSortSetting } from "../lib/objectSorting.cjs";
import type { GameObjectDescriptor } from "../lib/gameObjects";
import type { GamePreviewScene } from "../lib/gamePreview";
import { parseCellKey, type CellKey } from "../lib/cell";
import { NumberField } from "./NumberField";
import "./ObjectSortingPanel.css";

export function ObjectSortingPanel({ object, scene, disabled, cells }: {
  object: GameObjectDescriptor; scene: GamePreviewScene; disabled: boolean; cells: CellKey[];
}) {
  const [choosingSupport, setChoosingSupport] = useState(false);
  const preview = useGamePreviewStore();
  const setting = useEditorStore(s => s.gameObjectEdits?.sorting?.find(row => row.entityId === object.entityId)?.setting);
  const mode = choosingSupport ? "surface" : setting?.mode ?? "original";
  const anchor = objectAnchor(object.position, scene.constants);
  const footprint = object.sortInfo?.footprint;
  const sprite = scene.sprites.find(s => s.objectEntityId === object.entityId);
  const asset = preview.images.get(object.ruid)?.asset;
  const locked = disabled || !object.canMove;
  const set = (value?: ObjectSortSetting) => { setChoosingSupport(false); useEditorStore.getState().sortGameObject(object.entityId, value, scene); };
  // Runtime gates are centred on the anchor. Enclose an off-centre/rotated image
  // conservatively so changing its footprint never drops adjacent sorting checks.
  let bounds = object.sortInfo?.bounds ?? [0, 0];
  if (asset && sprite) {
    const ppu = asset.pixelsPerUnit ?? scene.constants.PPU;
    const sx = Math.abs(sprite.scale[0]), sy = Math.abs(sprite.scale[1]);
    const angle = sprite.rotationDeg * Math.PI / 180;
    const x = asset.width / ppu * Math.max(Math.abs(asset.pivot[0]), Math.abs(1 - asset.pivot[0])) * sx;
    const y = asset.height / ppu * Math.max(Math.abs(asset.pivot[1]), Math.abs(1 - asset.pivot[1])) * sy;
    if (sx > 0 && sy > 0) bounds = [2 * (Math.abs(Math.cos(angle)) * x + Math.abs(Math.sin(angle)) * y) / .64 / sx,
      2 * (Math.abs(Math.sin(angle)) * x + Math.abs(Math.cos(angle)) * y) / .64 / sy];
  }
  const floor: Extract<ObjectSortSetting, { mode: "floor" }> = setting?.mode === "floor" ? setting : {
    mode: "floor", offset: footprint ? [footprint[0] - anchor[0], footprint[1] - anchor[1]] : [0, 0],
    size: footprint ? [footprint[2], footprint[3]] : [1, 1], bounds: [bounds[0], bounds[1]], padX: object.sortInfo?.padX ?? 0,
  };
  const canFloor = floor.bounds.every(n => Number.isFinite(n) && n > 0);
  const supports = (scene.objects ?? []).filter(o => o.entityId !== object.entityId && o.canMove &&
    o.sortSetting?.mode !== "surface" && o.sortSetting?.mode !== "wall" && o.sortInfo?.order === 0);
  const points = cells.map(parseCellKey);
  const minX = Math.min(...points.map(p => p[0])), minY = Math.min(...points.map(p => p[1]));
  const width = Math.max(...points.map(p => p[0])) - minX + 1, height = Math.max(...points.map(p => p[1])) - minY + 1;
  const rectangle = cells.length > 0 && width * height === new Set(cells).size && width <= 256 && height <= 256;
  return <div className="object-sorting" aria-label="앞뒤 가림 설정">
    <strong>앞뒤 가림 설정</strong>
    <label className="sort-field"><span>배치 역할</span>
      <select value={mode} disabled={locked} onChange={e => {
        if (e.target.value === "surface") setChoosingSupport(true);
        else if (e.target.value === "floor") set(floor);
        else set(e.target.value === "wall" ? { mode: "wall" } : undefined);
      }}>
        <option value="original">원본 설정 유지</option>
        <option value="floor" disabled={!canFloor}>바닥 가구</option>
        <option value="wall">벽 장식</option>
        <option value="surface">가구 위 소품</option>
      </select>
    </label>
    {mode === "original" && <p className="object-help">현재 게임의 정렬값을 유지합니다. 역할을 선택하면 이 배치에만 적용됩니다.</p>}
    {mode === "wall" && <p className="object-help">벽 앞·캐릭터 뒤에 표시합니다. 액자, 벽에 건 허브처럼 벽에 붙은 장식에 사용하세요.</p>}
    {mode === "surface" && <>
      <label className="sort-field"><span>받치는 가구</span><select disabled={locked} value={setting?.mode === "surface" ? setting.supportId : ""}
        onChange={e => { if (e.target.value) set({ mode: "surface", supportId: e.target.value }); }}>
        <option value="">가구를 선택하세요</option>
        {supports.map(o => <option key={o.entityId} value={o.entityId}>{o.name} · 칸 {objectAnchor(o.position, scene.constants).join(", ")}</option>)}
      </select></label>
      {setting?.mode === "surface" && <button className="ei-fit" onClick={() => useEditorStore.getState().selectGameObjects([setting.supportId], "replace")}>받치는 가구 선택</button>}
      <p className="object-help">가구의 앞뒤 순서를 따릅니다. 위치는 따로 유지되므로 함께 옮길 때는 가구와 소품을 묶어 선택하세요.</p>
      {choosingSupport && <p className="object-help">가구를 선택해야 설정이 적용됩니다. <button onClick={() => setChoosingSupport(false)}>취소</button></p>}
      {!supports.length && <p role="status">받칠 오브젝트를 먼저 바닥 가구로 설정하세요.</p>}
    </>}
    {mode === "floor" && <>
      <p className="object-help">그림 전체가 아닌, 가구가 바닥에서 차지하는 칸을 맞추세요. 금색 영역이 앞뒤 판정에 사용됩니다.</p>
      <div className="sort-grid">
        <label>시작 X칸<NumberField value={anchor[0] + floor.offset[0]} disabled={locked} onCommit={n => set({ ...floor, offset: [n - anchor[0], floor.offset[1]] })} /></label>
        <label>시작 Y칸<NumberField value={anchor[1] + floor.offset[1]} disabled={locked} onCommit={n => set({ ...floor, offset: [floor.offset[0], n - anchor[1]] })} /></label>
        <label>X 방향 칸 수<NumberField value={floor.size[0]} min={1} max={256} disabled={locked} onCommit={n => set({ ...floor, size: [n, floor.size[1]] })} /></label>
        <label>Y 방향 칸 수<NumberField value={floor.size[1]} min={1} max={256} disabled={locked} onCommit={n => set({ ...floor, size: [floor.size[0], n] })} /></label>
      </div>
      <button className="ei-fit" disabled={locked || !rectangle} title="이동불가 칸을 빈틈없는 사각형으로 선택하세요."
        onClick={() => set({ ...floor, offset: [minX - anchor[0], minY - anchor[1]], size: [width, height] })}>선택한 이동불가 영역 사용</button>
      <p className="object-help">이 설정은 이동불가 칸을 추가하거나 지우지 않습니다. 1×1은 한 칸 기준 정렬을 사용합니다.</p>
    </>}
    {setting && <button className="ei-fit" disabled={locked} onClick={() => set()}>정렬만 원본으로 되돌리기</button>}
  </div>;
}
