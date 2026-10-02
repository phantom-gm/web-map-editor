# MSW 웹 맵 에디터 (MVP)

MSW 아이소 RPG용 맵 편집기. 아이소메트릭(2:1 다이아몬드) 그리드에 타일을 칠하고 **blueprint JSON**으로 export → 기존 빌드/런타임 파이프라인에 연결.

> 설계: [`../../docs/map/WEB_MAP_EDITOR_MVP_DESIGN.md`](../../docs/map/WEB_MAP_EDITOR_MVP_DESIGN.md)
> 파이프라인: [`../../docs/map/WEB_MAP_EDITOR_PIPELINE.md`](../../docs/map/WEB_MAP_EDITOR_PIPELINE.md)
> RUID 연동/백엔드: [`../../docs/map/WEB_MAP_EDITOR_RUID_LINKAGE.md`](../../docs/map/WEB_MAP_EDITOR_RUID_LINKAGE.md)
> Vercel 배포: [`../../docs/map/WEB_MAP_EDITOR_DEPLOY.md`](../../docs/map/WEB_MAP_EDITOR_DEPLOY.md)

## 스택 / 실행

**Next.js 14 (App Router) + React 18 + Zustand + Canvas 2D.** Vercel 배포 + RUID 백엔드(`/api`)를 위해
Vite SPA 에서 Next.js 로 마이그레이션(에디터 로직 `src/*` 는 그대로, 셸만 `app/`). 에디터는 `app/page.tsx`
의 `"use client"` 경계에서 `src/App` 트리를 렌더.

```bash
cd tools/web-map-editor
npm install
npm run dev      # http://localhost:3000
```

게임 저장소가 형제 폴더가 아니면 에디터 루트의 `.env.local`에 경로를 지정합니다.
`sync:npc`, `dev`, `build`가 이 경로에서 NPC·몬스터 카탈로그를 갱신합니다.

```dotenv
MSW_GAME_ROOT=C:/Trunk/legend_of_light
```

명시한 경로의 CSV가 누락되면 기존 seed를 보존하고 실패합니다.
경로를 설정하지 않은 배포 환경은 기존처럼 커밋된 seed를 사용합니다.

기타: `npm run build`(`next build`), `npm run start`, `npm run typecheck`, `npm run lint`, `npm run test`.
백엔드 `/api`(resolve/upload)는 RUID 연동 Phase B — 위 RUID_LINKAGE 문서 참조.

## 현재 구현 (M1 ~ M5 + RUID Phase A)

- Next.js (App Router) + React + TypeScript + Zustand + Canvas 2D
- **아이소메트릭(2:1 다이아몬드) 그리드** 렌더 + 호버 셀 + 뷰 맞춤(fit) + **뷰포트 컬링**(큰 맵에서도 부드럽게)
- **팔레트**: PNG 다중 업로드 → 썸네일 목록, 타일 선택 (import 시 PNG 없으면 색 스와치)
- **도구**: 브러시 · **사각채우기(rect, 드래그 미리보기)** · 지우개 · **이동불가(block)** · **스포이드(eyedropper)**
- **이동불가 표시**: `이동불가` 도구로 좌드래그 마킹(빨강 다이아몬드 오버레이) · 지우개로 해제.
  게임의 보행불가 셀(`TileAttributeTileMap`)에 매핑 → import/export 왕복 유지
- **undo/redo**: ⌘/Ctrl+Z · ⇧+Z (스트로크 단위, ground+이동불가 함께 스냅샷, 최대 100)
- **입력**: 좌클릭/드래그 = 도구 · 스페이스+드래그 또는 휠클릭 = 팬 · 휠 = 줌
- **경계 클램프**: 페인팅은 size 안으로만, export 시 size 밖 셀은 무시(`buildBlueprint`).
- **검증**: export 전 `validateMap`(빈 맵 · 경계 밖 셀 · 팔레트 범위 초과) → 문제 시 확인 다이얼로그.
- **1×1 오브젝트 정렬 바닥선**(2026-09-26, 게임 MS-26 미러): `offsetY` 가 커서 바닥선이 앞 칸(남쪽 이웃) 중심에 붙거나 넘으면
  캔버스 ▼ 배지(주황 경고 / 빨강 = 게임 빌드 게이트가 막음) + 인스펙터 경고(권장 11px 버튼) + 상태바 건수 + export 검증.
  오브젝트를 선택하면 **정렬 바닥선**과 앞 칸 중심(점선·점)이 그려진다. 같은 RUID 를 새로 놓으면 마지막 저작값이 기본으로 채워진다.
  상세: [`DEPTH_SORT.md`](DEPTH_SORT.md) §"1×1 오브젝트는 바닥선이 곧 순서다".
