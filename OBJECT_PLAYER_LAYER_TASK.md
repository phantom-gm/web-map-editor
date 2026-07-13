# 오브젝트 ↔ 플레이어 레이어(위/아래) 기능 — 타당성 검토 & 작업 지시서

## 1. 요구사항

오브젝트마다 플레이어와의 렌더 순서를 선택할 수 있어야 한다.

- **위(above)**: 오브젝트가 플레이어를 **덮는다**(지붕, 나무 윗가지, 다리 상판, 처마, 아치 등 — 플레이어가 뒤로 지나가는 것처럼 보임).
- **아래(below)**: 플레이어가 오브젝트 위에 그려진다(러그, 낮은 울타리, 바닥 장식 — 지금 기본 동작).

---

## 2. 현재 동작 (사실 확인)

| 대상 | 정렬 방식 | 값 | 근거 |
|---|---|---|---|
| 바닥/오브젝트 스프라이트 | 동적 y-sort | `ORDER_BASE(-1000) + row*ORDER_PER_ROW(10)` (전부 음수대) | `scripts/build_map.cjs:48,241,275` / `MapLoaderLogic.mlua:164` |
| 오브젝트 | y-sort + 앞줄 마진 + `sortOffset` + 5 | `-1000 + (gy + tilesH-1 + 3)*10 + sortOffset + 5` | `build_map.cjs:275` |
| **플레이어 본체** | **정적(static)** — 런타임 갱신 없음 | `SortingLayer="Default"`, `OrderInLayer=1` | `Models/Players/PartSlot.model:42,51`, 동적 setter 부재 확인 |
| 헤어 파츠 | 본체 +1 | `sr.OrderInLayer + 1` | `CharacterAppearanceComponent.mlua:107` |
| 이펙트/HP바/데미지 | 정적 고정 | `5000 / 5001` | `HpBarComponent.mlua:156`, `DamageNumberComponent.mlua:37`, `CombatNotifyLogic.mlua` |

**핵심**: 플레이어는 `Default` 레이어의 정적 order(≈1)이고, 맵 스프라이트는 전부 음수대라 **오브젝트가 항상 플레이어 아래**로 그려진다. 즉 요구사항의 "아래" 케이스는 이미 되고, **"위(덮기)" 케이스만 신규 구현이 필요**하다.

> `CharacterAppearanceComponent.mlua:101` 주석 "IsoDepth 도입 시에도 상대 유지" — 플레이어 동적 깊이정렬(IsoDepth)은 아직 미도입 상태임을 프로젝트도 인지하고 있음.

---

## 3. 타당성 결론

**가능하다.** 두 가지 접근이 있고, 요구사항은 방식 A로 즉시 충족된다.

- **방식 A — 정적 per-object 레이어 플래그** (권장 1단계, 소규모):
  오브젝트에 `layer: "above" | "below"` 필드를 두고, "above"는 플레이어보다 높은 order 밴드로 emit. 플레이어 로직 변경 불필요. 사용자 요청(위/아래 선택)을 그대로 충족.
  한계: **항상** 위/아래 고정. 플레이어가 나무 남쪽(앞)에 서 있어도 나무가 계속 덮음 → 처마/지붕/캐노피처럼 "항상 앞" 오브젝트에 적합.

- **방식 B — 동적 2.5D 깊이(IsoDepth)** (선택 2단계, 게임측 큰 작업):
  플레이어 본체 order를 자기 셀 Y로 매 프레임 갱신(타일과 같은 `ORDER_BASE + y*10` 스킴). 그러면 플레이어와 오브젝트가 행(row) 기준으로 자동 교차정렬 → 뒤(북)면 오브젝트가 덮고, 앞(남)이면 플레이어가 덮음(진짜 "돌아 걷기"). 플래그 없이도 자연스러움.

권장: **A 먼저(요구 충족), B는 추후 리얼리즘 필요 시.** 둘은 공존 가능(플래그 `auto`가 B의 동적 정렬을 의미하도록 확장).

---

## 4. 방식 A — 상세 작업 (권장 1단계)

### 4.1 데이터 모델 (웹 에디터)

`src/types/entity.ts` — `MapEntity`에 필드 추가:

