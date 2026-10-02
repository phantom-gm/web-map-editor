import { GameObjectInspector } from "./GameObjectPanel";
import { previewScreenToWorld, gameObjectHitCandidates, snapObjectPosition, objectCellOffset, sceneWithGameObjectGroupDraft, drawGameObjectSelection, gameObjectsInScreenRect } from "../lib/gameObjectPreview";
import type { GameObjectDescriptor, GameObjectPosition } from "../lib/gameObjects";
import { useEffect, useRef, useState } from "react";
import { useEditorStore, captureEditorSnapshot, type Snapshot, type VisualFlags } from "../store/editorStore";
import {
  TW,
  TH,
  cellToScreen,
  screenToCell,
  fitCamera,
  type Camera,
  type Dims,
} from "../lib/grid";
import { cellKey, parseCellKey, type CellKey } from "../lib/cell";
import { CODE_TO_TOOL } from "../lib/shortcuts";
import { makeEntityImageLookup } from "../lib/entityImage";
import { fallbackColor, type PaletteTile } from "../lib/palette";
import { ENTITY_META, entityDisplayFootprintCells, isEntityIncomplete, type MapEntity } from "../types/entity";
import { sortEntitiesForDraw, entityImageRect, entityPivot } from "../lib/entityGeom";
import { baselineDyPx, isSouthCandidate, judgeSouth, SOUTH_CELL_PX, type StandCtx } from "../lib/southIntrusion";
import { isSortGateTarget, sortGatePx } from "../lib/sortGate";
import { selectStandCtx } from "../store/southSelectors";
import { EntityInspector } from "./EntityInspector";
import { drawGamePreview, fitPreviewCamera, type GamePreviewImages, type GamePreviewScene } from "../lib/gamePreview";
import { useGamePreview } from "../lib/useGamePreview";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import { useWorkspaceSession } from "../lib/gameWorkspace";

const GROUND_TOOLS = new Set(["cursor", "brush", "eraser", "rect", "eyedropper", "block", "object"]);
interface PreviewFrame { scene: GamePreviewScene | null; images: GamePreviewImages; showOverlays: boolean }
function linkedGroundReady(baselineId: string): boolean {
  const preview = useGamePreviewStore.getState();
  return preview.status === "ready" && preview.scene?.baselineId === baselineId &&
    preview.scene.report?.groundEditingSupported === true;
}

// 배지·바닥선 색 — 남쪽 침범 판정 단계별(요청서 R1·R2). watch=주황(경고) · block=빨강(빌드 게이트가 막음) · 없음=하늘(정상).
//   ⚠ globals.css 의 .ei-warn-watch/.ei-warn-block/.sb-warn/.sb-block 이 같은 두 색을 쓴다 — 캔버스는 CSS 변수를 못 읽어 값이 두 벌이다. 같이 바꿀 것.
const SOUTH_COLOR = { watch: "#ffb02e", block: "#ff3b30", ok: "#7fd6ff" } as const;

/**
 * 선택한 오브젝트의 **정렬 바닥선**(요청서 R2) — 게임이 앞뒤를 정하는 선(스프라이트 바닥 = 셀 중심 + offsetY)을 가로선으로,
 * 남쪽 이웃 칸 중심(넘으면 그 칸 액터가 뒤로 감)을 점선 + 점(설 수 있으면 초록, 아니면 회색)으로 그린다.
 * 저작자가 "왜 이 값이 문제인지"를 눈으로 보게 하는 것이 목적이라, 다른 스프라이트 위에 그린다(호출측이 루프 뒤로 미룬다).
 */
function drawSortBaseline(
  ctx: CanvasRenderingContext2D,
  e: MapEntity,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  cam: Camera,
  stand: StandCtx,
  level: "watch" | "block" | "ok",
) {
  const dyPx = baselineDyPx(e);
  const by = cy + dyPx * cam.zoom;
  // 남쪽 이웃 두 칸 — 화면 좌표는 cellToScreen 하나가 정한다(손계산 투영 금지). 두 칸은 같은 y 라 점선은 첫 칸의 y 로 긋는다.
  const neighbors = ([[e.gx + 1, e.gy], [e.gx, e.gy + 1]] as Array<[number, number]>).map(
    ([nx, ny]) => ({ can: !stand.cannotStand.has(cellKey(nx, ny)), at: cellToScreen(nx, ny, cam) }),
  );
  const guideY = neighbors[0].at[1];
  ctx.save();
  // 남쪽 이웃 중심선(점선) — 바닥선이 여기 이하로 내려가면 앞 칸에 선 캐릭터가 오브젝트 뒤로 간다.
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - hw * 1.3, guideY);
  ctx.lineTo(cx + hw * 1.3, guideY);
  ctx.stroke();
  ctx.setLineDash([]);
  // 이웃 두 칸의 중심점 — 판정 대상(설 수 있음)이면 초록.
  for (const n of neighbors) {
    ctx.fillStyle = n.can ? "#6fd08a" : "#6b7180";
    ctx.beginPath();
    ctx.arc(n.at[0], n.at[1], Math.max(2.5, hh * 0.18), 0, Math.PI * 2);
    ctx.fill();
  }
  // 바닥선 — 단계 색.
  ctx.strokeStyle = SOUTH_COLOR[level];
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - hw, by);
  ctx.lineTo(cx + hw, by);
  ctx.stroke();
  // 라벨 — 현재 offsetY 와 앞 칸까지의 여유(px). 여유 ≤ 0 이면 액터가 뒤.
  const clearance = SOUTH_CELL_PX - dyPx;
  const txt = `바닥선 ${dyPx}px · 앞 칸 여유 ${clearance}px`;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(txt).width;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(cx + hw + 4, by - 8, tw + 8, 16);
  ctx.fillStyle = SOUTH_COLOR[level];
  ctx.fillText(txt, cx + hw + 8, by);
  ctx.restore();
}

