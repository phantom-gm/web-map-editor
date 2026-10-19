# 인계서 — web-map-editor 개선 작업 (2026-10-02)

> ⚠ **2026-10-19 기준 낡은 문서.** 이 인계서는 블루프린트(레거시) 경로와 c09697e 시점만 다룬다. 지금의 주 경로는
> 게임 맵 동기화(`.game-sync` · `scripts/game-sync/*` · 후보 출력)이며, 최신 현황과 남은 과제는
> `INTEGRATION_REVIEW_2026-10-19.md`와 README의 후보 출력·적용 절차를 본다. 게임 쪽 쓰기 금지 가드(`legacy-map-write-guard`)도 여기엔 없다.

> 이 문서 하나만 읽고 이어서 작업할 수 있도록 썼다. 앞선 세션(Claude)에서 코드 전체를 읽고
> 기준선 검증과 로컬 실행까지 마쳤다. **코드 수정은 아직 하지 않았다**(아래 §5의 설정 1건 제외).

---

## 1. 프로젝트 한 줄 요약

MSW(메이플스토리 월드) 아이소메트릭 RPG용 **웹 맵 에디터**. 2:1 다이아몬드 그리드에 바닥 타일을 칠하고
포탈/몬스터/NPC/오브젝트 엔티티를 배치한 뒤 export한다. export 결과는 **게임 repo `legend_of_light`**의
`scripts/convert_map.cjs` → `scripts/build_map.cjs`가 소비해 실제 게임 맵(.map)이 된다.

- 스택: Next.js 14 (App Router) · React 18 · TypeScript · Zustand 4 · Canvas 2D · vitest · ESLint(flat)
- 에디터 로직은 `src/*`, Next 셸은 `app/`(`app/page.tsx`가 `"use client"`로 `src/App` 렌더)
- 백엔드 `/api/*`: MSW MCP 서버(Nexon 자산 서버)를 통해 그룹 리소스 조회·이미지 추출·업로드

## 2. 실행 / 검증

```bash
npm install          # node_modules 없으면 먼저 (Node v24, npm 11 에서 확인)
npm run dev          # http://localhost:3000  (predev 가 scripts/sync-npcclass.mjs 실행)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
npm run test         # vitest run
```

- **기준선(2026-09-28)**: typecheck 통과 · lint 통과 · **테스트 16파일 97건 전부 통과**.
- `predev` 동기화 스크립트는 형제 폴더 `../legend_of_light/RootDesk/MyDesk/DataSet`을 찾는다.
  이 PC엔 없어서 "커밋된 seed 유지, 건너뜀"으로 통과한다(정상).
- `.env`(gitignore됨)에 `MSW_MCP_URL / MSW_MCP_TOKEN / MSW_GROUP_CODE / EDITOR_SHARED_SECRET`가 채워져 있고
  `/api/resources` 읽기 호출이 200으로 정상 응답하는 것을 확인했다. `KV_REST_API_*`는 비어 있다
  → 업로드로 추가된 RUID 매핑은 메모리 저장소라 서버 재시작 시 사라진다.
- ⚠ **`/api/upload`(PalettePanel의 "업로드" 버튼)는 그룹 스토리지에 실제 자산을 만든다.** 사용자 승인 없이 호출 금지.

## 3. 파일 지도 (핵심만)

