import { useEffect, useRef, useState } from "react";
import { useEditorStore, type Snapshot, type VisualFlags } from "../store/editorStore";
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
import { CODE_TO_TOOL } from "../lib/shortcuts";
import { makeEntityImageLookup } from "../lib/entityImage";
import { fallbackColor, type PaletteTile } from "../lib/palette";
import { ENTITY_META, entityFootprintCells, footprintWH, renderWH, isEntityIncomplete, type MapEntity } from "../types/entity";
import { EntityInspector } from "./EntityInspector";

function diamondPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
}

/**
 * 엔티티의 화면 사각형 [x0,y0,x1,y1].
 * 스프라이트(이미지 보유): 비율 유지 빌보드 — 폭 = tilesW*TW*zoom(=tilesW*2*hw), 베이스 셀 바닥 앵커.
 * 마커/포탈: 타일 다이아몬드 bbox.
 */
function entityRect(
  e: MapEntity,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  img: HTMLImageElement | null,
): [number, number, number, number] {
  if (img) {
    // 이미지 렌더 기준 footprint(baseW/H)를 덮는 빌보드. 폭 = (W+H)*hw, 전면 바닥-중앙 앵커.
    // ⚠ 점유(충돌) footprintWH 가 아닌 renderWH — W×H(점유) 조절이 이미지에 영향 주지 않도록 분리.
    const [fw, fh] = renderWH(e);
    const mul = e.scaleMul && e.scaleMul > 0 ? e.scaleMul : 1; // 사이즈 배율
    const zoom = hw / (TW / 2); // hw = TW/2*zoom → zoom 복원
    const ox = (e.offsetX ?? 0) * zoom; // 화면 오프셋(px×zoom)
    const oy = (e.offsetY ?? 0) * zoom;
    const wpx = (fw + fh) * hw * mul;
    const hpx = wpx * ((img.naturalHeight || 1) / (img.naturalWidth || 1));
    const bx = cx + ((fw - fh) / 2) * hw + ox; // footprint 바닥-중앙 x(베이스 셀 기준) + 오프셋
    const by = cy + (fw + fh - 1) * hh + oy; // footprint 전면 코너 바닥 y + 오프셋
    return [bx - wpx / 2, by - hpx, bx + wpx / 2, by];
  }
  return [cx - hw, cy - hh, cx + hw, cy + hh];
}

/** 엔티티 깊이 정렬(뒤→앞): gy 우선, gx 차선. draw/히트테스트 공용. */
const byEntityDepth = (a: MapEntity, b: MapEntity) => a.gy - b.gy || a.gx - b.gx;