// 정렬 게이트 경계 색 — 종류색(오브젝트 금 · 포탈 보라)·남쪽 침범색(주황·빨강·하늘)과 겹치지 않는 분홍.
const GATE_COLOR = "#ff79c6";

/**
 * 선택한 멀티셀 오브젝트의 **정렬 게이트 경계**(sortPadX 요청서 R3) — 게임이 캐릭터를 이 건물 앞/뒤로 보정하는 가로 범위의
 * 좌우 끝을 세로선 두 개로(세로 길이 = 게이트 세로 범위). 이 선이 걷는 길 한가운데를 지나면 그 좌우 칸의 캐릭터끼리
 * 앞뒤가 뒤집힌다 → sortPadX 로 선을 이동불가·덜 다니는 쪽으로 옮긴다. 패딩이 있으면 패딩 0 자리를 옅은 점선으로 같이 그린다.
 * 산식은 lib/sortGate(게임 SortGateSpan 미러) 한 곳이 소유한다.
 */
function drawSortGate(ctx: CanvasRenderingContext2D, e: MapEntity, cx: number, cy: number, zoom: number, naturalWidth: number) {
  const g = sortGatePx(e, naturalWidth);
  if (!g) return;
  const X = (v: number) => cx + v * zoom;
  const top = cy + g.y0 * zoom;
  const bottom = cy + g.y1 * zoom;
  const vline = (x: number) => {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  };
  ctx.save();
  ctx.strokeStyle = GATE_COLOR;
  if (g.pad > 0) {
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    vline(X(g.baseX0));
    vline(X(g.baseX1));
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = 2;
  vline(X(g.x0));
  vline(X(g.x1));
  // 라벨 — 왼쪽 선 위쪽. 패딩을 타일 수로 읽게 한다(값 고르는 기준이 게임 depth_check (11) 칸 목록이라 칸 단위가 맞다).
  const txt = g.pad > 0 ? `정렬 경계 · sortPadX ${g.pad} (좌우 ${g.pad}칸 넓힘)` : "정렬 경계 · sortPadX 0";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const tw = ctx.measureText(txt).width;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(X(g.x0) + 4, top, tw + 8, 15);
  ctx.fillStyle = GATE_COLOR;
  ctx.fillText(txt, X(g.x0) + 8, top + 2);
  ctx.restore();
}

// 스트로크/이동 커밋용 언두 스냅샷(ground+blocked+entities). commitStroke 가 소비.
//   입력은 store 상태(Snapshot 과 구조 동일) — ground/blocked 만 얕은 복사.
const strokeSnap = captureEditorSnapshot;

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
 * object: MSW 동형 — 이미지 중심을 앵커 셀 중심에(에셋 기본 pivot=중심), 폭 = renderW타일×배율.
 * monster/npc: 프리뷰 billboard — footprint 를 덮고 전면 바닥-중앙 앵커(게임은 모델 스폰).
 * 마커/포탈: 타일 다이아몬드 bbox. (상세: OBJECT_PIVOT_ALIGNMENT.md)
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
    // 수식은 entityGeom.entityImageRect(순수함수·유닛 잠금)로 위임 — 여기선 img 치수만 전달.
    return entityImageRect(e, cx, cy, hw, hh, img.naturalWidth || 1, img.naturalHeight || 1);
  }
  return [cx - hw, cy - hh, cx + hw, cy + hh];
}

// 알파(픽셀) 히트테스트용 1×1 오프스크린 — 클릭당 1회만 쓰므로 렌더 루프 부담 0.
let hitCtx: CanvasRenderingContext2D | null = null;
const ALPHA_MIN = 8; // 이보다 투명하면 "안 맞음"(여백 통과)
const CLICK_SLOP = 3; // px. 이 안에서 떼면 "드래그 아님 = 클릭"(겹침 순환 판정)

/**
 * 스프라이트의 (px,py) 지점 알파가 불투명한지. draw 와 동일한 변환(회전·flipX)을 적용한 뒤
 * 클릭 지점을 원점으로 옮겨 1픽셀만 샘플링한다 → 투명 여백이 클릭을 훔치지 않음.
 */