| 경로 | 역할 |
|---|---|
| `src/store/editorStore.ts` (750줄) | Zustand 단일 스토어. ground/blocked/entities/palette, undo/redo(최대 100), import/export/load |
| `src/components/CanvasGrid.tsx` (715줄) | 캔버스 그리기 `draw()` + 마우스/키보드 입력 + 히트테스트(알파) |
| `src/components/EntityInspector.tsx` | 선택 엔티티 속성 패널 |
| `src/components/TopBar.tsx` | 맵 이름/크기, Import/Export(blueprint), RUID export, 겹침 정렬 |
| `src/components/FileMenu.tsx` | 프로젝트 파일 새로/열기/저장(⌘S). File System Access API 우선 |
| `src/components/PalettePanel.tsx` | 팔레트(PNG/폴더 추가, RUID파일, NPC목록 CSV, 서버 조회, 업로드, 스토리지) |
| `src/types/entity.ts` | `MapEntity` 스키마, `migrateEntity`(하위호환), footprint 계산 |
| `src/lib/entityGeom.ts` | 이미지 rect, pivot, **게임 깊이식 `gameDepthZ`**, 그리기 순서 |
| `src/lib/entityExport.ts` | export 시 object/npc에 scale·footprintCells·depthW/H·offset 등 부착 |
| `src/lib/validate.ts` | export/저장 전 검증(변환기 fail-closed 규칙과 1:1) |
| `src/lib/sortOffsetCheck.ts` | 겹치는 멀티셀 오브젝트 sortOffset 자동 계산 |
| `src/lib/blueprintIO.ts` | 게임 blueprint JSON ↔ 에디터 상태 |
| `src/lib/projectIO.ts` / `projectFile.ts` | 프로젝트 파일 v2(이미지는 RUID 참조만, base64 금지) / 저장·열기 |
| `src/lib/palette.ts`, `imageResolver.ts`, `imageCache.ts` | 팔레트 로드, RUID→이미지 복원(IndexedDB 캐시 → `/api/images`) |
| `src/lib/npcClass.ts` | NPC/몬스터 카탈로그(seed JSON 또는 게임 CSV 여러 장) |
| `app/api/{images,resources,resolve,upload}/route.ts` | 백엔드 라우트 |
| `src/server/mswMcp.ts`, `registryStore.ts`, `modPathStore.ts` | MCP 클라이언트, 레지스트리 저장소(KV/메모리) |
| `middleware.ts` | `/api/upload`만 `x-editor-secret` 요구. 나머지 /api는 무인증 |
| `src/__tests__/*` | 계약 잠금 테스트. **수식 바꾸면 여기부터 깨진다 — 의도된 것** |

## 4. 꼭 지켜야 할 계약 (어기면 게임과 어긋남)

1. **계약의 정본은 게임 repo 문서**다(`legend_of_light/docs/map/...`). 에디터의 깊이식·export 필드를 바꾸면
   게임 쪽 `build_map.cjs`/`convert_map.cjs`도 같이 바뀌어야 한다. **계약 변경은 사용자에게 먼저 확인.**
2. 깊이식(`DEPTH_SORT.md` 참고): `z = −(gx+gy)×0.14 − offsetY_px×PX_TO_WORLD − sortOffset×0.14` (작을수록 앞).
   `tilesW/H`, `baseW/H`, footprint 중심을 이 식에 넣지 말 것(과거 사고).
   밴드 `below < auto < above`가 z보다 우선.
3. 오브젝트 이미지 기준점(pivot) = **바닥-중앙**. 회전도 바닥-중앙 기준.
4. 좌표: 에디터 0-based 셀 `(gx,gy)`. X+1=SE, Y+1=SW. footprint는 앵커(앞-아래 tip)에서 **−방향(북서)**으로 뻗는다.
   PX_TO_WORLD = 0.56/64.
5. 프로젝트 파일에 **이미지 base64를 다시 넣지 말 것**(v1에서 78MB 사고). 팔레트는 `ruid + px`만 저장.
6. 오브젝트 `layer` 기본값은 **`auto`(미설정)**. 루트 문서 `OBJECT_PLAYER_LAYER_TASK.md`의 "기본 below"는 옛 결정.

## 5. 현재 작업 트리 상태

- 브랜치 `main`, 마지막 커밋 `c09697e`.
- **미커밋 변경 1건**: `.claude/launch.json` 포트 5173 → **3000** (Next dev 기본 포트와 맞춤. 커밋해도 됨).
- 이 `HANDOFF.md`도 새 파일(미커밋).
- 커밋 메시지 관례: `fix(scope): 한국어 설명` / `feat(editor): ...` 형식. 코드 주석은 한국어, "왜"를 길게 적는 스타일.

