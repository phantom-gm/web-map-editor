# 오브젝트 배치위치 불일치 — 구조 분석 & pivot 정합 개선

> ## ⚠ 개정 (2026-07-15) — 오브젝트 pivot = **bottom-center**
>
> 이 문서의 본문은 **"MSW 오브젝트 pivot = 이미지 중심"** 을 전제로 쓰였다. 그 근거는
> §1.1 의 각주가 스스로 밝혔듯 **결정적이지 않았다**("바닥-중앙 pivot이어도 구분 불가",
> "에셋별 pivot 이 다를 가능성 배제 못 함").
>
> **게임 측에서 오브젝트 에셋 pivot 을 `bottom-center` 로 확정**했다. 에디터도 이를 따른다.
>
> | | 구(이 문서 본문) | **현행** |
> |---|---|---|
> | 오브젝트 이미지 앵커 | 이미지 **중심** = 앵커 셀 중심 | **이미지 바닥-중앙** = 앵커 셀 중심 (이미지는 위로 뻗음) |
> | 회전(기울기) 기준 | 이미지 중심 | **바닥-중앙** (밑동에서 기우는 모양) |
> | 몬스터/NPC 프리뷰 | 바닥-중앙 | 바닥-중앙 (변화 없음 — 이제 전 kind 가 바닥 앵커로 통일) |
>
> **바뀌지 않는 것**: 셀→world 좌표, export 의 `scale`·`offset`·`rotation` 수식.
> pivot 은 **에셋 속성**이라 배치 좌표나 크기 계산에 개입하지 않는다 — "그 좌표의 어느 점에
> 이미지를 붙이는가"만 바꾼다. 따라서 `build_map.cjs`·`convert_map.cjs` 는 **무변경**이다.
>
> **기존 맵에 미치는 영향**: 예전에 배치한 오브젝트는 에디터에서 이미지 높이의 절반만큼
> **위로 올라가 보인다**. 이는 버그가 아니라 **게임에서 실제로 그렇게 옮겨졌기 때문**이다
> (에셋 pivot 이 바뀌었으므로). 에디터가 이제 게임의 진실을 보여주는 것이며, 위치가
> 마음에 안 들면 `Y 이동(offsetY)` 으로 보정한다.
>
> **전제**: 모든 오브젝트 에셋의 pivot 이 bottom-center 로 통일돼 있어야 WYSIWYG 이 성립한다.
> 중심 pivot 에셋이 섞여 있으면 그 에셋만 에디터와 게임이 어긋난다.
>
> 아래 본문은 **좌표 파이프라인 분석과 개정 이력**으로서 유효하다(pivot 결론만 위와 같이 갱신).

---

> **한 줄 요약**: 에디터와 MSW의 **셀→world 좌표는 완전히 동일**하다. 어긋난 건 좌표가 아니라
> **스프라이트를 그 좌표의 "어느 지점"에 붙이느냐(pivot/anchor)** — 에디터는 footprint
> 전면-바닥-중앙, MSW는 이미지 중심. **에디터를 MSW 방식(중심 pivot @ 앵커 셀)으로 통일**한다.
> *(↑ 이 결론은 위 개정으로 대체됨: MSW 오브젝트 pivot = bottom-center)*

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
- **바닥 타일**: build_map은 타일 스프라이트를 셀 world좌표에 그대로 놓고, 에디터는
  타일 PNG를 셀 다이아 **중심**에 그린다(`drawImage(img, cx−hw, cy−hh, 2hw, 2hh)`).
  인게임에서 타일이 걷기 격자와 정렬됨(Maker 실측) → **기본 pivot = 이미지 중심 유력**.

> ⚠ **검증 한계 (eng-review 크로스모델 지적 — §4 Maker 2건 완료 전까지 "잠정")**:
> 1. 타일 정렬 증거는 **세로 반타일 오차에 눈멀음** — 타일 전부가 균일하게 밀려도 이음새·격자는
>    완벽해 보인다(바닥-중앙 pivot이어도 구분 불가). 플레이어 발 위치 대비 실측만이 판별.
> 2. **그룹 스토리지 에셋의 pivot 메타는 서버측** — 로컬 `.sprite` 검사(위 1번 증거)는 로컬
>    임포트 산출물만 본다. 에셋별로 pivot이 다를 가능성 배제 못 함.
> 3. **에디터 PNG ≠ MSW 임포트 에셋 래스터 가능성** — 업로드 파이프라인이 여백 트림/패딩/축소를
>    하면 scale 공식(native폭 기준)과 "이미지 중심"이 에셋별로 어긋난다. 치수 보존 미확인.

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