```ts
// 플레이어 대비 렌더 레이어. "below"=플레이어가 위(기본), "above"=오브젝트가 플레이어를 덮음.
layer?: "above" | "below";
```

- 기본값 미설정 = `below`(현재 동작). `isEntityIncomplete`/마이그레이션 영향 없음.
- (선택) 세밀 조정용으로 기존 `sortOffset`도 함께 노출 가능(같은 레이어 안 미세 순서).

### 4.2 export (`src/lib/entityExport.ts`)

object export 시 `layer`를 그대로 통과(또는 `above`만 boolean으로):

```ts
if (e.layer === "above") out.layer = "above";
```

### 4.3 convert_map (`scripts/convert_map.cjs:185` 인근)

objects 매핑에 `layer` 추가:

```js
layer: e.layer === "above" ? "above" : "below",
```

### 4.4 build_map (`scripts/build_map.cjs:275` order 계산)

"above" 오브젝트는 **플레이어보다 높고 이펙트(5000)보다 낮은** 전용 밴드로 올린다.
밴드 안에서도 자기들끼리는 y-sort 유지(위 오브젝트가 여러 개일 때 서로 가림 정상화).

```js
// 상수 추가 (파일 상단 ORDER_* 근처)
const ABOVE_PLAYER_BASE = 2000;   // 플레이어(≈1) 위, 이펙트(5000) 아래. Maker 실측 후 조정.

// order 계산 분기
const rowOrder = (shGy + (ch - 1) + OBJECT_FWD_ROWS) * ORDER_PER_ROW + (obj.sortOffset || 0) + 5;
const order = obj.layer === "above"
  ? ABOVE_PLAYER_BASE + rowOrder            // 플레이어 위(덮기)
  : ORDER_BASE + rowOrder;                  // 기존(플레이어 아래)
```

> ⚠ `ABOVE_PLAYER_BASE`는 플레이어 본체의 **실효 order를 Maker에서 실측**한 뒤 확정할 것. 파츠 모델은 1이지만 런타임 스폰/레이어 병합에 따라 달라질 수 있음. 이펙트 5000 미만 유지 필수(안 그러면 데미지/HP바를 오브젝트가 가림).

### 4.5 에디터 UI (`src/components/EntityInspector.tsx`, object 블록)

배율/이동/기울기 아래에 셀렉트 추가:

```tsx
<label className="ei-row">
  <span>플레이어 레이어 — 위: 오브젝트가 플레이어를 덮음 / 아래: 플레이어가 위(기본)</span>
  <select value={entity.layer ?? "below"}
    onChange={(e) => updateEntity(entity.id, { layer: e.target.value === "above" ? "above" : undefined })}>
    <option value="below">아래 (플레이어가 위 — 기본)</option>
    <option value="above">위 (오브젝트가 플레이어를 덮음)</option>
  </select>
</label>
```

### 4.6 에디터 시각화 (선택, `src/components/CanvasGrid.tsx`)

에디터는 플레이어가 없어 위/아래 체감이 안 됨. 표식만 제공:
- "above" 오브젝트에 뱃지/외곽선 색 구분(예: 상단 "▲" 마커) → 어떤 오브젝트가 플레이어를 덮는지 눈으로 식별.

---

## 5. 방식 B — 동적 IsoDepth (선택 2단계, 게임측)

플레이어 본체 order를 셀 Y로 매 프레임 갱신해 오브젝트와 자동 교차정렬.

필요 작업(게임 repo):
1. 플레이어에 붙는 컴포넌트(예 `PlayerIsoDepthComponent`)에서 `OnUpdate`마다 월드 좌표 → 셀 Y → `body.OrderInLayer = ORDER_BASE + cellY*ORDER_PER_ROW + PLAYER_BIAS`. 헤어(+1)/HP바(정적 5000)는 상대 유지.
2. 오브젝트 order 스킴과 **앵커 행 정합**: 오브젝트는 `gy + tilesH-1 + OBJECT_FWD_ROWS + 5` 마진을 쓰므로, 플레이어 셀 Y와 "같은 줄에서 누가 앞인가"를 맞추려면 마진 보정 필요. 캐노피 오버행(위 3.4의 FWD_ROWS)과 상호작용 주의.
3. `layer` 플래그를 `auto`로 확장 → 동적 정렬, `above`/`below`는 강제 오버라이드로 유지.

