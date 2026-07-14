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
import { ENTITY_META, entityFootprintCells, isEntityIncomplete, type MapEntity } from "../types/entity";
import { byGameDepth, entityImageRect, entityPivot } from "../lib/entityGeom";
import { EntityInspector } from "./EntityInspector";

// 스트로크/이동 커밋용 언두 스냅샷(ground+blocked+entities). commitStroke 가 소비.
//   입력은 store 상태(Snapshot 과 구조 동일) — ground/blocked 만 얕은 복사.
const strokeSnap = (st: Snapshot): Snapshot => ({
  ground: new Map(st.ground),
  blocked: new Set(st.blocked),
  entities: st.entities,
});

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
  const sorted = [...entities].sort(byGameDepth);
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
    const sorted = [...entities].sort(byGameDepth);
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

        // 1) footprint 채움 — 스프라이트 아래. 점유 표시 토글. blocking=빨강, 아니면 종류색.
        //    ⚠ 셀 계산을 토글 안으로 — draw 는 마우스 이동마다 돌고(hover 갱신) 엔티티마다 호출된다.
        //      오버레이가 꺼져 있으면 셀 배열을 만들 이유가 없다.
        if (visual.footprint) {
          const cells = entityFootprintCells(e).filter(([gx, gy]) => gx < W && gy < H);
          ctx.fillStyle = blocking ? (sel ? "rgba(220,70,70,0.42)" : "rgba(220,70,70,0.30)") : meta.color + (sel ? "33" : "1f");
          for (const [gx, gy] of cells) {
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
  const mode = useRef<"pan" | "paint" | "blockErase" | "rect" | "moveEntity" | null>(null);
  const strokeBefore = useRef<Snapshot | null>(null);
  const rectStart = useRef<[number, number] | null>(null);
  const movingId = useRef<string | null>(null);
  // 겹침 선택 순환 — mousedown 시점의 후보(앞→뒤) + 눌린 지점. 드래그 없이 뗀 클릭에서만 순환한다
  //   (드래그=이동 규칙과 충돌 안 하도록). Illustrator/Figma 의 "제자리 재클릭 = 아래 것" 동작.
  const downPoint = useRef<{ x: number; y: number } | null>(null);
  const hitCands = useRef<MapEntity[]>([]);
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
          strokeBefore.current = strokeSnap(st);
          st.setBlockedAt(gx, gy, false);
        }
        return;
      }
      if (e.button !== 0) return;
      const tool = st.activeTool;
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
      }
      st.setHover([gx, gy]);
    };
    const onUp = (e: MouseEvent) => {
      const st = useEditorStore.getState();
      if ((mode.current === "paint" || mode.current === "blockErase") && strokeBefore.current) {
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