> 🚧 **차단 게이트 (eng-review D4)**: 아래 1·2번은 **§4의 Maker 육안 2건이 완료되기 전에는
> 착수 금지.** pivot=중심이 반타일 틀렸거나 에셋별로 다르면, 그 위에 쌓은 재구움/보정이
> 오차를 이중으로 굳힌다.

1. **(권장 근본책) 에셋 pivot 통일**: 오브젝트 스프라이트 업로드 시 pivot을 "이미지
   바닥-중앙"으로 굽거나, footprint 기준점으로 표준화 → offset이 거의 0이 됨.
   (현재 MSW 업로드 파이프라인이 pivot 지정을 지원하는지 Maker에서 확인 필요.)
   ⚠ **이중보정 경고(2번과 동일)**: pivot을 재구우면 **기존 저장 offset 전부(중심 pivot
   기준으로 튜닝됨)와 에디터의 중심-pivot 렌더가 한꺼번에 무효화**된다. 반드시
   (a) 계약 문서에 pivot 규약 명시, (b) project.json/계약에 **pivot 규약 버전 마커**
   (예: `pivotConvention: "center-v1" | "bottom-v2"`)를 도입해 에디터·build_map이
   불일치를 감지하고 중단하게 한 뒤 진행할 것. 마커 없이는 미래 세션이 이 변경 전체를
   조용히 되돌릴 수 있다.
2. **build_map pivot-delta 보정(택1의 대안)**: 에셋 pivot을 못 바꾸면, build_map이
   `pos.y −= nativeH×scale/2 ×0.01` 식의 반높이 보정으로 "바닥 앉힘"을 자동화 가능.
   단, 에디터도 같은 보정을 해야 WYSIWYG 유지 — **둘 다 바꾸면 안 하느니만 못하니
   반드시 계약 문서(WEB_MAP_EDITOR_EXPORT_CONTRACT.md) 갱신과 함께 한쪽 규약으로.**
3. **(에디터, 선택) 렌더 footprint(baseW/baseH) export**: 현재 계약은 tilesW/H(충돌)만
   내보내는데 크기 기준은 renderWH(baseW) → 둘이 다르면 게임 scale 계산 기준이 모호.
   `baseW/baseH`를 export에 추가하면 계약이 완전해짐.
4. **(게임 세션 인계 — eng-review D1) 계약 문서에 pivot 규약 절 추가**:
   `legend_of_light/docs/map/WEB_MAP_EDITOR_EXPORT_CONTRACT.md`에 한 절 —
   "스프라이트 시각 위치 = 앵커 셀 world 좌표에 **이미지 중심**(에셋 기본 pivot).
   에디터 프리뷰도 동일 규약." (게임 repo는 다른 세션이 작업 중 — 그 세션이 갱신.)

## 4. 검증 체크리스트

- [x] 좌표식 3곳 동일 확인 (iso.ts ↔ build_map ↔ IsoProjectLogic 미러 주석)
- [x] MSW 기본 pivot=중심 **유력**(.sprite 무pivot + 타일 정렬 실측 — §1.2 검증 한계 참조)
- [x] 에디터 오브젝트 렌더 전환 (중심@앵커셀, 게임 동형 크기, 중심 회전)
- [ ] **(§3 착수 게이트)** 에디터에서 offset=0 오브젝트 배치 → export→build→Maker에서
      **같은 자리** 육안 확인 — 플레이어 발 위치 대비(반타일 오차 판별)
- [ ] **(§3 착수 게이트)** 기존 ferendel(나무 10그루) 프리뷰가 인게임 스크린샷과 일치하는지 비교

---

# 5. 엔지니어링 리뷰 반영 (plan-eng-review 확정)

## 5.1 확정 결정

| # | 결정 | 처리 |
|---|---|---|
| D1 | 계약 문서에 pivot 규약 절 추가 필요 | §3.4 — 게임 세션 인계 |
| D2 | 리사이즈 핸들을 **점유 footprint 앞(남) 코너**로 이동 — 이미지 rect가 tilesW/H에 반응 안 해 "고장" 오인 | 즉시 구현 |
| D3 | entityRect 오브젝트 수식을 **순수함수로 추출 + 유닛 잠금** | 즉시 구현 |
| D4 | "확정/완전 동형" 주장 완화 + 검증 맹점 3건 명기 + §3 착수 게이트/이중보정 경고/버전 마커 | §1.2·§3 반영됨 |
| D5 | **에디터 z순서를 게임 규칙으로**: below < auto < above 밴드, 밴드 내 object=앞줄(gy+tilesH−1) | 즉시 구현 |
| D6 | **컬링을 entityRect 기준으로** — 앵커만 보고 큰 스프라이트 통째 소실되는 버그 | 즉시 구현 |
| D7 | **export 검증에 "오브젝트 이미지 미해석(scale 계산 불가)" 경고** — 조용한 거대화 차단 | 즉시 구현 |