리스크: 앵커/행 보정 미스 시 "발끝이 타일에 잘림" 또는 "한 칸 일찍/늦게 가려짐". 반드시 Maker 플레이로 걸어보며 튜닝. 멀티플레이 시 각 클라이언트 로컬 계산이라 동기화 부담은 낮음(순수 시각).

---

## 6. 리스크 & 검증 체크리스트

- [ ] 플레이어 본체 실효 `OrderInLayer`를 Maker에서 실측 → `ABOVE_PLAYER_BASE` 확정(이펙트 5000 미만 보장).
- [ ] "above" 오브젝트가 HP바/데미지 숫자/스킬 이펙트(5000대)를 가리지 않는지 확인.
- [ ] 같은 "above" 밴드에 여러 오브젝트가 겹칠 때 서로 y-sort 정상인지.
- [ ] 몬스터/NPC도 플레이어처럼 정적 order임 — "above" 오브젝트가 몬스터도 덮게 되는데 의도와 맞는지 확인(대개 OK: 지붕은 몬스터도 덮음).
- [ ] `nocode_map --build` 후 `.map`에서 해당 오브젝트 `OrderInLayer` 값이 밴드에 들어갔는지 파싱 확인.
- [ ] 기존 맵 하위호환: `layer` 없는 오브젝트는 `below`(현행) 그대로.

---

## 7. 파일별 변경 요약

| 파일 | 변경 |
|---|---|
| `web-map-editor/src/types/entity.ts` | `layer?: "above"｜"below"` 필드 |
| `web-map-editor/src/lib/entityExport.ts` | object export 시 `layer` 통과 |
| `web-map-editor/src/components/EntityInspector.tsx` | 레이어 셀렉트 UI |
| `web-map-editor/src/components/CanvasGrid.tsx` (선택) | "above" 오브젝트 표식 |
| `legend_of_light/scripts/convert_map.cjs` | objects 매핑에 `layer` |
| `legend_of_light/scripts/build_map.cjs` | `ABOVE_PLAYER_BASE` 밴드 분기 |
| (방식 B, 선택) `legend_of_light/.../PlayerIsoDepthComponent.mlua` | 플레이어 동적 order |

---

## 8. 권장 로드맵

1. **방식 A** 구현 → 요구사항(위/아래 선택) 즉시 충족. 리스크 낮음, 플레이어 로직 무변경.
2. Maker에서 캐노피/지붕 오브젝트로 검증, `ABOVE_PLAYER_BASE` 튜닝.
3. 진짜 "돌아 걷기"가 필요해지면 **방식 B**(플레이어 IsoDepth) 추가, `layer:auto` 도입.

---

# 9. 리뷰 확정 설계 (plan-eng-review 반영)

엔지니어링 리뷰(방식 A+B 심층)에서 6개 결정 + 아웃사이드 보이스 갭을 반영해 §4/§5를 아래로 **덮어쓴다**(원문은 초안, 이 섹션이 확정).

## 9.1 확정 결정 요약

| # | 결정 | 근거 |
|---|---|---|
| D1 | **측정을 구현 선행조건으로 고정** + `build_map` 밴드 불변식 assert | above 밴드가 미측정 매직넘버 의존 |
| D2 | **통합 정렬 모델을 지금 설계**: `layer: above / below / auto` 3상태, 밴드가 B 도입 후에도 유효 | A와 B가 정렬 가정에서 충돌 |
| D3 | **시각 리프트(바닥타일 가림 방지)와 플레이어 비교행 분리** | `OBJECT_FWD_ROWS(+3행)`가 플레이어 교차를 깨뜨림 |
| D4 | 에디터는 **above 배지/표식만**(라이브 플레이어 프리뷰 없음) | 오버엔지니어링 방지 |
| D5 | **row 항을 밴드 내로 정규화/클램프** → `below < player < above < effect(5000)` 수학적 보장(맵 크기 무관); 기존 ground order도 동시 재밴딩 | order = -1000+row*10 은 row>~100 이면 양수 → 대형맵서 바닥타일이 이미 플레이어를 덮음 |
| D6 | 나무처럼 **부분 가림은 줄기(below)+윗가지(above) 2-엔티티 분할** 패턴으로(한 스프라이트 불가) 문서 명시 | 대표 예시 '나무 윗가지'가 per-object 플래그로 불가 |

