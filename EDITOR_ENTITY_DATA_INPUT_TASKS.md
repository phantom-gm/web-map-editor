# 에디터 작업 지시 — 엔티티 누락 데이터 입력 (포탈 목적지 / 몬스터·NPC 종류)

> **이 문서만 보고 작업 가능하도록 자체 완결.** 이 에디터(`web-map-editor`, Next 14)에서 만든 맵을
> **코드 없이 게임에 반영**하려면, 맵 export(project.json)를 게임 쪽 변환기 `convert_map.cjs`가 소비한다.
> 그런데 지금 에디터가 **포탈 목적지 방향**과 **몬스터/NPC 종류(NpcClassID)**를 입력받지 못해, 변환기가
> 그 엔티티들을 **거부(fail-closed)** 한다. 이 문서는 그 입력을 추가하는 작업 지시다.

---

## 0. 배경 (왜 필요한가)

파이프라인: **에디터 export(project.json) → `convert_map.cjs` → 게임 데이터(DT_NpcSpawn / DT_Portal 등)**.
변환기는 "미해결 데이터가 있으면 아무것도 만들지 않고 에러로 중단"(fail-closed)한다. MSW는 잘못된 값이
조용히 안 보이는/안 움직이는 실패를 내기 때문이다.

현재 이 에디터 export 를 변환기에 넣으면:

```
❌ 미해결 5 (fail-closed):
  - portal(2,12): destMap 없음 / destCell 없음      ← destFacing 은 선택(기본 SE), 필수 아님
  - monster(3,15): npcClassId 없음 (어떤 monster 인지 특정 불가)
  - monster(7,15): npcClassId 없음
  - monster(6,16): npcClassId 없음
```

→ **바닥·오브젝트는 이미 통과**한다. 포탈·몬스터·NPC만 아래 필드를 추가하면 통과한다.

---

## 1. 변환기가 요구하는 계약 (canonical) — 이대로 export 되게 할 것

각 `entities[]` 항목에 kind별로 아래 필드가 있어야 한다:

| kind | 필수 필드 | 타입 | 지금 상태 |
|---|---|---|---|
| `portal` | `destMap` (필수) | string(맵 이름) | ❌ 없음(내부 `targetMap` 있음) |
| | `destCell` (필수) | `[number, number]` (도착 셀) | ❌ 없음(내부 `targetX/targetY` 있음) |
| | `destFacing` **(선택)** | `"SE"\|"SW"\|"NE"\|"NW"`, 미지정=**기본 SE** | 없어도 통과 |
| `monster` / `npc` | `npcClassId` (필수) | number (예: 1002) | ❌ **완전 없음** |
| `object` | `ruid`,`tilesW`,`tilesH`,`flipX` | — | ✅ 이미 있음 |

> 좌표는 **에디터 0-based 셀좌표 그대로**(변환기가 정규화한다). 바꾸지 말 것.

---

## 2. 작업 목록

### T1 (핵심) 몬스터/NPC `npcClassId` 입력
**파일**: `src/types/entity.ts`, `src/components/EntityInspector.tsx`

- `src/types/entity.ts` `MapEntity`에 필드 추가:
  ```ts
  npcClassId?: number; // monster/npc: DT_NpcClass 의 NpcClassID (예: 1002)
  ```
- `EntityInspector.tsx` 의 `monster`/`npc` 블록에 **NpcClass 선택 드롭다운** 추가.
  - 값 = `entity.npcClassId`, onChange → `updateEntity(entity.id, { npcClassId: Number(v) })`.
  - 옵션 목록 = NpcClass 카탈로그(아래 T1-b). 카탈로그 못 불러온 경우 **숫자 직접입력** 폴백.
  - 표시: `1002 — 거미 (Monster)` 형태.

### T1-b NpcClass 카탈로그 로드 (드롭다운 소스)
**패턴**: 이 에디터의 **RUID 레지스트리 로드와 동일 방식**(번들 seed + 파일 불러오기).

- `data/npcclass.seed.json` 추가: 게임의 `DT_NpcClass.csv`(컬럼 `NpcClassID,NpcName,NpcType,…`) 스냅샷.
  ```json
  { "version": 1, "entries": [
    { "id": 1000, "name": "말벌", "type": "Monster" },
    { "id": 1001, "name": "사마귀", "type": "Monster" },
    { "id": 1002, "name": "거미", "type": "Monster" }
  ] }
  ```
- 스토어/유틸에서 로드 → 드롭다운. (RUID 레지스트리 코드 `src/lib/registry.ts` / `apiClient.ts` 구조를 참고해 동일 패턴.)
- 개발자가 게임에 새 몬스터 종류를 등록하면 이 seed 를 갱신(무코드 경계: **기존 등록 종류만** 배치 가능).

### T2 포탈 `destFacing` 입력 — **선택(필수 아님)**
**파일**: `src/types/entity.ts`, `src/components/EntityInspector.tsx`

> `destFacing`은 **도착 후 바라볼 방향**이지 진입 제약이 아니다. 포탈은 밟고 지나가는 타일이라 어느
> 방향에서 걸어와도 진입된다(게임 이동 로직). 그래서 **매번 고를 필요 없음** — 미지정이면 변환기가
> **기본 SE**로 채운다. 이 필드는 "도착 방향까지 지정하고 싶을 때"만 쓰는 옵션이다.

