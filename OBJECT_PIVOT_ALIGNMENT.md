# 오브젝트 배치위치 불일치 — 구조 분석 & pivot 정합 개선

> **한 줄 요약**: 에디터와 MSW의 **셀→world 좌표는 완전히 동일**하다. 어긋난 건 좌표가 아니라
> **스프라이트를 그 좌표의 "어느 지점"에 붙이느냐(pivot/anchor)** — 에디터는 footprint
> 전면-바닥-중앙, MSW는 이미지 중심. **에디터를 MSW 방식(중심 pivot @ 앵커 셀)으로 통일**한다.

---

## 1. 양쪽 맵 구조 상세 (조사 결과)

### 1.1 좌표 파이프라인 — 세 곳 모두 동일 (원인 아님 ✓)

| 위치 | 코드 | 식 |
|---|---|---|
| 게임 런타임 | `IsoProjectLogic.mlua` (캐논) | `sx=(relX−relY)·0.28, sy=−(relX+relY)·0.14` |
| 에디터 | `src/lib/iso.ts` | 동일 (TILE_W 0.56 / TILE_H 0.28 / ORIGIN 15,15) |
| 빌드 | `scripts/build_map.cjs cellToWorldForMap` | 동일 |

에디터 화면 투영(`grid.ts cellToScreen`)도 같은 식의 px 버전(TW 64/TH 32).
**cellToScreen(gx,gy) = 셀 다이아몬드의 중심** (world의 cellToWorld와 같은 지점).

### 1.2 스프라이트가 놓이는 지점 — 여기가 갈림 (근본 원인 🔴)

| | 배치 좌표 | 스프라이트의 어느 점을 거기에? | 크기 기준 |
|---|---|---|---|
| **MSW (.map)** | 앵커 셀 world 좌표 그대로 (`cellToWorldForMap(gx,gy)`) | **에셋 pivot = 이미지 중심** | native px × `Transform.Scale` (중심 기준 축소) |
| **에디터 (기존)** | 앵커 셀 화면 좌표 | **footprint 전면-바닥-중앙**: `bx=cx+((fw−fh)/2)·hw`, `by=cy+(fw+fh−1)·hh` | footprint 가로폭 `(fw+fh)·hw` |

**MSW pivot = 중심의 증거 (실측·데이터)**:
- `.sprite` 에셋 JSON에 pivot/anchor 필드 자체가 없음 → 커스텀 pivot 없음, 엔진 기본값.
- `SpriteRendererComponent.d.mlua`에 pivot 속성 없음 → 런타임 변경 불가.
- **바닥 타일이 결정적**: build_map은 타일 스프라이트를 셀 world좌표에 그대로 놓고, 에디터는
  타일 PNG를 셀 다이아 **중심**에 그린다(`drawImage(img, cx−hw, cy−hh, 2hw, 2hh)`).
  인게임에서 타일이 걷기 격자와 정확히 정렬됨(Maker 실측 완료) → **기본 pivot = 이미지 중심** 확정.

### 1.3 크기(스케일) 공식도 어긋나 있었음 (부차 원인 🟡)

- export: `scale = (renderW×56/nativeW)×배율` → **게임 렌더 폭 = renderW 타일**.
- 에디터(기존): 폭 = `(fw+fh)·hw` = **(fw+fh)/2 타일**. → `fw==fh`일 때만 게임과 일치
  (3×3 집은 우연히 맞고, 2×1 나무는 25% 작게 프리뷰됨).

### 1.4 offset 부호 규약 (검증 완료 ✓ — 원인 아님)

47/47 오브젝트 실측: 에디터 `−좌/+우/−상/+하` = MSW 동일. (Y는 export에서 부호 반전:
에디터 y-down → world y-up. `entityExport.ts PX_TO_WORLD=0.56/64`.)

### 1.5 왜 지금까지의 offset들이 크고 크기 비례였나

에디터가 "footprint 앞바닥에 세워진" 프리뷰를 보여주는 동안, 게임은 "셀 중심에 이미지
중심"으로 그렸다. 사용자는 게임 화면을 보고 offset으로 되끌어올렸고(위로 +), 그 보정량은
스프라이트 높이의 절반 언저리 → **offset ∝ 스프라이트 크기** 패턴과 정확히 일치.

---

## 2. 해결 — 에디터 렌더를 MSW pivot으로 통일 (이 문서의 구현)

