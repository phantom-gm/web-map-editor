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