- **멀티셀 정렬 경계 `sortPadX`**(2026-09-28, 게임 AA-4): 인스펙터 숫자 입력(0 이상 · 0.5 단위) + 선택한 멀티셀 오브젝트의
  정렬 게이트 경계를 분홍 세로선으로(패딩 0 자리는 점선). 산식은 게임 `SortGateSpan` 미러. 상세: [`DEPTH_SORT.md`](DEPTH_SORT.md) §"멀티셀은 정렬 게이트".
- **저장 무손실 · 손수정 확인**(2026-09-28): 무변경 저장은 게임 json 을 한 글자도 바꾸지 않고(파생 필드 재계산·offset 정확 반올림),
  게임 쪽이 json 파생 필드를 직접 고친 값이 저장으로 되돌아가게 되면 저장 전에 확인받는다. 상세: 같은 문서 §"저장이 게임 값을 조용히 바꾸지 않는다".
- **Import/Export**: 기존 `map_blueprint_<Map>.json` 왕복. Ground·이동불가(Attribute) 편집,
  Static 레이어와 origin/palette 는 **verbatim 보존** → round-trip diff 0 (vitest 게이트).
  Attribute 레이어는 이동불가 Set 에서 **재생성**되며 원본과 의미적으로 동일함을 테스트로 검증
- **RUID 등록 표시** (RUID 연동 Phase A): `RUID 매핑 불러오기` 로 `tile_registry.json`(콘텐츠해시) 로드
  → 팔레트 타일에 **✓등록 / ●신규 / ⚠conflict** 배지 + 카운트. 매칭 = **정확-이름 1차 + 해시 검증**
  (`src/lib/registry.ts`). `RUID export` 로 `palette_ruids_<Map>.json` 내보내면 `build_map.cjs` 가 소비.
  레지스트리 생성: `node scripts/build_tile_registry.cjs`(레포 루트, 로컬 `.sprite`→레지스트리, 업로드 0).
  설계: [`../../docs/map/WEB_MAP_EDITOR_RUID_LINKAGE.md`](../../docs/map/WEB_MAP_EDITOR_RUID_LINKAGE.md)

## 테스트 · lint

```bash
npm run test   # round-trip(map000000 import→export 의미 동일) + iso 엔진 미러 + 검증/경계 클램프
npm run lint   # ESLint(flat config) — typescript-eslint + react-hooks + react-refresh
```

## 로드맵 (설계 문서 §9)

- M1 ✅ 스캐폴드 + 아이소 그리드 + 팬/줌/호버
- M2 ✅ 팔레트 PNG 업로드 + brush/eraser 페인팅
- M3 ✅ blueprint import/export (round-trip 게이트 통과)
- M4 ✅ rect/스포이드/undo·redo
- M5 ✅ 경계 클램프 · export 검증 · 뷰포트 컬링 · ESLint · 이동불가 표시

## 좌표 규약

내부 셀 `(gx, gy)`. 편집뷰는 **아이소 다이아몬드**(`src/lib/grid.ts`, TW 64 / TH 32 px), 엔진 규약과 동일(X+1=SE, Y+1=SW, (0,0)=상단). 엔진 world-unit 정합 미러는 `src/lib/iso.ts`(TILE_W 0.56 / TILE_H 0.28 / ORIGIN 15) — round-trip 검증용.

## 게임 맵 작업·실제 배치 미리보기 (2차)

로컬 `MSW_GAME_ROOT`의 **현재 .map 파일**을 기준으로 편집을 시작합니다.
게임 폴더에는 쓰지 않습니다. 현재 4×4·2×2·1×1 배치, RUID, 위치, 배율, 엔티티를
그대로 보존하고, 바닥을 수정한 경우에만 그 칸과 겹치는 기존 블록을 재구성합니다.

1. `npm run dev -- --hostname 127.0.0.1 --port 3000` 실행 후 로컬 에디터에 접속합니다.
2. **게임 맵 → 맵 선택 → 맵 열기**. 저장된 작업이 있으면 이어 열고, 처음이면 실제 게임 배치를 가져옵니다.
3. 바닥 소재를 골라 수정합니다. 1초 뒤 **이 PC에 저장됨**을 확인하거나 **작업 저장 / Ctrl+S**를 누릅니다. 별도 synced 파일 선택은 필요 없습니다.
4. **후보 맵 굽기**를 누릅니다. 무변경이면 화면에 **원본 맵과 완전 일치**가 표시됩니다.
5. 결과는 `.game-sync/candidates/<map>-<id>/`에 있습니다:
   - `map/<map>.map`: 적용을 검토할 후보 맵 한 개.
   - `report.json`: 원본/후보 SHA-256, 블록 수, 변경/영향 칸, 보존 검증.
   - `editor-project.json`: 다시 편집할 프로젝트.
   - `reference/RootDesk/...`: 비교용 CSV 원본 사본. 게임 반영 파일이 아닙니다.