/** 화면 점(px)이 닿는 최상단(앞쪽) 엔티티. 스프라이트는 빌보드 사각형, 마커는 셀 다이아 bbox 기준. */
function findEntityHit(
  px: number,
  py: number,
  entities: MapEntity[],
  palette: PaletteTile[],
  cam: Camera,
): MapEntity | null {
  const hw = (TW / 2) * cam.zoom;
  const hh = (TH / 2) * cam.zoom;
  const lookup = makeEntityImageLookup(palette);
  const sorted = [...entities].sort(byEntityDepth);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    const [cx, cy] = cellToScreen(e.gx, e.gy, cam);
    const [x0, y0, x1, y1] = entityRect(e, cx, cy, hw, hh, lookup(e));
    if (px >= x0 && px <= x1 && py >= y0 && py <= y1) return e;
  }
  return null;
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
  visual: VisualFlags,
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

  // 빈 다이아몬드 그리드 (격자 표시 토글)
  if (visual.grid) {
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

  // 이동불가 셀 오버레이는 엔티티(오브젝트) 위에 그린다 — 오브젝트 깔린 타일에 이동불가를 칠해도
  // 오브젝트에 가려지지 않고 보이도록(에디터 작업 UX). ↓ 엔티티 루프 다음에서 그림.

  // 엔티티(포탈/몬스터/NPC/오브젝트) — 타일 위에. gy→gx 순(뒤→앞).
  if (entities.length > 0) {
    const lookup = makeEntityImageLookup(palette);
    const sorted = [...entities].sort(byEntityDepth);
    for (const e of sorted) {
      if (e.gx < 0 || e.gy < 0 || e.gx >= W || e.gy >= H) continue;
      const [cx, cy] = cellToScreen(e.gx, e.gy, cam);
      if (!vis(cx, cy)) continue;
      const meta = ENTITY_META[e.kind];
      const img = lookup(e);
      const sel = e.id === selectedEntityId;

      let labelTop = cy - hh;
      if (img) {
        const cells = entityFootprintCells(e).filter(([gx, gy]) => gx < W && gy < H);
        // 충돌(이동불가) 오브젝트는 footprint 를 빨강(수동 이동불가와 동일)으로 표시 — 에디터 작업용 UX.
        const blocking = e.kind === "object" && e.blocks === true;

        // 1) footprint 채움 — 스프라이트 아래. 점유 표시 토글. blocking=빨강, 아니면 종류색.
        if (visual.footprint) {
          ctx.fillStyle = blocking ? (sel ? "rgba(220,70,70,0.42)" : "rgba(220,70,70,0.30)") : meta.color + (sel ? "33" : "1f");
          for (const [gx, gy] of cells) {
            const [fx, fy] = cellToScreen(gx, gy, cam);
            diamondPath(ctx, fx, fy, hw, hh);
            ctx.fill();
          }
        }

        // 2) 비율 유지 빌보드 — footprint 전면 바닥 앵커. 기울기(회전) + flipX 미러 적용.
        const [x0, y0, x1, y1] = entityRect(e, cx, cy, hw, hh, img);
        const rot = ((e.rotationDeg ?? 0) * Math.PI) / 180; // 기울기(라디안)
        ctx.save();
        if (rot) {
          const ax = (x0 + x1) / 2, ay = y1; // 바닥-중앙 앵커 기준 회전
          ctx.translate(ax, ay);
          ctx.rotate(rot);
          ctx.translate(-ax, -ay);
        }
        if (e.flipX) {
          ctx.translate(x0 + x1, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
        } else {
          ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
        }
        ctx.restore();
        labelTop = y0;

        // 3) footprint 외곽선 — 스프라이트 위에(점유 타일이 항상 보이도록). 점유 표시 토글.
        if (visual.footprint) {
          ctx.strokeStyle = blocking ? "#e05050" : meta.color;
          ctx.globalAlpha = sel ? 0.95 : 0.55;
          ctx.lineWidth = sel ? 1.6 : 1.2;
          for (const [gx, gy] of cells) {
            const [fx, fy] = cellToScreen(gx, gy, cam);
            diamondPath(ctx, fx, fy, hw, hh);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }

        // 3b) 플레이어 레이어 표식 — "위(above)" 오브젝트는 플레이어를 덮음(인게임). 에디터엔 플레이어가 없어
        //   배지로만 식별(D4). 상단-중앙에 ▲ 글자. (below/auto 는 표식 없음.)
        if (e.kind === "object" && e.layer === "above") {
          ctx.fillStyle = "#4aa3ff";
          ctx.font = `bold ${Math.max(10, Math.round(hh * 1.1))}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText("▲위", (x0 + x1) / 2, labelTop - 1);
        }

        // 4) 선택 시 — 흰 선택 박스 + 리사이즈 핸들(박스 우하단 코너, 통상적 위치).
        if (sel) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = meta.color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.rect(x1 - 7, y1 - 7, 14, 14);
          ctx.fill();
          ctx.stroke();
        }
      } else {
        // 이미지 없음 → 종류색 마커 + 글자 + 베이스 셀 링.
        diamondPath(ctx, cx, cy, hw, hh);
        ctx.strokeStyle = meta.color;
        ctx.globalAlpha = sel ? 1 : 0.7;
        ctx.lineWidth = sel ? 2.5 : 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        diamondPath(ctx, cx, cy, hw * 0.78, hh * 0.78);
        ctx.fillStyle = meta.color + "d0";
        ctx.fill();
        ctx.fillStyle = "#0e0f12";
        ctx.font = `bold ${Math.max(9, Math.round(hh * 0.9))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(meta.marker, cx, cy);
        if (sel) {
          diamondPath(ctx, cx, cy, hw + 4, hh + 4);
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // 미완성 배지 — 필수 필드(포탈 목적지/방향, 몬스터·NPC NpcClassID, 오브젝트 RUID) 누락.
      // 변환기 fail-closed 전에 눈으로 잡도록 항상 표시(오버레이 토글과 무관).
      if (isEntityIncomplete(e)) {
        const bx = cx + hw * 0.6;
        const by = labelTop + 2;
        ctx.beginPath();
        ctx.arc(bx, by, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#ff3b30";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("!", bx, by + 0.5);
      }

      // 라벨
      if (e.name && cam.zoom > 0.4) {
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const w = ctx.measureText(e.name).width;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(cx - w / 2 - 3, labelTop - 16, w + 6, 14);
        ctx.fillStyle = meta.color;
        ctx.fillText(e.name, cx, labelTop - 3);
      }
    }
  }

  // 이동불가 셀 — 빨강 다이아몬드 오버레이. 엔티티 위에 그려 오브젝트 깔린 타일도 보이게(이동불가 표시 토글).
  if (visual.blocked && blocked.size > 0) {
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
  const mode = useRef<"pan" | "paint" | "blockErase" | "rect" | "moveEntity" | "resizeEntity" | null>(null);
  const strokeBefore = useRef<Snapshot | null>(null);
  const rectStart = useRef<[number, number] | null>(null);
  const movingId = useRef<string | null>(null);
  // 리사이즈 시작 기준: 잡은 셀(gx,gy) + 그 순간 크기(w,h). 델타 기반 → 점프 없음.
  const resizeStart = useRef<{ gx: number; gy: number; w: number; h: number } | null>(null);
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
  const visual = useEditorStore((s) => s.visual);
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
      // 단축키는 e.code(물리 키)로 판정 — 한글 IME/레이아웃에서 e.key 가 자모로 바뀌어도 동작.
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
      } else if (mod && e.code === "KeyY") {
        e.preventDefault();
        useEditorStore.getState().redo();
      } else if (mod && e.code === "KeyD") {
        const sel = useEditorStore.getState().selectedEntityId;
        if (sel) {
          e.preventDefault();
          useEditorStore.getState().duplicateEntity(sel);
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const sel = useEditorStore.getState().selectedEntityId;
        if (sel) {
          e.preventDefault();
          useEditorStore.getState().removeEntity(sel);
        }
      } else if (!mod) {
        const t = CODE_TO_TOOL[e.code];
        if (t) useEditorStore.getState().setTool(t);
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
      if (e.button === 2) {
        // 우클릭: 이동불가 도구일 때만 지우기 스트로크(드래그 지속).
        if (st.activeTool === "block") {
          mode.current = "blockErase";
          strokeBefore.current = { ground: new Map(st.ground), blocked: new Set(st.blocked), entities: st.entities };
          st.setBlockedAt(gx, gy, false);
        }
        return;
      }
      if (e.button !== 0) return;
      const tool = st.activeTool;
      if (tool === "cursor") {
        // 커서 모드: 선택된 스프라이트의 선택박스 우하단 코너/우·하단 가장자리 → 드래그 리사이즈.
        const selEnt = st.selectedEntityId ? st.entities.find((e) => e.id === st.selectedEntityId) : null;
        if (selEnt && selEnt.kind !== "portal") {
          const img = makeEntityImageLookup(st.palette)(selEnt);
          if (img) {
            const z = st.camera.zoom;
            const hw = (TW / 2) * z;
            const hh = (TH / 2) * z;
            const [scx, scy] = cellToScreen(selEnt.gx, selEnt.gy, st.camera);
            const [x0, y0, x1, y1] = entityRect(selEnt, scx, scy, hw, hh, img);
            const M = 10;
            const nearRight = Math.abs(p.x - x1) <= M && p.y >= y0 - M && p.y <= y1 + M;
            const nearBottom = Math.abs(p.y - y1) <= M && p.x >= x0 - M && p.x <= x1 + M;
            if (nearRight || nearBottom) {
              const [fw, fh] = footprintWH(selEnt);
              mode.current = "resizeEntity";
              movingId.current = selEnt.id;
              resizeStart.current = { gx, gy, w: fw, h: fh }; // 잡은 셀 + 현재 크기
              strokeBefore.current = { ground: new Map(st.ground), blocked: new Set(st.blocked), entities: st.entities };
              return;
            }
          }
        }
        // 엔티티(스프라이트 본체 포함) 클릭 → 선택·이동. 빈 곳 → 맵 팬.
        const hit = findEntityHit(p.x, p.y, st.entities, st.palette, st.camera);
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
      } else if (mode.current === "blockErase") {
        st.setBlockedAt(gx, gy, false);
      } else if (mode.current === "rect" && rectStart.current) {
        st.setRectPreview([rectStart.current[0], rectStart.current[1], gx, gy]);
      } else if (mode.current === "moveEntity" && movingId.current) {
        st.moveEntityTo(movingId.current, gx, gy);
      } else if (mode.current === "resizeEntity" && movingId.current && resizeStart.current) {
        // 델타 기반: 잡은 셀 대비 이동량을 시작 크기에 더함(점프 없음).
        const rs = resizeStart.current;
        st.setEntitySize(movingId.current, rs.w + (gx - rs.gx), rs.h + (gy - rs.gy));
      }
      st.setHover([gx, gy]);
    };
    const onUp = () => {
      const st = useEditorStore.getState();
      if ((mode.current === "paint" || mode.current === "blockErase") && strokeBefore.current) {
        st.commitStroke(strokeBefore.current);
      } else if ((mode.current === "moveEntity" || mode.current === "resizeEntity") && strokeBefore.current) {
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
      resizeStart.current = null;
    };
    const onLeave = () => {
      useEditorStore.getState().setHover(null);
    };
    const onContext = (e: MouseEvent) => e.preventDefault(); // 우클릭 지우기 — 브라우저 메뉴 차단
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("contextmenu", onContext);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("contextmenu", onContext);
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
    draw(ctx, dims, size, camera, hover, ground, blocked, palette, rectPreview, entities, selectedEntityId, visual);
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
    visual,
  ]);

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <canvas ref={canvasRef} style={{ cursor: activeTool === "cursor" ? "grab" : "crosshair" }} />
      <EntityInspector />
    </div>
  );
}