## 9.2 정규화 밴드 스킴 (D5 — 핵심)

고정 상수 + 무계 row 항 대신 **밴드별 고정 폭 + row 클램프**로 불변식을 보장한다.

```
정수 order 축 (SortingLayer="Default", 단일 레이어 내):

  ...  BELOW band  ...        PLAYER   ...  ABOVE band  ...     EFFECT
 [-10000 ............ -6001]    (0)     [1000 ......... 4999]   5000+
   ground tile + below object          above object            HP바/데미지/스킬

  bandOrder(base, compareRow) = base + clamp(compareRow * ORDER_PER_ROW, 0, BAND_WIDTH-1)
    BELOW_BASE   = -10000,  BAND_WIDTH = 4000   → [-10000, -6001]
    ABOVE_BASE   =   1000,  BAND_WIDTH = 4000   → [  1000,  4999]
    PLAYER(A,정적) = 0                            → below < 0 < above < 5000  ✓ (맵 크기 무관)
    EFFECT       =   5000+ (기존 유지)
```

- **불변식 보장**: 클램프 때문에 `compareRow`가 아무리 커도 below는 −6001 이하, above는 4999 이하 → `below < player(0) < above < effect` 를 수학적으로 만족. D5 요구.
- **재밴딩 범위(⚠ blast radius)**: ground 타일 order도 이 스킴(BELOW band)으로 이동해야 함 → **모든 맵의 `.map` order 값이 바뀜**. 가장 큰 기존 맵으로 `nocode_map --build` 후 `.map` 파싱 검증 필수. 소형맵은 시각 결과 동일해야 정상.
- **클램프 포화 한계**: 한 맵이 400행(=BAND_WIDTH/ORDER_PER_ROW)을 넘으면 먼 행끼리 order가 포화돼 상대 정렬을 잃음. `BAND_WIDTH`는 예상 최대 맵 깊이보다 크게. 초과 시 `log()` 경고(무언의 절단 금지).
- **D1 assert**: 산출된 어떤 order도 `>= 5000`(이펙트 침범) 또는 두 밴드 교집합이면 build 중단/경고.

## 9.3 비교행 vs 시각 리프트 분리 (D3)

```
현행:  order = ORDER_BASE + (gy + tilesH-1 + OBJECT_FWD_ROWS(3))*10 + sortOffset + 5
                                            └─ 플레이어 교차를 +3행 밀어 깨뜨림 ─┘

확정:  compareRow = gy + tilesH - 1              // footprint 앞줄 = 플레이어와 비교하는 유일 기준
       order      = bandOrder(base, compareRow) + 5   // +5 = 같은 행 바닥타일만 걷어내는 sub-nudge(<10)
       // OBJECT_FWD_ROWS 제거. 앞줄(tilesH 반영) 자체가 깊이를 이미 반영하므로
       // 깊은 오브젝트(8×8 집)도 앞줄+5 로 자기 바닥타일 위에 뜸.  ⚠ Maker 로 8×8 집 재검증(가림 재발 여부).
       // sortOffset 은 밴드 내 미세조정으로 유지하되, above 이탈 방지 위해 clamp 안에서만 적용.
```

방식 B에서 플레이어는 자기 셀 Y*10 을 `compareRow` 와 같은 축에서 비교 → 앞에 서면 플레이어가, 뒤에 서면 오브젝트가 덮음(정확 교차).

## 9.4 아웃사이드 보이스 갭 → 확정 요구사항