## 6. 루트 md 문서 상태 (읽을 때 주의)

| 문서 | 상태 |
|---|---|
| `DEPTH_SORT.md` | **현행** — 깊이 규칙 요약 |
| `EDITOR_ENTITY_DATA_INPUT_TASKS.md` | T1~T7 **전부 구현 완료** |
| `OBJECT_PIVOT_ALIGNMENT.md` | 본문은 "pivot=중심" 전제 → 상단 개정 박스대로 **bottom-center가 현행** |
| `OBJECT_PLAYER_LAYER_TASK.md` | 에디터 측(T3/T4) 구현됨. 단 기본값은 `auto`로 바뀜. 게임 측 밴드 작업은 게임 repo 소관 |
| `WEB_MAP_EDITOR_PALETTE_OBJECTS_DESIGN.md` | 폴더 업로드·스토리지 불러오기 완료. 별도 오브젝트 팔레트는 엔티티 방식으로 대체. 진행표시/병렬 로드 미구현 |
| `README.md` | 설계 링크 `../../docs/...`가 이 repo에선 **깨져 있음**. 실행 경로 `cd tools/web-map-editor`도 옛 경로 |

## 7. 개선 백로그 (우선순위순)

> 각 항목은 위치·문제·제안·완료기준 순. **A부터 권장.** A 항목은 게임 계약을 건드리지 않는다.
> 각 수정마다 vitest 회귀 테스트를 추가하는 것이 이 repo의 관례다.

### A. 실제 버그 (작고 확실)

**A1. blueprint Export 경로에 "이미지 미해석 오브젝트" 경고 누락**
- 위치: `src/components/TopBar.tsx` `onExport` (validateMap 호출, 42행 근처)
- 문제: 저장(`FileMenu.tsx` doSave)은 `hasImage`를 넘겨 경고하지만 Export는 안 넘긴다.
  이미지 없는 오브젝트는 `scale`이 빠진 채 나가서 게임에서 거대하게 배치된다.
- 제안: FileMenu와 같은 `makeEntityImageLookup(s.palette)` 기반 `hasImage`를 `validateMap`에 전달.
  (두 곳이 같은 로직이니 작은 헬퍼로 묶어도 좋음)
- 완료: 이미지 없는 object가 있을 때 Export 확인창에 해당 경고가 뜬다.

**A2. undo에 안 잡히는 편집**
- `moveEntityTo` (`editorStore.ts` ~480행)는 undo 스냅샷을 쌓지 않는다. 마우스 드래그는
  CanvasGrid가 `commitStroke`로 감싸서 되지만, **방향키 이동**(`CanvasGrid.tsx` keydown, ~490행)은 되돌릴 수 없다.
- `autoFixSortOffsets` (~552행)도 스냅샷 없음. 그런데 **Export 버튼이 이걸 자동 실행**해 엔티티를 바꾼다.
- 제안: 방향키 이동 전후로 `commitStroke(before)` 패턴 적용(또는 스토어에 undo 포함 이동 액션 추가),
  `autoFixSortOffsets`는 fixes가 있을 때 before 스냅샷을 undoStack에 push.
- 완료: 방향키 이동·겹침 정렬·Export 후 ⌘Z로 원상복구. 스토어 단위 테스트 추가.

**A3. 텍스트 입력이 한 글자마다 undo 기록을 쌓음**
- 위치: `EntityInspector.tsx`의 `setStr`(이름, destMap, dialogId)·`setNum`이 `onChange`마다 `updateEntity` 호출
  → `updateEntity`는 매번 undo push. undo 상한 100이라 이름 몇 번 고치면 이전 작업 기록이 밀려난다.