function spriteAlphaHit(
  e: MapEntity,
  img: HTMLImageElement,
  px: number,
  py: number,
  rect: [number, number, number, number],
): boolean {
  if (!hitCtx) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    hitCtx = c.getContext("2d", { willReadFrequently: true });
    if (!hitCtx) return true; // 컨텍스트 불가 → rect 판정으로 폴백(보수적)
  }
  const ctx = hitCtx;
  const [x0, y0, x1, y1] = rect;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, 1, 1);
  ctx.translate(-px, -py); // 클릭 지점 → 오프스크린 원점
  const rot = ((e.rotationDeg ?? 0) * Math.PI) / 180;
  if (rot) {
    const [ax, ay] = entityPivot(rect); // draw 와 동일 pivot(바닥-중앙) — 어긋나면 클릭이 그림과 따로 논다
    ctx.translate(ax, ay);
    ctx.rotate(rot);
    ctx.translate(-ax, -ay);
  }
  if (e.flipX) {
    ctx.translate(x0 + x1, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
  const alpha = ctx.getImageData(0, 0, 1, 1).data[3];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return alpha >= ALPHA_MIN;
}

/**
 * 화면 점(px,py)에 닿는 엔티티들 — 앞(최상단)→뒤 순서. 겹침 선택 순환에 쓴다.
 * 이미지 엔티티는 알파 히트(투명 여백 제외), 마커는 셀 다이아 bbox 기준.
 */
function entityHitCandidates(
  px: number,
  py: number,
  entities: MapEntity[],
  palette: PaletteTile[],
  cam: Camera,
): MapEntity[] {
  const hw = (TW / 2) * cam.zoom;
  const hh = (TH / 2) * cam.zoom;
  const lookup = makeEntityImageLookup(palette);
  const sorted = sortEntitiesForDraw(entities); // 히트테스트도 그리기 순서와 일치(최상단 우선 선택)
  const out: MapEntity[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    const [cx, cy] = cellToScreen(e.gx, e.gy, cam);
    const img = lookup(e);
    const rect = entityRect(e, cx, cy, hw, hh, img);
    const [x0, y0, x1, y1] = rect;
    // rect 1차 컷(싸다). 회전 스프라이트는 rect 밖으로 삐져나오므로 이 컷을 건너뛴다.
    if (!e.rotationDeg && (px < x0 || px > x1 || py < y0 || py > y1)) continue;
    if (img) {
      if (!spriteAlphaHit(e, img, px, py, rect)) continue; // 투명 여백 통과
    } else if (px < x0 || px > x1 || py < y0 || py > y1) continue;
    out.push(e);
  }
  return out;
}

function draw(
  ctx: CanvasRenderingContext2D,
  dims: Dims,
  size: [number, number],
  cam: Camera,
  hover: [number, number] | null,
  ground: Map<string, number>,
  blocked: Set<CellKey>,
  palette: PaletteTile[],
  rectPreview: [number, number, number, number] | null,
  entities: MapEntity[],
  selectedEntityId: string | null,
  visual: VisualFlags,
  stand: StandCtx, // 설 수 없는 칸(남쪽 침범 판정 재료) — 컴포넌트가 버전 memo selector 로 넘긴다(프레임마다 재계산 금지)
  preview: PreviewFrame | null,
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

  const drawOverlays = !preview || preview.showOverlays;
  // 일반 편집기는 빈 셀 배경, 연결 미리보기는 실제 Sprite 위 격자만 그린다.
  const drawGrid = (fill: boolean) => {
    ctx.lineWidth = 1;
    ctx.strokeStyle = fill ? "#2c2f3a" : "rgba(205,220,240,0.36)";
    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        const [cx, cy] = cellToScreen(gx, gy, cam);
        if (!vis(cx, cy)) continue;
        diamondPath(ctx, cx, cy, hw, hh);
        if (fill) {
          ctx.fillStyle = "#1d1f26";
          ctx.fill();
        }
        ctx.stroke();
      }
    }
  };
  if (!preview && visual.grid) drawGrid(true);

  // 연결 미리보기는 실제 후보 스프라이트를 그린다. 논리셀은 별도 1×1 이미지로 중복 렌더하지 않는다.
  if (preview?.scene) drawGamePreview(ctx, preview.scene, preview.images, cam, dims);
  if (preview?.showOverlays && visual.grid) drawGrid(false);
  if (!preview) {
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

  }

  // 이동불가 셀 오버레이는 엔티티(오브젝트) 위에 그린다 — 오브젝트 깔린 타일에 이동불가를 칠해도
  // 오브젝트에 가려지지 않고 보이도록(에디터 작업 UX). ↓ 엔티티 루프 다음에서 그림.

  // 엔티티(포탈/몬스터/NPC/오브젝트) — 타일 위에. gy→gx 순(뒤→앞).
  // 선택 오브젝트의 바닥선은 다른 스프라이트에 가리지 않게 루프가 끝난 뒤 그린다(클로저로 미룸).
  let deferredOverlay: (() => void) | null = null;
  const displayedEntities = preview ? (drawOverlays ? entities.filter(entity => entity.kind !== "object") : []) : entities;
  if (displayedEntities.length > 0) {
    // 런타임 스폰 엔티티는 정적 게임 배치가 아니다. 연결 모드에서는 편집 마커로만 보여준다.
    const lookup = makeEntityImageLookup(preview ? [] : palette);
    const sorted = sortEntitiesForDraw(displayedEntities);
    for (const e of sorted) {
      if (e.gx < 0 || e.gy < 0 || e.gx >= W || e.gy >= H) continue;
      const [cx, cy] = cellToScreen(e.gx, e.gy, cam);
      const meta = ENTITY_META[e.kind];
      const img = lookup(e);
      // 컬링 — 이미지 엔티티는 실제 그려질 rect 가 캔버스와 교차하는지로(앵커만 보면 큰
      // 스프라이트가 통째로 사라짐 — eng-review D6). 마커는 셀 중심 기준.
      if (img) {
        const [rx0, ry0, rx1, ry1] = entityRect(e, cx, cy, hw, hh, img);
        if (rx1 < 0 || rx0 > dims.w || ry1 < 0 || ry0 > dims.h) continue;
      } else if (!vis(cx, cy)) continue;
      const sel = e.id === selectedEntityId;

      let labelTop = cy - hh;
      if (img) {
        // 충돌(이동불가) 오브젝트는 footprint 를 빨강(수동 이동불가와 동일)으로 표시 — 에디터 작업용 UX.
        const blocking = e.kind === "object" && e.blocks === true;

        // 이 엔티티의 점유 셀 — 채움(1)과 외곽선(3)이 공유. ⚠ 이름을 footCells 로 고정한다.
        //   바깥에 바닥 셀 배열 `cells`(3600개)가 있어, 변수명을 cells 로 두면 외곽선 루프가
        //   스코프를 벗어나 바닥 전체를 그리는 치명 버그가 난다(엔티티마다 3600 stroke).
        //   점유 토글 꺼져 있으면 계산도 안 한다(draw 는 마우스 이동마다·엔티티마다 호출).
        // 표시용 점유 = 앵커(gx,gy) 고정(offset 무시) — X/Y 이동(offset)은 이미지만 넛지하고
        //   지면 점유 다이아몬드는 안 따라간다. export/게임 footprint 는 entityFootprintCells(offset-정렬).
        const footCells = visual.footprint
          ? entityDisplayFootprintCells(e).filter(([gx, gy]) => gx >= 0 && gy >= 0 && gx < W && gy < H)
          : null;

        // 1) footprint 채움 — 스프라이트 아래. blocking=빨강, 아니면 종류색.
        if (footCells) {
          ctx.fillStyle = blocking ? (sel ? "rgba(220,70,70,0.42)" : "rgba(220,70,70,0.30)") : meta.color + (sel ? "33" : "1f");
          for (const [gx, gy] of footCells) {
            const [fx, fy] = cellToScreen(gx, gy, cam);
            diamondPath(ctx, fx, fy, hw, hh);
            ctx.fill();
          }
        }

        // 2) 비율 유지 빌보드 — 바닥-중앙 앵커(object = MSW 에셋 pivot, 몬스터/NPC = footprint 전면).
        const rect = entityRect(e, cx, cy, hw, hh, img);
        const [x0, y0, x1, y1] = rect;
        const rot = ((e.rotationDeg ?? 0) * Math.PI) / 180; // 기울기(라디안)
        ctx.save();
        if (rot) {
          // 회전 pivot — 게임(MSW ZRotation)은 에셋 pivot 을 중심으로 돈다. 오브젝트 pivot 이
          //   bottom-center 이므로 에디터도 바닥-중앙에서 회전해야 동형.
          const [ax, ay] = entityPivot(rect);
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

        // 3) footprint 외곽선 — 스프라이트 위에(점유 타일이 항상 보이도록). 점유 셀만(위 footCells).
        if (footCells) {
          ctx.strokeStyle = blocking ? "#e05050" : meta.color;
          ctx.globalAlpha = sel ? 0.95 : 0.55;
          ctx.lineWidth = sel ? 1.6 : 1.2;
          for (const [gx, gy] of footCells) {
            const [fx, fy] = cellToScreen(gx, gy, cam);
            diamondPath(ctx, fx, fy, hw, hh);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }

        // 3b) 플레이어 레이어 표식 — auto(기본, 동적 앞뒤)는 표식 없음. 명시 레이어만 배지로 식별(D4):
        //   above=항상 플레이어 위(▲파랑), below=항상 아래(▼주황). 에디터엔 플레이어가 없어 배지로만 구분.
        if (e.kind === "object" && (e.layer === "above" || e.layer === "below")) {
          ctx.fillStyle = e.layer === "above" ? "#4aa3ff" : "#e0a24a";
          ctx.font = `bold ${Math.max(10, Math.round(hh * 1.1))}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(e.layer === "above" ? "▲위" : "▼아래", (x0 + x1) / 2, labelTop - 1);
        }

        // 4) 선택 시 — 흰 선택 박스(이미지 rect)만. 리사이즈 핸들 제거(크기 조절은 인스펙터 W×H/배율로).
        //    선택된 오브젝트 드래그 = 좌표 이동만.
        if (sel) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
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

      // 남쪽 침범 판정(요청서 R1) — 1×1 auto 오브젝트의 바닥선이 앞 칸 중심에 붙거나 넘었는가.
      const south = e.kind === "object" ? judgeSouth(e, stand) : null;
      // 선택된 오브젝트의 "게임이 앞뒤를 정하는 선" — 루프 뒤에 그린다(다른 스프라이트에 가리지 않게).
      //   1×1(auto)은 정렬 바닥선(1×1 요청서 R2) · 멀티셀(auto)은 정렬 게이트 경계(sortPadX 요청서 R3) · above/below 는 없음(고정 평면).
      //   ⚠ 두 선은 뜻이 다르다 — 1×1 은 바닥 y 가 곧 순서지만 멀티셀은 런타임이 게이트 안 캐릭터를 보정하므로 바닥선이 틀린 정보다.
      if (sel && isSouthCandidate(e)) {
        const level = south ? south.level : "ok";
        deferredOverlay = () => drawSortBaseline(ctx, e, cx, cy, hw, hh, cam, stand, level);
      } else if (sel && isSortGateTarget(e)) {
        const nw = img?.naturalWidth ?? 0;
        deferredOverlay = () => drawSortGate(ctx, e, cx, cy, cam.zoom, nw);
      }
      // 남쪽 침범 배지 — 미완성 배지와 같은 높이, 왼쪽(둘이 같이 뜰 수 있다). 항상 표시(오버레이 토글과 무관).
      if (south) {
        const bx = cx - hw * 0.6;
        const by = labelTop + 2;
        ctx.beginPath();
        ctx.arc(bx, by, 6, 0, Math.PI * 2);
        ctx.fillStyle = SOUTH_COLOR[south.level];
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#0e0f12";
        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("▼", bx, by + 0.5);
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
  if (deferredOverlay) deferredOverlay();

  // 이동불가 셀 — 빨강 다이아몬드 오버레이. 엔티티 위에 그려 오브젝트 깔린 타일도 보이게(이동불가 표시 토글).
  if (drawOverlays && visual.blocked && blocked.size > 0) {
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
  if (drawOverlays && rectPreview) {
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
  if (drawOverlays && hover) {
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
  useGamePreview();
  const workspaceLoading = useWorkspaceSession(state => state.loading);
  const gameSync = useEditorStore(state => state.gameSync);
  const previewScene = useGamePreviewStore(state => state.scene);
  const previewImages = useGamePreviewStore(state => state.images);
  const previewBaselineId = useGamePreviewStore(state => state.baselineId);
  const showScene = useGamePreviewStore(state => state.showScene);
  const showOverlays = useGamePreviewStore(state => state.showOverlays);
  const selectedGameObjectId = useEditorStore(state => state.selectedGameObjectId);
  const selectedGameObjectIds = useEditorStore(state => state.selectedGameObjectIds);
  const selectedBlockedCells = useEditorStore(state => state.selectedBlockedCells);
  const selectionMode = useGamePreviewStore(state => state.selectionMode);
  const [objectDraft, setObjectDraft] = useState<{ ids: string[]; cells: CellKey[]; delta: [number, number] } | null>(null);
  const nativeDrag = useRef<{
    ids: string[]; cells: CellKey[]; pointer: GameObjectPosition; baselineId: string;
    version: number; blockedVersion: number;
  } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x0: number; y0: number; x1: number; y1: number; kind: "objects" | "blocked" } | null>(null);
  const selectionStart = useRef<{ x: number; y: number; kind: "objects" | "blocked"; baselineId: string; version: number; blockedVersion: number } | null>(null);
  const nativeHits = useRef<GameObjectDescriptor[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<Dims>({ w: 800, h: 600 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const mode = useRef<"pan" | "paint" | "blockErase" | "rect" | "moveEntity" | "moveGameObject" | "selectGameRegion" | null>(null);
  const strokeBefore = useRef<Snapshot | null>(null);
  const rectStart = useRef<[number, number] | null>(null);
  const movingId = useRef<string | null>(null);
  const activeGroundBaseline = useRef<string | null>(null);
  // 겹침 선택 순환 — mousedown 시점의 후보(앞→뒤) + 눌린 지점. 드래그 없이 뗀 클릭에서만 순환한다
  //   (드래그=이동 규칙과 충돌 안 하도록). Illustrator/Figma 의 "제자리 재클릭 = 아래 것" 동작.
  const downPoint = useRef<{ x: number; y: number } | null>(null);
  const hitCands = useRef<MapEntity[]>([]);
  const spaceDown = useRef(false);
  const didInit = useRef(false);
  const fittedPreviewBaseline = useRef<string | null>(null);

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
  const stand = useEditorStore(selectStandCtx); // 엔티티·이동불가 버전이 바뀔 때만 새 객체
  const setCamera = useEditorStore((s) => s.setCamera);

  useEffect(() => useWorkspaceSession.subscribe((state, previous) => {
    if (!state.loading || previous.loading) return;
    mode.current = null; drag.current = null; strokeBefore.current = null;
    rectStart.current = null; movingId.current = null; activeGroundBaseline.current = null;
    nativeDrag.current = null; setObjectDraft(null); selectionStart.current = null; setSelectionBox(null);
    useGamePreviewStore.getState().setSelectionMode("objects");
  }), []);

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
    const linked = useEditorStore.getState().gameSync;
    const preview = useGamePreviewStore.getState();
    setCamera(linked && preview.scene?.baselineId === linked.baselineId
      ? fitPreviewCamera(dims, size, preview.scene, preview.images)
      : fitCamera(dims, size));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, fitNonce]);

  // 첫 scene을 받은 뒤 상단 상태/경고 영역으로 인한 resize가 안정될 때 한 번 맞춘다.
  // 이후 편집 응답이나 창 resize는 사용자가 정한 카메라를 움직이지 않는다.
  useEffect(() => {
    const baselineId = gameSync?.baselineId;
    if (!baselineId) { fittedPreviewBaseline.current = null; return; }
    if (workspaceLoading || previewScene?.baselineId !== baselineId ||
      previewBaselineId !== baselineId || fittedPreviewBaseline.current === baselineId) return;
    const timer = window.setTimeout(() => {
      if (fittedPreviewBaseline.current === baselineId) return;
      fittedPreviewBaseline.current = baselineId;
      setCamera(fitPreviewCamera(dims, size, previewScene, previewImages));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [gameSync, workspaceLoading, previewScene, previewImages, previewBaselineId, dims, size, setCamera]);

  // Selection, project and document changes invalidate a pointer gesture immediately.
  useEffect(() => useEditorStore.subscribe((state, previous) => {
    if (state.gameSync === previous.gameSync && state.gameObjectsVer === previous.gameObjectsVer &&
      state.blockedVer === previous.blockedVer && state.activeTool === previous.activeTool &&
      state.selectedGameObjectIds === previous.selectedGameObjectIds && state.selectedBlockedCells === previous.selectedBlockedCells) return;
    nativeDrag.current = null; nativeHits.current = []; setObjectDraft(null);
    selectionStart.current = null; setSelectionBox(null);
    if (mode.current === "moveGameObject" || mode.current === "selectGameRegion") mode.current = null;
  }), []);

  useEffect(() => {
    const cancel = () => {
      nativeDrag.current = null; nativeHits.current = []; setObjectDraft(null);
      selectionStart.current = null; setSelectionBox(null);
      if (mode.current === "moveGameObject" || mode.current === "selectGameRegion") mode.current = null;
    };
    const unsubscribe = useGamePreviewStore.subscribe((state, previous) => {
      if (state.selectionMode !== previous.selectionMode || state.showScene !== previous.showScene ||
        state.placementPrototypeId !== previous.placementPrototypeId || state.status === "error") cancel();
    });
    window.addEventListener("blur", cancel);
    return () => { unsubscribe(); window.removeEventListener("blur", cancel); };
  }, []);

  // 키보드: Space(팬) + undo/redo
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (useWorkspaceSession.getState().loading) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.code === "Space") {
        spaceDown.current = true;
        return;
      }
      // 단축키는 e.code(물리 키)로 판정 — 한글 IME/레이아웃에서 e.key 가 자모로 바뀌어도 동작.
      const mod = e.metaKey || e.ctrlKey;
      const current = useEditorStore.getState();
      // Commands cancel a local drag before mouseup can commit a stale object.
      if (current.gameSync && (nativeDrag.current || selectionStart.current)) {
        nativeDrag.current = null; nativeHits.current = []; setObjectDraft(null); mode.current = null;
        selectionStart.current = null; setSelectionBox(null);
      }
      if (current.gameSync && e.key === "Escape") {
        useGamePreviewStore.getState().setSelectionMode("objects");
        current.setTool("cursor"); current.clearGameSelection(); nativeDrag.current = null; setObjectDraft(null);
        return;
      }
      if (current.gameSync &&
        ((mod && e.code === "KeyD") || ["Delete", "Backspace", "ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key))) {
        e.preventDefault();
        const preview = useGamePreviewStore.getState(), scene = preview.scene;
        if (preview.status !== "ready" || scene?.baselineId !== current.gameSync.baselineId ||
          (!current.selectedGameObjectIds.length && !current.selectedBlockedCells.length)) return;
        if (mod && e.code === "KeyD") current.transformGameSelection("duplicate", scene, [1, 0]);
        else if (e.key === "Delete" || e.key === "Backspace") current.transformGameSelection("delete", scene);
        else if (!mod && ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)) {
          const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          const dy = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
          current.transformGameSelection("move", scene, [dx, dy]);
        }
        return;
      }
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
      } else if (!mod && (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        // 선택 엔티티를 iso 방향으로 한 셀 이동. 오른쪽=SE(gx+1) / 위=NE(gy−1) / 왼쪽=NW(gx−1) / 아래=SW(gy+1).
        //   ⚠ 방향키는 e.key 로 판정 — e.code 는 일부 환경/합성이벤트서 빈 문자열. e.key 는 레이아웃 무관 안정.
        const st = useEditorStore.getState();
        const ent = st.selectedEntityId ? st.entities.find((x) => x.id === st.selectedEntityId) : null;
        if (ent) {
          e.preventDefault();
          const gx = ent.gx + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0);
          const gy = ent.gy + (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0);
          st.moveEntityTo(ent.id, gx, gy);
        }
      } else if (!mod) {
        const t = CODE_TO_TOOL[e.code];
        if (t && (!useEditorStore.getState().gameSync || GROUND_TOOLS.has(t))) {
          const view = useGamePreviewStore.getState();
          if (current.gameSync) {
            view.setSelectionMode("objects");
            if (t === "object") { view.setShowObjects(true); view.setShowScene(true); current.setTool("cursor"); return; }
          }
          current.setTool(t);
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
      if (useWorkspaceSession.getState().loading) return;
      const p = local(e);
      nativeDrag.current = null; setObjectDraft(null); selectionStart.current = null; setSelectionBox(null);
      if (mode.current === "moveGameObject" || mode.current === "selectGameRegion") mode.current = null;
      fittedPreviewBaseline.current = useEditorStore.getState().gameSync?.baselineId ?? null;
      useEditorStore.getState().zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, p.x, p.y);
    };
    const onDown = (e: MouseEvent) => {
      if (useWorkspaceSession.getState().loading) return;
      const p = local(e);
      const st = useEditorStore.getState();
      fittedPreviewBaseline.current = st.gameSync?.baselineId ?? null;
      const [gx, gy] = screenToCell(p.x, p.y, st.camera);
      if (e.button === 1 || spaceDown.current) {
        mode.current = "pan";
        drag.current = p;
        return;
      }
      if (e.button === 2) {
        // 우클릭: 이동불가 도구일 때만 지우기 스트로크(드래그 지속).
        if (st.activeTool === "block") {
          activeGroundBaseline.current = st.gameSync?.baselineId ?? null;
          mode.current = "blockErase";
          strokeBefore.current = strokeSnap(st);
          st.setBlockedAt(gx, gy, false);
        }
        return;
      }
      if (e.button !== 0) return;
      const tool = st.activeTool;
      if (st.gameSync && !GROUND_TOOLS.has(tool)) return;
      const paintsGround = tool === "brush" || tool === "eraser" || tool === "rect";
      if (st.gameSync && paintsGround && !linkedGroundReady(st.gameSync.baselineId)) return;
      activeGroundBaseline.current = paintsGround || tool === "block" ? st.gameSync?.baselineId ?? null : null;
      if (st.gameSync && tool === "block") {
        const view = useGamePreviewStore.getState(); view.setShowOverlays(true);
        if (!st.visual.blocked) st.toggleVisual("blocked");
      }
      if (st.gameSync && (tool === "cursor" || tool === "object")) {
        const preview = useGamePreviewStore.getState(), scene = preview.scene;
        if (preview.status !== "ready" || !preview.showScene || scene?.baselineId !== st.gameSync.baselineId) return;
        if (tool === "object") {
          const prototype = scene.objectPrototypes?.find(item => item.prototypeId === preview.placementPrototypeId);
          if (prototype?.canDuplicate) {
            st.addGameObject(prototype.prototypeId, snapObjectPosition(
              previewScreenToWorld(p.x, p.y, scene, st.camera), prototype.sourcePosition, scene));
            preview.setPlacementPrototype(null);
          }
          else { preview.setShowObjects(true); st.setTool("cursor"); }
          return;
        }
        downPoint.current = p;
        const startRegion = (kind: "objects" | "blocked") => {
          selectionStart.current = { ...p, kind, baselineId: st.gameSync!.baselineId, version: st.gameObjectsVer, blockedVersion: st.blockedVer };
          setSelectionBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, kind }); mode.current = "selectGameRegion";
        };
        if (preview.selectionMode === "blocked") {
          if (scene.report?.walkEditingSupported === true) startRegion("blocked");
          return;
        }
        const candidates = gameObjectHitCandidates(p.x, p.y, scene, preview.images, st.camera);
        nativeHits.current = candidates;
        const hit = candidates[0];
        const selected = candidates.find(item => st.selectedGameObjectIds.includes(item.entityId));
        const modifier = e.ctrlKey || e.metaKey || e.shiftKey;
        if ((modifier || preview.multiSelect) && hit && (modifier || !selected)) {
          st.selectGameObjects([hit.entityId], "toggle"); return;
        }
        const selectedCell = st.selectedBlockedCells.includes(cellKey(gx, gy));
        if (selected || selectedCell) {
          nativeDrag.current = { ids: st.selectedGameObjectIds, cells: st.selectedBlockedCells,
            pointer: previewScreenToWorld(p.x, p.y, scene, st.camera), baselineId: st.gameSync.baselineId,
            version: st.gameObjectsVer, blockedVersion: st.blockedVer };
          mode.current = "moveGameObject";
        } else if (hit) {
          st.selectGameObjects([hit.entityId]);
        } else if (modifier || preview.multiSelect) {
          startRegion("objects");
        } else {
          st.clearGameSelection(); mode.current = "pan"; drag.current = p;
        }
        return;
      }
      if (tool === "cursor") {
        // 엔티티 클릭 규칙:
        //  - 미선택 엔티티 클릭 → "선택만"(이동 안 함). 선택하려다 딸려 움직이던 문제 방지.
        //  - 이미 선택된 엔티티를 다시 눌러 드래그 → 좌표 이동(리사이즈 없음).
        //  - 이미 선택된 엔티티를 제자리 클릭(드래그 X) → onUp 에서 아래 것으로 순환(겹침 선택).
        //  - 빈 곳 → 선택 해제 + 맵 팬.
        const cands = entityHitCandidates(p.x, p.y, st.entities, st.palette, st.camera);
        downPoint.current = p;
        hitCands.current = cands;
        const hit = cands[0] ?? null;
        if (hit) {
          if (cands.some((c) => c.id === st.selectedEntityId)) {
            // 스택 안에 이미 선택된 게 있음 → 그걸 드래그(이동). 안 움직이면 onUp 이 순환.
            movingId.current = st.selectedEntityId;
            mode.current = "moveEntity";
            strokeBefore.current = strokeSnap(st);
          } else {
            st.selectEntity(hit.id); // 선택만 — 드래그해도 이동 안 됨
          }
        } else {
          st.selectEntity(null);
          mode.current = "pan";
          drag.current = p;
        }
        return;
      }
      if (tool === "portal" || tool === "monster" || tool === "npc" || tool === "object") {
        const tile = st.palette[st.activeIdx];
        if (tool !== "portal" && !tile) {
          alert("먼저 팔레트에서 배치할 스프라이트를 선택하세요 (스토리지에서 불러오기).");
          return;
        }
        // 오브젝트 크기는 배치 시점의 이미지 네이티브 픽셀로 고정된다 → 이미지가 없으면 크기를 알 수 없고,
        //   추측값(1타일)이 영구 고정되어 게임까지 잘못된 크기로 나간다. 배치를 막고 이유를 알린다.
        if (tool === "object" && !((tile?.img?.naturalWidth ?? 0) > 0)) {
          alert(
            `"${tile?.name ?? "선택한 타일"}" 은 이미지가 없어 크기를 알 수 없습니다 (RUID 매핑만 불러온 타일).\n` +
              "스토리지/PNG 로 이미지를 포함해 팔레트에 추가한 뒤 배치하세요.",
          );
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
        strokeBefore.current = strokeSnap(st);
        st.applyTool(gx, gy);
      }
    };
    const onMove = (e: MouseEvent) => {
      if (useWorkspaceSession.getState().loading) return;
      const p = local(e);
      const st = useEditorStore.getState();
      const [gx, gy] = screenToCell(p.x, p.y, st.camera);
      if (st.gameSync && (mode.current === "paint" || mode.current === "rect") &&
        (activeGroundBaseline.current !== st.gameSync.baselineId || useGamePreviewStore.getState().status === "error")) return;
      if (mode.current === "selectGameRegion" && selectionStart.current) {
        const start = selectionStart.current;
        if (st.gameSync?.baselineId !== start.baselineId || st.gameObjectsVer !== start.version || st.blockedVer !== start.blockedVersion) return;
        setSelectionBox({ x0: start.x, y0: start.y, x1: p.x, y1: p.y, kind: start.kind });
      } else if (mode.current === "moveGameObject" && nativeDrag.current) {
        const move = nativeDrag.current, scene = useGamePreviewStore.getState().scene;
        const start = downPoint.current;
        if (scene?.baselineId !== move.baselineId || st.gameSync?.baselineId !== move.baselineId ||
          st.gameObjectsVer !== move.version || st.blockedVer !== move.blockedVersion ||
          st.selectedGameObjectIds !== move.ids || st.selectedBlockedCells !== move.cells ||
          move.ids.some(id => !scene.objects?.find(item => item.entityId === id)?.canMove)) return;
        if (start && Math.abs(p.x - start.x) <= CLICK_SLOP && Math.abs(p.y - start.y) <= CLICK_SLOP) return;
        const pointer = previewScreenToWorld(p.x, p.y, scene, st.camera);
        setObjectDraft({ ids: move.ids, cells: move.cells, delta: objectCellOffset(pointer, move.pointer, scene) });
      } else if (mode.current === "pan" && drag.current) {
        st.panBy(p.x - drag.current.x, p.y - drag.current.y);
        drag.current = p;
      } else if (mode.current === "paint") {
        if (!st.gameSync || GROUND_TOOLS.has(st.activeTool)) st.applyTool(gx, gy);
      } else if (mode.current === "blockErase") {
        st.setBlockedAt(gx, gy, false);
      } else if (mode.current === "rect" && rectStart.current) {
        st.setRectPreview([rectStart.current[0], rectStart.current[1], gx, gy]);
      } else if (mode.current === "moveEntity" && movingId.current && !st.gameSync) {
        st.moveEntityTo(movingId.current, gx, gy);
      }
      st.setHover([gx, gy]);
    };
    const onUp = (e: MouseEvent) => {
      const st = useEditorStore.getState();
      if (useWorkspaceSession.getState().loading ||
        (st.gameSync && (mode.current === "paint" || mode.current === "rect") && activeGroundBaseline.current !== st.gameSync.baselineId)) {
        mode.current = null; drag.current = null; strokeBefore.current = null;
        rectStart.current = null; movingId.current = null; activeGroundBaseline.current = null;
        nativeDrag.current = null; setObjectDraft(null); selectionStart.current = null; setSelectionBox(null);
        return;
      }
      if (mode.current === "selectGameRegion" && selectionStart.current) {
        const start = selectionStart.current, p = local(e), preview = useGamePreviewStore.getState();
        const still = Math.abs(p.x - start.x) <= CLICK_SLOP && Math.abs(p.y - start.y) <= CLICK_SLOP;
        if (st.gameSync?.baselineId === start.baselineId && st.gameObjectsVer === start.version &&
          st.blockedVer === start.blockedVersion && preview.status === "ready" && preview.scene?.baselineId === start.baselineId) {
          if (start.kind === "blocked") {
            const [x0, y0] = screenToCell(start.x, start.y, st.camera), [x1, y1] = screenToCell(p.x, p.y, st.camera);
            const cells = still ? [cellKey(x0, y0)] : [...st.blocked].filter(key => {
              const [x, y] = parseCellKey(key);
              return x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(y0, y1) && y <= Math.max(y0, y1);
            });
            st.selectBlockedCells(cells, still ? "toggle" : "add");
          } else if (!still) {
            st.selectGameObjects(gameObjectsInScreenRect({ x0: start.x, y0: start.y, x1: p.x, y1: p.y }, preview.scene, preview.images, st.camera), "add");
          }
        }
        selectionStart.current = null; setSelectionBox(null);
      } else if (mode.current === "moveGameObject" && nativeDrag.current) {
        const move = nativeDrag.current, preview = useGamePreviewStore.getState(), scene = preview.scene;
        const start = downPoint.current, p = local(e);
        const still = start && Math.abs(p.x - start.x) <= CLICK_SLOP && Math.abs(p.y - start.y) <= CLICK_SLOP;
        if (scene?.baselineId === move.baselineId && st.gameSync?.baselineId === move.baselineId &&
          st.gameObjectsVer === move.version && st.blockedVer === move.blockedVersion &&
          st.selectedGameObjectIds === move.ids && st.selectedBlockedCells === move.cells && preview.status === "ready") {
          if (still && !preview.multiSelect && move.ids.length === 1 && !move.cells.length && nativeHits.current.length > 1) {
            const index = nativeHits.current.findIndex(item => item.entityId === st.selectedGameObjectId);
            st.selectGameObject(nativeHits.current[(index + 1) % nativeHits.current.length].entityId);
          } else if (!still) {
            st.transformGameSelection("move", scene, objectCellOffset(previewScreenToWorld(p.x, p.y, scene, st.camera), move.pointer, scene));
          }
        }
        nativeDrag.current = null; setObjectDraft(null);
      } else if ((mode.current === "paint" || mode.current === "blockErase") && strokeBefore.current) {
        st.commitStroke(strokeBefore.current);
      } else if (mode.current === "moveEntity" && strokeBefore.current) {
        // 안 움직인 제자리 클릭 = "겹침 순환" 의도 → 스택의 다음(아래) 엔티티를 선택. 움직였으면 이동 커밋.
        const d = downPoint.current;
        const p = local(e);
        const still = d && Math.abs(p.x - d.x) <= CLICK_SLOP && Math.abs(p.y - d.y) <= CLICK_SLOP;
        const cands = hitCands.current;
        if (still && cands.length > 1) {
          const i = cands.findIndex((c) => c.id === st.selectedEntityId);
          st.selectEntity(cands[(i + 1) % cands.length].id);
        }
        st.commitStroke(strokeBefore.current); // 이동 없으면 스토어가 no-op 로 흡수
      } else if (mode.current === "rect") {
        const rp = st.rectPreview;
        if (rp && (!st.gameSync || useGamePreviewStore.getState().status !== "error")) st.fillRect(rp[0], rp[1], rp[2], rp[3]);
        st.setRectPreview(null);
      }
      mode.current = null;
      drag.current = null;
      strokeBefore.current = null;
      rectStart.current = null;
      movingId.current = null;
      activeGroundBaseline.current = null;
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
    const shownScene = previewScene && objectDraft ? sceneWithGameObjectGroupDraft(previewScene, objectDraft.ids, objectDraft.delta) : previewScene;
    const preview = gameSync && showScene ? {
      scene: previewBaselineId === gameSync.baselineId ? shownScene : null,
      images: previewImages, showOverlays,
    } : null;
    let shownBlocked = blocked;
    if (objectDraft?.cells.length) {
      shownBlocked = new Set(blocked);
      for (const key of objectDraft.cells) shownBlocked.delete(key);
      for (const key of objectDraft.cells) { const [x, y] = parseCellKey(key); shownBlocked.add(cellKey(x + objectDraft.delta[0], y + objectDraft.delta[1])); }
    }
    draw(ctx, dims, size, camera, hover, ground, shownBlocked, palette, rectPreview, entities, selectedEntityId, visual, stand, preview);
    if (preview?.scene) {
      for (const id of selectedGameObjectIds) drawGameObjectSelection(ctx, id, preview.scene, previewImages, camera, id === selectedGameObjectId ? "#ffd166" : "#75dce8");
      const highlight = new Set(selectedBlockedCells.map(key => {
        const [x, y] = parseCellKey(key);
        return objectDraft ? cellKey(x + objectDraft.delta[0], y + objectDraft.delta[1]) : key;
      }));
      if (selectionBox?.kind === "blocked") {
        const [x0, y0] = screenToCell(selectionBox.x0, selectionBox.y0, camera);
        const [x1, y1] = screenToCell(selectionBox.x1, selectionBox.y1, camera);
        for (const key of blocked) {
          const [x, y] = parseCellKey(key);
          if (x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(y0, y1) && y <= Math.max(y0, y1)) highlight.add(key);
        }
      }
      ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = "#75dce8"; ctx.fillStyle = "rgba(79,220,235,.32)";
      for (const key of highlight) {
        const [x, y] = parseCellKey(key), [cx, cy] = cellToScreen(x, y, camera);
        diamondPath(ctx, cx, cy, TW * camera.zoom / 2, TH * camera.zoom / 2); ctx.fill(); ctx.stroke();
      }
      if (selectionBox?.kind === "objects") {
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(selectionBox.x0, selectionBox.y0, selectionBox.x1 - selectionBox.x0, selectionBox.y1 - selectionBox.y0);
      }
      ctx.restore();
    }
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
    stand,
    gameSync,
    previewScene,
    previewImages,
    previewBaselineId,
    showScene,
    showOverlays,
    selectedGameObjectId,
    selectedGameObjectIds,
    selectedBlockedCells,
    objectDraft,
    selectionBox,
  ]);

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <canvas ref={canvasRef} style={{ cursor: activeTool === "cursor" && selectionMode !== "blocked" ? "grab" : "crosshair" }} />
      {gameSync ? <GameObjectInspector /> : <EntityInspector />}
    </div>
  );
}