| 갭 | 반영 |
|---|---|
| G1/G2 무계 order·밴드 비분리 | §9.2 정규화 밴드로 해결(D5) |
| G3 몬스터/NPC도 정적 3번째 클래스 | **방식 B는 플레이어만이 아니라 모든 액터(플레이어·몬스터·NPC·드롭)를 동일 row-동적 스킴으로 통일**해야 '통합'. B 범위에 명시(§5 확장). A 단계에선 above 오브젝트가 몬스터도 덮음(지붕=의도) |
| G4 멀티플레이 | B의 order 갱신기는 `LocalPlayer` 뿐 아니라 **맵 내 모든 액터 엔티티를 클라이언트 로컬로 순회**해 order 갱신해야 원격 플레이어도 바르게 정렬. (OrderInLayer 는 client-local 시각값) |
| G5 나무 캐노피 | §9.1 D6 — 줄기(below)+윗가지(above) 2-엔티티 분할 패턴. A는 '전체가 항상 앞'(지붕·처마·오버행)용으로 한정 |
| G6 FWD margin 이 A 밴드 위치도 부풀림 | §9.3 에서 compareRow 기반으로 A/B 공통 해소 |
| minor sortOffset+above 이탈 | sortOffset 을 밴드 clamp 안에서만 적용(§9.3) |
| minor Maker 왕복 비용 | D4 배지로 완화하되, 오브젝트 밀집 맵은 above 검증에 Maker 왕복 다수 필요함을 명시 |

## 9.5 편집기/게임 변경 (확정)

- `src/types/entity.ts`: `layer?: "above" | "below" | "auto"`. 기본 미설정=below. `migrateEntity` object 기본 below 유지.
- `src/lib/entityExport.ts`: `out.layer` 통과(above/auto 만 emit, below 생략).
- `src/components/EntityInspector.tsx`: 3-옵션 셀렉트(아래/위/자동(B)).
- `src/components/CanvasGrid.tsx`: above 오브젝트 **배지/외곽선 색 표식**(D4).
- `scripts/convert_map.cjs`: objects 에 `layer` 통과.
- `scripts/build_map.cjs`: `bandOrder()` 헬퍼 도입(§9.2), ground+object 재밴딩, `compareRow` 기반(§9.3), 밴드 불변식 assert(D1). **order 계산은 한 곳(`bandOrder`)으로 DRY.**
- (B, 별도 단계) `PlayerIsoDepthComponent.mlua`(전 액터 순회, row 변화 시에만 write — 매 프레임 렌더러 dirty 방지).

---

# 10. 테스트 계획 (확정)

```
유닛(에디터, vitest — 기존 entityExport/entitySize 패턴):
  [T-U1] entityExport: layer="above"→out.layer="above" / "auto"→"auto" / below·undefined→미출력
  [T-U2] migrateEntity: 레거시 object 기본 below(회귀 — 기존 맵 정렬 불변)
통합(게임, nocode_map --build → .map 파싱 assert — offset/rotation 검증과 동일 방식):
  [T-I1] above 오브젝트 order ∈ [1000, 5000)  &  below/ground order ∈ [-10000, -6001]
  [T-I2] 밴드 내 y-sort 보존(above 두 개 → compareRow 큰 쪽이 order 큼)
  [T-I3] 불변식: 어떤 order도 5000 미침범, below∩above=∅ (대형맵 = 최대행 맵으로)
  [T-I4] 회귀: 기존 소형맵 재빌드 시 상대 정렬(플레이어 대비) 불변
Maker 수동(에디터는 배지만 — D4):
  [T-M1] 지붕/처마 above → 플레이어 뒤로 지나감 확인
  [T-M2] 8×8 집(below) 재검증 — FWD_ROWS 제거 후 자기 바닥타일 가림 재발 여부(§9.3 리스크)
```

⚠ **테스트 하네스 갭**: 밴드 로직이 테스트 없는 `build_map.cjs`에 있음 → 편집기 유닛(T-U*)으로 잡을 수 없는 부분은 `.map` 파싱 통합(T-I*)으로 커버. 게임 repo에 `.map` 파싱 assert 스크립트(offset/rotation 검증 재사용) 필요.

---

# 11. NOT in scope (명시적 보류)