## 5.2 NOT in scope
- 에셋 pivot 재구움(§3.1) — Maker 게이트 2건 통과 전 착수 금지.
- build_map pivot-delta 보정(§3.2) — §3.1과 택1, 게임 세션 소관.
- 몬스터/NPC 프리뷰의 게임 동형화 — 게임은 모델 스폰이라 별개 체계(billboard 유지).
- baseW/baseH export(§3.3) — 계약 확장이라 게임측 합의 후.

## 5.3 What already exists (재사용)
- 타일 중심 배치 렌더(같은 파일) — 오브젝트 렌더가 같은 규약으로 수렴. **[Layer 1]** MSW 에셋 pivot 빌트인 추종.
- `renderWH`/`cellToScreen`/`entityFootprintCells` — 신규 좌표계 없음.
- 미완성 배지·validate 체계 — D7 경고가 그대로 얹힘.
- vitest 패턴(entityLayer/entitySize) — D3 테스트가 따름.

## 5.4 Failure modes
| 코드패스 | 실패 방식 | 테스트 | 사용자 체감 |
|---|---|---|---|
| entityRect 중심 수식 | 앵커/폭 회귀 시 프리뷰-게임 어긋남 재발 | D3 유닛 | 조용한 어긋남 → **D3로 차단** |
| 에디터 z순서(D5) | 밴드/앞줄 규칙이 게임과 어긋나면 겹침 앞뒤 반대 | D3와 함께 유닛(비교함수) | 프리뷰 오해 |
| 컬링(D6) | rect 교차 판정 실수 시 과컬링/과렌더 | 유닛(경계) | 스크롤 중 깜박임 |
| export 이미지 미해석(D7) | 경고 미발동 시 게임 거대 집 | 유닛(validate) | **크리티컬 — D7로 차단** |
| pivot 가정 자체(§1.2 한계) | 반타일/에셋별 오차 | **Maker 육안 2건(§4)** | 전 오브젝트 미세 어긋남 |

## 5.5 병렬화
단일 파일군(CanvasGrid/validate) 순차 구현이 적절 — 병렬 기회 없음.

## 5.6 Implementation Tasks
- [ ] **T1 (P1, human ~1h / CC ~15min)** — editor — entityRect object 수식 순수함수 추출(`entityGeom.ts`) + 유닛(중심·폭·종횡비·몬스터 billboard 회귀) — D3
- [ ] **T2 (P1, human ~40min / CC ~10min)** — editor — z순서 비교함수를 게임 규칙(밴드+앞줄)으로 + 유닛 — D5
- [ ] **T3 (P2, human ~30min / CC ~8min)** — editor — entityRect 기준 컬링 — D6
- [ ] **T4 (P2, human ~30min / CC ~8min)** — editor — 리사이즈 핸들 → footprint 앞코너 — D2
- [ ] **T5 (P1, human ~30min / CC ~8min)** — editor — validate: 오브젝트 이미지 미해석 경고 + 유닛 — D7
- [ ] **T6 (P1, 게임 세션)** — 계약 문서 pivot 절 — D1
- [ ] **T7 (P0 게이트, Maker)** — offset=0 실측 + ferendel 비교(§4) — pivot 가정 판별

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 3 issues(문서정합·핸들UX·테스트) + 아웃사이드 6갭 → 7 decisions locked |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE VOICE (Claude subagent):** ran — 6 findings + 4 cleared(zoom 복원·offset 환산·flipX 합성·회전 부호 검증됨). 핵심: pivot=중심 "확정" 주장이 반타일 오차·서버측 에셋 pivot·래스터 치수에 눈멀음 → D4로 주장 완화+게이트. z순서 비동형(D5)·컬링(D6)·scale 무언 누락(D7) 채택.
- **CROSS-MODEL:** 리뷰(구현 방향 건전) vs 아웃사이드(증거 강도 과대) — 사용자 결정: 방향 유지하되 주장 완화 + Maker 2건을 §3 착수 게이트로.
- **VERDICT:** ENG CLEARED (PLAN) — 7 결정 확정. T1~T5 즉시 구현, T6 게임 세션 인계, T7(Maker)이 §3 게이트.

NO UNRESOLVED DECISIONS
