// 아이소메트릭 편집뷰 좌표 변환 (어둠의전설 2:1 다이아몬드). 셀(gx,gy) ↔ 화면 px.
// 엔진 IsoProjectLogic 규약과 동일: X+1 = 화면 SE(우하), Y+1 = SW(좌하), (0,0)=상단.
// (편집뷰는 화면 px 단위 — 엔진의 world-unit 투영은 lib/iso.ts 미러로 별도 보유)
export const TW = 64; // iso 타일 폭 px (zoom 1)
export const TH = 32; // iso 타일 높이 px (2:1)

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
export interface Dims {
  w: number;
  h: number;
}

/** 셀 중심의 화면 px. */
export function cellToScreen(gx: number, gy: number, cam: Camera): [number, number] {
  const ex = (gx - gy) * (TW / 2);
  const ey = (gx + gy) * (TH / 2);
  return [ex * cam.zoom + cam.x, ey * cam.zoom + cam.y];
}

/** 화면 px → 그 점을 포함하는 다이아몬드 셀(정수). cellToScreen 의 정확한 역(중심 기준 round). */
export function screenToCell(sx: number, sy: number, cam: Camera): [number, number] {
  const px = (sx - cam.x) / cam.zoom;
  const py = (sy - cam.y) / cam.zoom;
  const cgx = px / TW + py / TH;
  const cgy = py / TH - px / TW;
  return [Math.round(cgx), Math.round(cgy)];
}

/** 맵 전체를 화면에 맞추는(fit) 카메라 계산. */
export function fitCamera(dims: Dims, size: [number, number]): Camera {
  const [W, H] = size;
  const hw = TW / 2;
  const hh = TH / 2;
  // 외곽 셀 중심의 화면 px 범위(zoom 1, cam 0)
  const minX = -(H - 1) * hw;
  const maxX = (W - 1) * hw;
  const maxY = (W - 1 + (H - 1)) * hh; // minY = 0 (cell 0,0)
  const mapW = maxX - minX + TW;
  const mapH = maxY + TH;
  const pad = 48;
  const zoom = Math.max(
    0.15,
    Math.min((dims.w - pad) / mapW, (dims.h - pad) / mapH, 1.5),
  );
  const cx = (minX + maxX) / 2;
  const cy = maxY / 2;
  return { zoom, x: dims.w / 2 - cx * zoom, y: dims.h / 2 - cy * zoom };
}