- `MapEntity`에 추가:
  ```ts
  destFacing?: "SE" | "SW" | "NE" | "NW"; // 도착 후 방향(선택). 미지정 → 게임 기본 SE.
  ```
- `EntityInspector.tsx` 포탈 블록에 **방향 드롭다운**(선택). 첫 옵션 = **"무관 (기본 SE)"**(값 미설정),
  그 외 SE/SW/NE/NW. 미설정이 기본이므로 기획자는 대부분 손대지 않는다.

### T3 export 필드명 정렬 (targetMap/targetX/targetY → destMap/destCell)
현재 내부 필드는 `targetMap`, `targetX`, `targetY`. 변환기 계약은 `destMap`, `destCell:[x,y]`, `destFacing`.
**택1 (권장: 둘 다)**:
- (에디터) export 직전 또는 필드 정의를 **캐논 이름으로 통일**:
  `destMap = targetMap`, `destCell = [targetX, targetY]`, `destFacing`.
  - 가장 깔끔: `entity.ts` 필드를 `destMap`/`destCellX`/`destCellY`(또는 `destCell`)로 **리네임**하고 `EntityInspector`/`projectIO` 반영.
  - 또는 최소변경: `projectIO.ts` export 시 `targetMap→destMap`, `[targetX,targetY]→destCell` 로 매핑해 내보냄.
- (게임측) 변환기가 `target*` 별칭도 수용하도록 요청 가능 — **게임 담당에게 알리면 `convert_map.cjs`에 별칭 추가**한다(하위호환). 단 `destFacing`·`npcClassId`는 별칭이 없으므로 **반드시 에디터가 새로 입력**해야 한다.

### T4 미완성 시각 경고 (fail-closed 전에 에디터에서 잡기)
**파일**: `src/components/CanvasGrid.tsx`(엔티티 마커) 또는 엔티티 리스트 UI

- 미입력 엔티티를 **●미완성 배지**로 표시:
  - portal: `destMap` 또는 `destFacing` 없음
  - monster/npc: `npcClassId` 없음
- export 버튼 클릭 시 미완성 N건이면 **경고 다이얼로그**(진행/취소).

### T5 export 전 검증 (변환기와 동일 규칙)
**파일**: `src/lib/validate.ts`

- 아래 규칙을 에디터 검증에 추가(변환기 `convert_map.cjs`와 1:1 일치시켜, 에디터 "미완성 N건" = 변환기 "미해결 N건"):
  - portal: `destMap`(비어있지 않음) + `destCell`(2원소). `destFacing`은 선택(값 있으면 4방향 검사만)
  - monster/npc: `npcClassId`가 있고 NpcClass 카탈로그에 존재
  - (기존) object `ruid`, 셀 범위, 팔레트 RUID 등록

---

## 3. 변환기 검증 규칙 전문 (참고 — 에디터 검증을 여기 맞춘다)

변환기 `convert_map.cjs`(게임 repo `scripts/`)가 엔티티에 대해 에러를 내는 조건:

- `kind`가 `object|portal|monster|npc` 가 아니면 에러.
- 셀 `(gx,gy)`가 맵 `size`(W×H) 밖이면 에러.
- **object**: `ruid` 없으면 에러.
- **portal**: `destMap` 없음 / `destCell` 길이≠2 → 에러. `destFacing`은 **선택**(미지정=기본 SE); 값이 있는데 `SE/SW/NE/NW`가 아니면 에러.
- **monster·npc**: `npcClassId == null` → 에러. 있어도 `DT_NpcClass`에 없는 id → 에러.
- **palette**: ground 가 참조하는 팔레트 항목에 `ruid` 없으면(미등록) 에러.

---

## 4. 완료 기준 (Acceptance)

1. 에디터에서 포탈에 **목적지 맵+셀+방향**, 몬스터/NPC에 **NpcClassID**를 입력할 수 있다.
2. 미완성 엔티티가 **●배지 + export 경고**로 보인다.
3. 그 맵을 project.json 으로 export → 게임측 `convert_map.cjs <project.json> --report-only` 실행 시
   **`미해결 0`** 이 나온다(현재는 포탈 destMap/destCell + 몬스터 npcClassId 로 5건 나옴).
4. `entity.ts` 필드 추가로 기존 project.json 열기(하위호환) 안 깨짐.

---

## 5. 테스트 방법 (게임 repo 변환기로 왕복)

게임 repo(`legend_of_light`)의 변환기로 검증:

```bash
# 리포트만(산출 없음) — 미해결 목록 확인
node scripts/convert_map.cjs <에디터에서_export한_project.json> --report-only

# 통과하면 strict 변환(실제 산출: blueprint + spawn/portal/walk/bounds.csv)
node scripts/convert_map.cjs <project.json>
```

`--report-only` 가 `✅ 전부 해결 — 변환 가능` 를 출력하면 이 작업 완료.

---

## 참고 파일 (이 에디터)
- `src/types/entity.ts` — MapEntity 스키마 (여기에 `npcClassId`, `destFacing` 추가)
- `src/components/EntityInspector.tsx` — 속성 패널 (드롭다운 UI 추가)
- `src/lib/projectIO.ts` — project 파일 직렬화 (필드명 정렬)
- `src/lib/validate.ts` — export 전 검증 (규칙 추가)
- `src/lib/registry.ts` / `apiClient.ts` — RUID 레지스트리 로드 패턴(NpcClass 카탈로그 로드에 재사용)
- `src/components/CanvasGrid.tsx` — 엔티티 마커(미완성 배지)
