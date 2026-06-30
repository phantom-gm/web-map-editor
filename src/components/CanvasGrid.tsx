import { useEffect, useRef, useState } from "react";
import { useEditorStore, type Snapshot } from "../store/editorStore";
import {
  TW,
  TH,
  cellToScreen,
  screenToCell,
  fitCamera,
  type Camera,
  type Dims,
} from "../lib/grid";
import { parseCellKey } from "../lib/cell";
import { fallbackColor, type PaletteTile } from "../lib/palette";
import { ENTITY_META, type MapEntity } from "../types/entity";
import { EntityInspector } from "./EntityInspector";

function diamondPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
}

function draw(
  ctx: CanvasRenderingContext2D,
  dims: Dims,
  size: [number, number],
  cam: Camera,
  hover: [number, number] | null,
  ground: Map<string, number>,
  blocked: Set<string>,
  palette: PaletteTile[],
  rectPreview: [number, number, number, number] | null,
  entities: MapEntity[],
  selectedEntityId: string | null,
) {
  ctx.clearRect(0, 0, dims.w, dims.h);
  ctx.fillStyle = "#15161a";
  ctx.fillRect(0, 0, dims.w, dims.h);

  const [W, H] = size;
  const hw = (TW / 2) * cam.zoom;
  const hh = (TH / 2) * cam.zoom;

  // 뷰포트 컬링: 다이아몬드 중심이 캔버스(+반칸 마진) 밖이면 스킵 → 큰 맵에서도 부드럽게.
  const vis = (cx: number, cy: number) =>
    cx >= -hw && cx <= dims.w + hw && cy >= -hh && cy <= dims.h + hh;

  // 빈 다이아몬드 그리드
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#2c2f3a";
  for (let gy = 0; gy < H; gy++) {
    for (let gx = 0; gx < W; gx++) {
      const [cx, cy] = cellToScreen(gx, gy, cam);
      if (!vis(cx, cy)) continue;
      diamondPath(ctx, cx, cy, hw, hh);
      ctx.fillStyle = "#1d1f26";
      ctx.fill();
      ctx.stroke();
    }
  }

  // 칠해진 셀 — iso 깊이순(gx+gy)
  const cells: Array<[number, number, number]> = [];
  for (const [k, idx] of ground) {
    const [gx, gy] = parseCellKey(k);
    cells.push([gx, gy, idx]);
  }
  cells.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [gx, gy, idx] of cells) {
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
    const [cx, cy] = cellToScreen(gx, gy, cam);
    if (!vis(cx, cy)) continue;
    const tile = palette[idx];
    if (tile && tile.img) {
      ctx.drawImage(tile.img, cx - hw, cy - hh, hw * 2, hh * 2);
    } else {
      diamondPath(ctx, cx, cy, hw, hh);
      ctx.fillStyle = fallbackColor(idx);
      ctx.fill();
    }
  }

  // 이동불가 셀 — 빨강 다이아몬드 오버레이
  if (blocked.size > 0) {
    ctx.fillStyle = "rgba(220,70,70,0.32)";
    ctx.strokeStyle = "#e05050";
    ctx.lineWidth = 1.5;
    for (const k of blocked) {
      const [gx, gy] = parseCellKey(k);
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
      const [cx, cy] = cellToScreen(gx, gy, cam);
      if (!vis(cx, cy)) continue;
      diamondPath(ctx, cx, cy, hw, hh);
      ctx.fill();
      ctx.stroke();
    }
  }

  // 엔티티(포탈/몬스터/NPC/오브젝트) — 타일 위에. gy→gx 순(뒤→앞).
  if (entities.length > 0) {
    const byRuid = new Map<string, HTMLImageElement>();
    const byName = new Map<string, HTMLImageElement>();
    for (const t of palette) {
      if (!t.img) continue;
      if (t.ruid) byRuid.set(t.ruid, t.img);
      if (t.name) byName.set(t.name, t.img);
    }
    const sorted = [...entities].sort((a, b) => a.gy - b.gy || a.gx - b.gx);
    for (const e of sorted) {
      if (e.gx < 0 || e.gy < 0 || e.gx >= W || e.gy >= H) continue;
      const [cx, cy] = cellToScreen(e.gx, e.gy, cam);
      if (!vis(cx, cy)) continue;
      const meta = ENTITY_META[e.kind];
      const img =
        e.kind !== "portal"
          ? (e.ruid && byRuid.get(e.ruid)) || (e.name && byName.get(e.name)) || null
          : null;
      if (img) {
        ctx.drawImage(img, cx - hw, cy - hh, hw * 2, hh * 2);
      } else {
        diamondPath(ctx, cx, cy, hw * 0.78, hh * 0.78);
        ctx.fillStyle = meta.color + "d0";
        ctx.fill();
        ctx.fillStyle = "#0e0f12";
        ctx.font = `bold ${Math.max(9, Math.round(hh * 0.9))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(meta.marker, cx, cy);
      }
      // 종류색 외곽 링 + 선택 강조
      diamondPath(ctx, cx, cy, hw, hh);
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = e.id === selectedEntityId ? 3 : 1.5;
      ctx.stroke();
      if (e.id === selectedEntityId) {
        diamondPath(ctx, cx, cy, hw + 4, hh + 4);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // 라벨
      if (e.name && cam.zoom > 0.4) {
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const w = ctx.measureText(e.name).width;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(cx - w / 2 - 3, cy - hh - 16, w + 6, 14);
        ctx.fillStyle = meta.color;
        ctx.fillText(e.name, cx, cy - hh - 3);
      }
    }
  }

  // rect 미리보기
  if (rectPreview) {
    const [x0, y0, x1, y1] = rectPreview;
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    ctx.fillStyle = "rgba(120,220,140,0.28)";
    ctx.strokeStyle = "#6fd08a";
    ctx.lineWidth = 1.5;
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
        const [cx, cy] = cellToScreen(gx, gy, cam);
        diamondPath(ctx, cx, cy, hw, hh);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // 호버
  if (hover) {
    const [hx, hy] = hover;
    if (hx >= 0 && hy >= 0 && hx < W && hy < H) {
      const [cx, cy] = cellToScreen(hx, hy, cam);
      diamondPath(ctx, cx, cy, hw, hh);
      ctx.fillStyle = "rgba(90,160,255,0.22)";
      ctx.fill();
      ctx.strokeStyle = "#5aa0ff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

export function CanvasGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<Dims>({ w: 800, h: 600 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const mode = useRef<"pan" | "paint" | "rect" | "moveEntity" | null>(null);
  const strokeBefore = useRef<Snapshot | null>(null);
  const rectStart = useRef<[number, number] | null>(null);
  const movingId = useRef<string | null>(null);
  const spaceDown = useRef(false);
  const didInit = useRef(false);

  const size = useEditorStore((s) => s.size);
  const camera = useEditorStore((s) => s.camera);
  const hover = useEditorStore((s) => s.hover);
  const fitNonce = useEditorStore((s) => s.fitNonce);
  const groundVer = useEditorStore((s) => s.groundVer);
  const ground = useEditorStore((s) => s.ground);
  const blocked = useEditorStore((s) => s.blocked);
  const blockedVer = useEditorStore((s) => s.blockedVer);
  const palette = useEditorStore((s) => s.palette);
  const rectPreview = useEditorStore((s) => s.rectPreview);
  const activeTool = useEditorStore((s) => s.activeTool);
  const entities = useEditorStore((s) => s.entities);
  const entitiesVer = useEditorStore((s) => s.entitiesVer);
  const selectedEntityId = useEditorStore((s) => s.selectedEntityId);
  const setCamera = useEditorStore((s) => s.setCamera);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setDims({ w: Math.max(1, Math.floor(r.width)), h: Math.max(1, Math.floor(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (dims.w <= 1 || didInit.current) return;
    didInit.current = true;
    setCamera(fitCamera(dims, size));
  }, [dims, size, setCamera]);

  useEffect(() => {
    if (!didInit.current) return;
    setCamera(fitCamera(dims, size));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, fitNonce]);

  // 키보드: Space(팬) + undo/redo
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDown.current = true;
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
      } else if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        useEditorStore.getState().redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const sel = useEditorStore.getState().selectedEntityId;
        if (sel) {
          e.preventDefault();
          useEditorStore.getState().removeEntity(sel);
        }
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, []);

  // 마우스/휠
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const local = (e: MouseEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      useEditorStore.getState().zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, p.x, p.y);
    };
    const onDown = (e: MouseEvent) => {
      const p = local(e);
      const st = useEditorStore.getState();
      const [gx, gy] = screenToCell(p.x, p.y, st.camera);
      if (e.button === 1 || spaceDown.current) {
        mode.current = "pan";
        drag.current = p;
        return;
      }
      if (e.button !== 0) return;
      const tool = st.activeTool;
      if (tool === "cursor") {
        // 커서 모드: 엔티티 클릭 → 선택·이동. 빈 곳 → 맵 팬. 칠하지 않음.
        const hit = st.entityAt(gx, gy);
        if (hit) {
          st.selectEntity(hit.id);
          mode.current = "moveEntity";
          movingId.current = hit.id;
          strokeBefore.current = { ground: new Map(st.ground), blocked: new Set(st.blocked), entities: st.entities };
        } else {
          st.selectEntity(null);
          mode.current = "pan";
          drag.current = p;
        }
        return;
      }
      if (tool === "portal" || tool === "monster" || tool === "npc" || tool === "object") {
        if (tool !== "portal" && !st.palette[st.activeIdx]) {
          alert("먼저 팔레트에서 배치할 스프라이트를 선택하세요 (스토리지에서 불러오기).");
          return;
        }
        st.placeEntity(tool, gx, gy);
        return;
      }
      if (tool === "eyedropper") {
        st.pickAt(gx, gy);
      } else if (tool === "rect") {
        mode.current = "rect";
        rectStart.current = [gx, gy];
        st.setRectPreview([gx, gy, gx, gy]);
      } else {
        // brush / eraser / block — 스트로크 단위. 시작 시 ground+blocked+entities 스냅샷.
        mode.current = "paint";
        strokeBefore.current = { ground: new Map(st.ground), blocked: new Set(st.blocked), entities: st.entities };
        st.applyTool(gx, gy);
      }
    };
    const onMove = (e: MouseEvent) => {
      const p = local(e);
      const st = useEditorStore.getState();
      const [gx, gy] = screenToCell(p.x, p.y, st.camera);
      if (mode.current === "pan" && drag.current) {
        st.panBy(p.x - drag.current.x, p.y - drag.current.y);
        drag.current = p;
      } else if (mode.current === "paint") {
        st.applyTool(gx, gy);
      } else if (mode.current === "rect" && rectStart.current) {
        st.setRectPreview([rectStart.current[0], rectStart.current[1], gx, gy]);
      } else if (mode.current === "moveEntity" && movingId.current) {
        st.moveEntityTo(movingId.current, gx, gy);
      }
      st.setHover([gx, gy]);
    };
    const onUp = () => {
      const st = useEditorStore.getState();
      if (mode.current === "paint" && strokeBefore.current) {
        st.commitStroke(strokeBefore.current);
      } else if (mode.current === "moveEntity" && strokeBefore.current) {
        st.commitStroke(strokeBefore.current);
      } else if (mode.current === "rect") {
        const rp = st.rectPreview;
        if (rp) st.fillRect(rp[0], rp[1], rp[2], rp[3]);
        st.setRectPreview(null);
      }
      mode.current = null;
      drag.current = null;
      strokeBefore.current = null;
      rectStart.current = null;
      movingId.current = null;
    };
    const onLeave = () => {
      useEditorStore.getState().setHover(null);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onLeave);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  // 캔버스 버퍼/표시 크기 — dims 변경 시에만. (canvas.width 대입은 백버퍼 재할당이라
  // 매 redraw마다 하면 마우스 이동 1회당 버퍼를 새로 만든다 → 분리.)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.w * dpr;
    canvas.height = dims.h * dpr;
    canvas.style.width = dims.w + "px";
    canvas.style.height = dims.h + "px";
  }, [dims]);

  // 그리기 — 매 상태 변경. 재할당 없이 transform + draw 만.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, dims, size, camera, hover, ground, blocked, palette, rectPreview, entities, selectedEntityId);
  }, [
    dims,
    size,
    camera,
    hover,
    ground,
    groundVer,
    blocked,
    blockedVer,
    palette,
    rectPreview,
    entities,
    entitiesVer,
    selectedEntityId,
  ]);

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <canvas ref={canvasRef} style={{ cursor: activeTool === "cursor" ? "grab" : "crosshair" }} />
      <EntityInspector />
    </div>
  );
}