- 제안: 숫자 필드는 이미 `NumberField`(blur/Enter 커밋) 패턴이 있다. 텍스트도 같은 방식의 `TextField`
  (로컬 state → blur/Enter 시 커밋)로 바꾸거나, updateEntity에 "직전 undo와 같은 엔티티·같은 키면 병합" 옵션.
- 완료: 이름 10글자 입력 후 ⌘Z 1회로 입력 전 상태 복귀.

**A4. RUID 500개 초과 시 이미지가 조용히 누락**
- 위치: 서버 `app/api/images/route.ts`가 `MAX_RUIDS=500`으로 slice, 클라이언트 `src/lib/apiClient.ts`
  `fetchImages`는 한 번에 전부 전송(청크 없음).
- 추가 우려(미검증): 500개 base64 PNG를 한 응답에 담으면 Vercel 응답 크기 한도(약 4.5MB)에 걸릴 수 있다.
- 제안: 클라이언트에서 예: 100개 단위로 청크해 순차/제한 병렬 요청, 결과 병합. 실패 청크는 건너뛰고 나머지 반영.
- 완료: 600개 RUID 입력 시 요청이 여러 번 나가고 모두 반영(fetch 모킹 유닛 테스트).

**A5. (해결됨, 커밋만 필요)** `.claude/launch.json` 포트 3000.

### B. 성능 / 구조

**B1. 마우스 이동마다 전체 재그리기 + 바닥 셀 재정렬**
- `CanvasGrid.tsx` `draw()`가 hover 변경마다 호출되고, 매번 `ground` Map → 배열 생성 → `sort`.
- 제안: 정렬된 셀 배열을 `groundVer` 기준으로 메모이즈. 더 나아가 hover/선택 오버레이만 별도 캔버스로 분리.
- 완료: 큰 맵(예 200×200 칠함)에서 호버 시 프레임 드랍 체감 감소. 시각 결과 동일.

**B2. 대형 파일 분리**: `CanvasGrid`(입력 처리/그리기/히트테스트), `editorStore`(엔티티 액션/팔레트 액션)를
  모듈로 나누기. 동작 변경 없이 리팩터만. 테스트 전부 그대로 통과해야 함.

**B3. 중복 상수·수식 정리**: `PX_TO_WORLD`가 `entity.ts`와 `entityExport.ts`에 따로 정의.
  `sortOffsetCheck.gameZ`와 `entityGeom.gameDepthZ`가 같은 식을 두 번 구현 → 하나로 통합(값 동일성 테스트 유지).

**B4. `loadTiles` 순차 처리**(`src/lib/palette.ts`): 폴더 수백 장이면 느림. 동시성 제한 병렬(`src/lib/pool.ts`
  `runPool` 재사용) + 진행 표시. 결과 순서는 입력 순서 유지(팔레트 인덱스 안정성).

### C. 정리 / 보안

**C1. 문서 정리**: 루트 md 5개 → "현행 계약 요약 1개 + `docs/archive/` 이력"으로. README의 깨진 링크와
  옛 실행 경로 수정.

**C2. 무인증 API**: `/api/images`, `/api/resources`, `/api/resolve`는 인증 없이 서버의 MCP 토큰으로 동작.
  배포 URL을 아는 누구나 그룹 자산을 조회할 수 있다. 의도된 설계(읽기 무인증)이지만 공개 배포라면
  시크릿 요구 또는 rate limit 검토 필요 — **정책 결정이라 사용자 확인 후 진행.**

## 8. 다음 세션 시작 순서 (권장)

1. `npm install && npm run typecheck && npm run lint && npm run test`로 기준선 재확인.
2. A1 → A2 → A3 → A4 순으로 하나씩: 수정 + 테스트 추가 → 3종 검증 → 커밋(관례대로 `fix(editor): ...`).
3. 브라우저(`npm run dev`)에서 실제 동작 확인: 엔티티 배치·방향키 이동·⌘Z, Export 경고창.
4. B1, C1은 사용자와 범위 합의 후.