`.game-sync/baselines/<id>/`는 저장한 프로젝트가 참조하는 기준 스냅샷입니다.
작업은 `.game-sync/workspaces/<map>/project.json`, 이전 저장본은 같은 폴더의 `history/`에 보관합니다.
프로젝트를 계속 편집하려면 `.game-sync/` 전체를 보관하세요. 다른 PC로 옮길 때도 기준 폴더와
게임 checkout이 필요합니다. 기준은 원본 경로/해시를 검사하므로 PC 이동 시 새 동기화가 필요합니다.
`.game-sync/` 전체는 Git에서 제외됩니다.

**현재 편집 지원 범위는 바닥입니다.** 포탈·몬스터·오브젝트·이동불가·맵 크기는
실제 게임 원본을 보존하며, 프로젝트에서 이 항목들을 변경하면 후보 출력을 거절합니다.
표준 바닥을 해석할 수 없는 맵은 무변경 보존 출력만 지원합니다. 새 소재는 등록된
페른델 1×1 바닥을 사용하세요. 길 경계는 1×1 방향 타일을 유지합니다.

**게임 배치 보기**는 후보 출력과 같은 배치 계산을 사용합니다. 실제 .map의 4×4·2×2·1×1
Sprite, 좌표·배율·회전·반전·색·정렬과 원본 이미지 크기·피벗·PPU를 반영합니다.
좌표는 게임의 현재 build_map 상수(TILE_W=2.56, TILE_H=1.28)를 가져오며, 기존 iso.ts의
0.56/0.28 미러는 일반 프로젝트용으로 남깁니다. 이미지 조회는 RUID 직접 조회라
기존 4,000개 목록 한도로 빠지던 오래된 나무·건물도 표시합니다.

4×4 안의 한 칸을 수정하면 해당 블록의 무늬가 작은 타일 조합으로 달라질 수 있습니다.
미리보기에서도 그 재구성 결과를 보여주고, 영향 범위를 출력 결과에 표시합니다.
기본은 편집 장식이 없는 정적 맵 보기입니다. **편집 표시**로 격자·이동불가·스폰 위치
마커를 켤 수 있습니다. NPC·몬스터의 실제 애니메이션, 실행 중 생성되는 엔티티,
런타임 효과는 재현하지 않습니다. 미해석 이미지·지원 밖 변형은 경고로 표시합니다.

자동 저장은 원본 게임이 변경돼도 작업을 보관합니다. 미리보기·후보 출력은 원본 변경을
계속 검사합니다. **원본 연결·미리보기 안내 → 게임 원본 다시 가져오기**로 새 기준을
시작하면 이전 저장본은 history에 남습니다. 다른 창과 저장 버전이 충돌하면 덮어쓰지 않고
중단합니다. 파일 사본을 보관한 뒤 **저장본 다시 열기**로 이어갈 수 있습니다.
파일 메뉴의 사본 저장/열기는 수동 백업 및 이전 synced 프로젝트를 여는 용도입니다.

게임 맵·원본 프로젝트·리소스 목록·변환 기준이 동기화 이후 변경되면 후보 생성을 거절합니다.
기존 편집을 먼저 다른 이름으로 저장하고 최신 게임 맵을 다시 가져오세요.
오래된 프로젝트를 새 기준으로 자동 덮어맞추지 않습니다.
CSV 변경은 바닥 출력을 막지 않습니다. 출력 시점의 최신 CSV를 참고용으로 복사하고,
기준 이후 추가·수정·삭제 내역을 `report.json`에 기록합니다. 출력 도중 CSV가 바뀌면
다시 굽도록 안내합니다. 참고용 CSV는 게임에 적용하지 않습니다.
기존 blueprint Export / 게임 `nocode_map --build`는 이 동기화 계약을 소비하지 않으므로
연결 프로젝트에서는 이 Export 버튼을 숨깁니다. **후보 맵 굽기**를 사용하세요.

CLI (에디터 폴더에서 실행):

```powershell
npm run game:sync -- create --game-root "C:/Trunk/legend_of_light" --map ferendel --baseline-root ".game-sync/baselines"
npm run game:sync -- export --game-root "C:/Trunk/legend_of_light" --project "<저장한 synced.json>" --baseline-root ".game-sync/baselines" --output-root ".game-sync/candidates"
npm run test:game-sync
$env:MSW_GAME_SYNC_TEST_ROOT = "C:/Trunk/legend_of_light"
npm run test -- src/__tests__/gameSyncIntegration.test.ts
```

검증은 게임 밖 임시 폴더에서 수행합니다. 게임 반영, Maker Refresh/Play는 별도 단계이며
이 기능은 자동으로 실행하지 않습니다. 서버 API는 localhost 요청과 명시적인 게임 경로가
있는 로컬 실행에서만 활성화됩니다.