- **방식 B(전 액터 동적 IsoDepth)** — 게임측 대규모(전 액터 순회 order 갱신 + 멀티 동기). A로 '위/아래 선택' 요구는 충족되므로 별도 단계. (G3/G4 포함)
- **나무 캐노피 자동 분할 기능** — 에디터가 상단 N%를 above로 자동 분리. 큰 신규 기능, 지금은 수동 2-엔티티 분할 패턴(D6)으로 대체.
- **에디터 라이브 플레이어 토큰 프리뷰** — D4로 배지만. WYSIWYG 교차 프리뷰는 보류.
- **BAND_WIDTH 초과(400행+) 초대형 맵의 정밀 정렬** — 포화 경고만, 정밀 해법 보류.

# 12. What already exists (재사용)

- `sortOffset` 배선(convert_map:185 / build_map:275) — 이미 존재, 밴드 clamp 내 미세조정으로 재사용.
- `ORDER_BASE`/`ORDER_PER_ROW` 상수 + iso order 스킴 — `bandOrder()`가 이를 감싸 재사용(신규 정렬 시스템 아님, **[Layer 1]** MSW OrderInLayer 빌트인).
- `entityExport`/`entitySize` vitest 패턴 — layer 유닛 테스트가 그대로 따름.
- offset/rotation `.map` 파싱 검증 방식 — 통합 테스트(T-I*)에 재사용.

# 13. Failure modes (신규 코드패스별)

| 코드패스 | 실패 방식 | 테스트 | 에러처리 | 사용자 체감 |
|---|---|---|---|---|
| `bandOrder` 클램프 포화 | 400행+ 맵서 먼 행 order 동률 → 정렬 뒤섞임 | T-I3 | `log()` 경고 | (초대형맵) 정렬 이상 — **경고 있음** |
| 밴드 불변식 위반 | above order ≥ 5000 → 이펙트/HP바 가림 | T-I3 | build assert/중단(D1) | 빌드 실패로 사전 차단 |
| ground 재밴딩 회귀 | 기존 맵 order 전면 변경 → 소형맵 정렬 틀어짐 | T-I4/T-M | nocode 검증 | **크리티컬 후보** — 대형맵 미검증 시 조용한 정렬붕괴 |
| FWD_ROWS 제거 | 깊은 오브젝트가 자기 바닥타일에 가림 | T-M2 | 없음 | 집 하단 잘림 — Maker 검증 필수 |
| B: 원격 플레이어 미순회 | 내 화면서 남 캐릭 정렬 오류 | (B 단계) | 없음 | 남 캐릭이 벽 뚫려 보임 |

**크리티컬 갭 1개**: `ground 재밴딩 회귀` — 대형맵 미검증 시 조용한 정렬붕괴 가능. T-I4 + 최대행 맵 Maker 검증을 **P1**으로.

# 14. Worktree 병렬화

| Step | 모듈 | 의존 |
|---|---|---|
| S1 에디터(entity/export/inspector/canvas) | web-map-editor/src | — |
| S2 게임 order(build_map/convert_map) | legend_of_light/scripts | S1의 layer 계약 |
| S3 통합 테스트(.map 파싱) | legend_of_light/scripts | S2 |
| S4 방식 B(액터 동적) | legend_of_light/RootDesk | S2 밴드 스킴 |

`Lane A: S1 (독립) → Lane B: S2 → S3 (순차, 계약 의존) → Lane C: S4 (B, 나중)`. S1/S2는 repo가 달라 병렬 가능하되 **layer 계약(above/below/auto)을 먼저 합의**해야 S2 시작. 실질 순차(S1→S2→S3), S4는 별도 단계.

# 15. Implementation Tasks

- [ ] **T1 (P1, human ~2h / CC ~20min)** — game/build_map — `bandOrder()` 정규화 밴드 스킴 + ground/object 재밴딩 + 불변식 assert
  - Surfaced by: Arch D1/D5, 아웃사이드 G1/G2 — 무계 order → 밴드 보장
  - Files: `legend_of_light/scripts/build_map.cjs`
  - Verify: nocode_map --build → 최대행 맵 `.map` 파싱, below/above/effect 밴드 assert
- [ ] **T2 (P1, human ~1h / CC ~15min)** — game/build_map — compareRow(=앞줄) 기반 order, OBJECT_FWD_ROWS 제거
  - Surfaced by: Arch D3, G6 — 시각 리프트/비교행 분리
  - Files: `legend_of_light/scripts/build_map.cjs`
  - Verify: T-M2 (8×8 집 가림 재발 여부)