> 방향 선택: build_map을 에디터에 맞추는 대신 **에디터를 MSW에 맞춘다**(사용자 결정).
> 게임 배치는 그대로 → 기존 맵의 인게임 결과 불변. 바뀌는 건 에디터 프리뷰뿐이며,
> 이제 프리뷰가 곧 게임(WYSIWYG)이 된다.

### 2.1 오브젝트(kind=object) 렌더 규칙 (신규)

```
중심점 = cellToScreen(gx, gy) + (offsetX, offsetY)·zoom     // 앵커 셀 중심 + 미세조정
폭     = renderW × TW × zoom × 배율(scaleMul)                // 게임 폭(renderW타일×배율)과 동일
높이   = 폭 × nativeH/nativeW                                // 종횡비 = 게임과 동일(중심 기준)
회전   = 중심 기준 (기존: 바닥-중앙 기준)                      // MSW ZRotation = pivot(중심) 기준
flipX  = 중심 기준 가로 미러 (기존과 동일 — 이미 중심 기준)
```

이 규칙이면 에디터 픽셀 = 게임 픽셀 × 64/56 스케일의 **완전 동형** — 위치·크기·회전 모두.

### 2.2 그대로인 것

- **몬스터/NPC 프리뷰**: 기존 billboard 유지(게임은 .map 스프라이트가 아니라 모델 스폰이라 별개).
- **footprint 외곽선/이동불가/점유** = 충돌 셀(tilesW/H) 기준 — 변화 없음.
- **export 값(scale/offset/rotation/layer)** — 공식 불변. 게임 출력 동일.
- 히트테스트·리사이즈 핸들·배지 — entityRect를 공유하므로 자동 추종.

### 2.3 사용자 체감 (기존 맵 열 때)

- 오브젝트 프리뷰가 **이전과 다른 자리(=게임의 진짜 자리)로 이동해 보인다.** 데이터는 안 변함.
- 기존에 게임 보면서 맞춰둔 offset은 그대로 유효(게임 출력 불변). 에디터에서도 이제 같은 자리로 보임.
- 새 오브젝트는 "셀 중심에 이미지 중심"으로 놓임 → 집처럼 바닥에 세울 스프라이트는
  offset(또는 향후 에셋 pivot 통일)으로 앉히면 되고, 그 결과가 에디터·게임 동일하게 보인다.

---

## 3. 남은 개선 (게임/에셋 측 — 별도 세션·선택)

1. **(권장 근본책) 에셋 pivot 통일**: 오브젝트 스프라이트 업로드 시 pivot을 "이미지
   바닥-중앙"으로 굽거나, footprint 기준점으로 표준화 → offset이 거의 0이 됨.
   (현재 MSW 업로드 파이프라인이 pivot 지정을 지원하는지 Maker에서 확인 필요.)
2. **build_map pivot-delta 보정(택1의 대안)**: 에셋 pivot을 못 바꾸면, build_map이
   `pos.y −= nativeH×scale/2 ×0.01` 식의 반높이 보정으로 "바닥 앉힘"을 자동화 가능.
   단, 에디터도 같은 보정을 해야 WYSIWYG 유지 — **둘 다 바꾸면 안 하느니만 못하니
   반드시 계약 문서(WEB_MAP_EDITOR_EXPORT_CONTRACT.md) 갱신과 함께 한쪽 규약으로.**
3. **(에디터, 선택) 렌더 footprint(baseW/baseH) export**: 현재 계약은 tilesW/H(충돌)만
   내보내는데 크기 기준은 renderWH(baseW) → 둘이 다르면 게임 scale 계산 기준이 모호.
   `baseW/baseH`를 export에 추가하면 계약이 완전해짐.

## 4. 검증 체크리스트

- [x] 좌표식 3곳 동일 확인 (iso.ts ↔ build_map ↔ IsoProjectLogic 미러 주석)
- [x] MSW 기본 pivot=중심 확정 (.sprite 무pivot + 타일 정렬 실측)
- [x] 에디터 오브젝트 렌더 전환 (중심@앵커셀, 게임 동형 크기, 중심 회전)
- [ ] 에디터에서 offset=0 오브젝트 배치 → export→build→Maker에서 **같은 자리** 육안 확인
- [ ] 기존 ferendel(나무 10그루) 프리뷰가 인게임 스크린샷과 일치하는지 비교