- [ ] **T3 (P1, human ~30min / CC ~10min)** — editor — `layer: above/below/auto` 필드 + export + convert 통과
  - Surfaced by: Arch D2 — 통합 3상태 모델
  - Files: `src/types/entity.ts`, `src/lib/entityExport.ts`, `scripts/convert_map.cjs`
  - Verify: vitest T-U1/T-U2
- [ ] **T4 (P2, human ~40min / CC ~10min)** — editor — 인스펙터 3-옵션 셀렉트 + CanvasGrid above 배지
  - Surfaced by: Arch D4
  - Files: `src/components/EntityInspector.tsx`, `src/components/CanvasGrid.tsx`
  - Verify: 브라우저 — above 지정 시 배지 표시
- [ ] **T5 (P1, human ~1h / CC ~15min)** — game — `.map` 파싱 통합 테스트(밴드 불변식·y-sort·회귀)
  - Surfaced by: Test review — build_map 테스트 하네스 갭
  - Files: `legend_of_light/scripts/*` (파싱 assert 스크립트)
  - Verify: T-I1..T-I4 통과
- [ ] **T6 (P3, 별도 단계)** — game — 방식 B: 전 액터 동적 order 컴포넌트(row 변화 시만 write, 원격 포함 순회)
  - Surfaced by: Arch D2, G3/G4 — 진짜 2.5D
  - Files: `legend_of_light/RootDesk/.../PlayerIsoDepthComponent.mlua`
  - Verify: Maker 플레이 — 앞/뒤 걷기 교차, 멀티 원격 캐릭 정렬

---

# 16. Phase별 체크리스트

각 Phase는 **exit 게이트**를 통과해야 다음으로. Phase 0은 blocking(측정 없이 상수 확정 금지). 방식 A = Phase 0~3, 방식 B = Phase 4(별도 단계).

## Phase 0 — 선행 측정 (D1, BLOCKING) — 태스크 없음, 데이터 확보
- [ ] Maker에서 **플레이어 본체 실효 `OrderInLayer`** 로그로 실측(파츠 모델값 1이 런타임과 같은지)
- [ ] Maker에서 **몬스터/NPC 실효 order**도 실측(방식 B 통일 대상 파악)
- [ ] 기존 맵 중 **최대 행수(map H)** 확인 → `BAND_WIDTH` 여유 결정 근거
- [ ] 확정 상수 기록: `BELOW_BASE / ABOVE_BASE / BAND_WIDTH / PLAYER(A정적)` (§9.2)
- **Exit 게이트**: below<player<above<5000 이 실측값으로 성립함을 종이 계산으로 확인. ✅ 실패 시 상수 재조정.

## Phase 1 — 정렬 밴드 스킴 (게임, T1+T2) — `build_map.cjs`
- [ ] `bandOrder(base, compareRow)` 헬퍼 도입 — row 항 `clamp(compareRow*10, 0, BAND_WIDTH-1)` (§9.2)
- [ ] **ground 타일** order를 BELOW band로 재밴딩(⚠ blast radius — 전 맵 order 변경)
- [ ] **object** order: below→BELOW band / above→ABOVE band / (auto=현재 below 취급)
- [ ] `compareRow = gy + tilesH - 1` 기반, **`OBJECT_FWD_ROWS` 제거**, 같은 행 바닥타일용 `+5` sub-nudge (§9.3)
- [ ] `sortOffset`은 밴드 clamp **안에서만** 적용(above 이탈 방지)
- [ ] **불변식 assert**: 산출 order가 `>=5000`(이펙트 침범) 또는 두 밴드 교집합이면 build 중단/경고 (D1)
- [ ] `BAND_WIDTH` 초과 맵 → `log()` 포화 경고(무언의 절단 금지)
- **Exit 게이트**: `nocode_map --build` 성공 + order 계산 로직이 `bandOrder` 한 곳으로 DRY.

## Phase 2 — layer 계약 (에디터, T3+T4)
- [ ] `src/types/entity.ts` — `layer?: "above" | "below" | "auto"`; `migrateEntity` object 기본 below
- [ ] `src/lib/entityExport.ts` — `out.layer`(above/auto만 emit, below 생략)
- [ ] `scripts/convert_map.cjs` — objects에 `layer` 통과
- [ ] `src/components/EntityInspector.tsx` — 3-옵션 셀렉트(아래/위/자동(B))
- [ ] `src/components/CanvasGrid.tsx` — above 오브젝트 **배지/외곽선 표식**(D4)
- **Exit 게이트**: 타입체크·린트 통과 + export한 project.json에 layer 반영 확인.

## Phase 3 — 검증 (T5 + Maker) — 착수 게이트
- [ ] 유닛(vitest): `[T-U1]` export layer 분기 · `[T-U2]` migrate 기본 below 회귀
- [ ] 통합(.map 파싱): `[T-I1]` 밴드 범위 · `[T-I2]` 밴드 내 y-sort · `[T-I3]` 불변식(최대행 맵) · `[T-I4]` 소형맵 회귀
- [ ] Maker: `[T-M1]` 지붕/처마 above → 플레이어 뒤로 지나감 · `[T-M2]` **8×8 집 바닥타일 가림 재발 여부**(FWD_ROWS 제거 리스크)
- [ ] **크리티컬(P1)**: 최대행 기존 맵을 재빌드→Maker로 정렬 회귀 없음 확인(ground 재밴딩 blast radius)
- **Exit 게이트**: T-I1~I4 그린 + T-M1/M2 육안 정상 + 최대행 맵 회귀 없음. ✅ 방식 A 완료.

## Phase 4 — 방식 B (별도 단계, T6) — 진짜 2.5D
- [ ] `PlayerIsoDepthComponent.mlua` — `OnUpdate`서 셀 Y→order, **row 변화 시에만 write**(렌더러 dirty 방지)
- [ ] **전 액터 순회**(플레이어+몬스터+NPC+드롭) 동일 동적 스킴 — 아니면 '통합' 아님(G3)
- [ ] **멀티**: `LocalPlayer`만이 아니라 맵 내 **모든 원격 액터** 클라이언트 로컬 갱신(G4)
- [ ] `layer: auto` = 동적 정렬, above/below = 강제 오버라이드로 재해석(D2)
- **Exit 게이트**: Maker 플레이 — 앞/뒤 걷기 교차 + 멀티 원격 캐릭 정렬 정상.

## 진행 순서 요약
```
Phase 0 (측정) ─BLOCKING─▶ Phase 1(밴드) ─┐
                          Phase 2(계약) ─┴▶ Phase 3(검증) = 방식 A 완료
                                                    └──(필요 시)──▶ Phase 4(방식 B)
```
Phase 1·2는 repo가 달라 병렬 가능하되 **layer 계약(above/below/auto) 먼저 합의**. 리뷰 권장 착수: Phase 0 → (T3 계약 + T1/T2 밴드) → T5 검증 → T4 UI.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 4 issues (3 arch + 1 code-quality), 1 critical gap, 6 decisions locked |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE VOICE (Claude subagent):** ran — 7 gaps + 2 minors. 2를 크로스모델 텐션으로 상신(둘 다 사용자 결정): 정렬체계 건전성 → **정규화 밴드**(D5), 나무 캐노피 → **2-엔티티 분할 명시**(D6). 나머지(G3 전 액터·G4 멀티·G6 리프트·minors) → §9.4 요구사항으로 흡수.
- **CROSS-MODEL:** 리뷰(측정 후 상수 밴드) vs 아웃사이드(무계 order라 밴드 비증명) 충돌 → 사용자가 **정규화 밴드**로 통합 해결. order 스킴이 대형맵서 이미 불건전하다는 강한 합의.
- **크리티컬 갭 1개:** ground 재밴딩 회귀 — 대형맵 미검증 시 조용한 정렬붕괴. T-I4 + 최대행 맵 Maker 검증을 P1 게이트로.
- **VERDICT:** ENG CLEARED (PLAN) — 6개 결정 확정, 구현 착수 가능. 착수 순서 T3(계약)+T1 → T2 → T5(검증) → T4; T6(방식 B)은 별도 단계.

NO UNRESOLVED DECISIONS
