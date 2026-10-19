# 아스트라 전달용 리뷰 — 게임 동기화 기능 (df7b377 … 703b186)

- 작성: Claude 세션, 2026-10-06. 대상: 2026-10-03~06 커밋 10개(게임 맵 열기 · 네이티브 오브젝트/NPC/런타임 편집 · 비교 · 후보 출력/검토/ZIP · 4열 팔레트 · 가구 정렬).
- 방법: 소스 통독(리뷰 에이전트 4개 분담 + 교차 확인) · 게임 repo `C:/Trunk/legend_of_light` 와 계약 대조(읽기만) · 실제 컴파일러와 왕복 실험(스크래치 폴더) · 브라우저 실측(velos · ferenforest2 · noxtemple — 저장된 작업이 없던 맵만 사용. 그 세 맵의 `.game-sync/workspaces·baselines·candidates` 는 이 리뷰가 만든 것이니 지워도 됨).
- 레포 파일은 수정하지 않았다(이 문서 추가뿐). 게임 폴더도 건드리지 않았다.

## 0. 검증 결과 한눈에

| 검사 | 결과 |
|---|---|
| `tsc --noEmit` | 통과 |
| `eslint .` | **실패 2건** (§1) |
| `vitest run` | 45 파일 538 통과 · 3 파일 37 skip(통합, `MSW_GAME_SYNC_TEST_ROOT` 미설정) |
| `npm run test:game-sync` | 88/88 통과 (29s) |
| 스크래치 프로브 | 실제 컴파일러 왕복(이동 역변환 5000건 잔차 ≤5.8e-9, 비교 from/to 비트 일치) · 스토어 프로브 10건 — 통과 |
| 브라우저 실측 | 맵 열기/이어 열기 · 오브젝트/몬스터/NPC 한 칸 이동 + Ctrl+Z · 바닥 1칸 수정 → 4×4 블록 재구성(직접 1 · 재구성 15) · 원본과 비교 · 무변경 후보(바이트 동일) · 몬스터 이동 후보(`DT_MonsterSpawn.csv` 한 줄 diff, BOM/CRLF/끝 개행 보존) · 후보 검토 · ZIP(map + REVIEW.txt 2개, stored) — **모두 정상, 콘솔 에러 0** |

통합 테스트 37건은 내 세션 권한 제한으로 못 돌렸다. 아스트라 쪽에서 한 번 돌려 달라:

```powershell
$env:MSW_GAME_SYNC_TEST_ROOT = "C:/Trunk/legend_of_light"
npm run test -- src/__tests__/gameSyncIntegration.test.ts src/__tests__/gameRuntimeIntegration.test.ts src/__tests__/gameNpcIntegration.test.ts
```

## 1. 즉시 — CI 게이트가 깨져 있다

`npm run lint` 실패:

- `scripts/game-sync/object-edits.cjs:194` — `'sr' is assigned a value but never used`
- `src/lib/objectSorting.cjs:36` — `'module' is not defined (no-undef)`. 원인은 `eslint.config.mjs` 의 Node globals 대상이 `scripts/**/*.{js,mjs,cjs}` 뿐이고 `src/**/*.cjs` 가 빠져 있어서다. `src/lib/*.cjs` 를 그 목록에 넣거나 파일을 `.ts` 로 옮기면 된다.

## 2. 높음

### 2-1. 후보를 게임에 적용한 뒤 다시 가져오면 이동불가·몬스터·포털·시작점 편집이 영구히 막힌다 — 확인됨(사용자 실데이터 재현)

- `scripts/game-sync/core.cjs:176-187` `projectDefaults`, `:287-315` `createSyncProject` — 기준(baseline)의 `blocked` 를 게임의 **`map/<name>.json`**(에디터 구 export)에서 가져온다. 그런데 후보 적용 파일은 `.map` + CSV 뿐이라(`:908 applyFiles`) json 은 갱신되지 않는다.
- `scripts/game-sync/walk-edits.cjs:61-67` `analyzeWalk` 는 `blocked == DT_Walk 현재맵 행` 을 요구하고, `core.cjs:548`(refreshRuntime)·`:627`(inspect)은 DT_Walk 현재맵 셀 ≠ `baseline.blocked` 면 `STALE_RUNTIME_WALK` 로 실패한다.
- 재현(실데이터): ferendelmotel 에서 이동불가 16칸 후보(10-06 03:27Z)를 ZIP 으로 받아 게임에 적용 → DT_Walk 는 60행, `map/ferendelmotel.json` 은 44칸 그대로. 현재 그 워크스페이스는 `STALE_SOURCE: map/ferendelmotel.map`("다시 동기화하세요"). 스크래치 baselineRoot 로 `createSyncProject('ferendelmotel')` → `project.blocked=44`, `walkEditingSupported=false`("게임 DT_Walk와 기준 이동불가 셀이 달라…"), 빈 칸 하나 추가 → `UNSUPPORTED_WALK`, 시작점 이동 → `STALE_RUNTIME_WALK`, `refreshRuntimeProject` → `STALE_RUNTIME_WALK`. 에디터는 44칸을 그리고 게임은 60칸이다. 안내대로 재동기화해도 json 이 44칸이라 **빠져나올 길이 없다.**
- 같은 구조로, `convert_map.cjs:487-497` 이 `blocks:true` 오브젝트 footprint 도 DT_Walk 에 병합하므로 그런 맵은 처음부터 이 상태가 된다(지금 맵들엔 0개라 안 보였을 뿐).
- 부수: 후보가 json 을 안 바꾸니 게임 쪽에서 `nocode_map --build` 를 다시 돌리면 적용분이 되돌아간다. 실제로 게임 repo 에 13:28 `map/ferendelshop.json` 수정 → 13:31 `.map` 재빌드 흔적이 있다(README:188 은 Export 버튼 숨김만 언급).
- 방향: 기준 `blocked` 를 DT_Walk 현재맵 행에서 파생하거나(파싱 가능할 때), 갱신된 `map/<name>.json` 을 apply 파일에 포함해 json·DT_Walk·.map 셋을 같이 움직이게 할 것.

### 2-2. 리소스 lock 호환 판정이 "무관한 리소스 하나 삭제" 에도 모든 기준을 거부 — 확인됨(실데이터)

- `core.cjs:209-230` `compatibleInventory`(`:225` 옛 레코드 하나라도 변경/삭제면 false) + `:243-250`. lock 은 `dump_group_ruids.cjs --lock` 전량 재열거라 스토리지에서 맵과 무관한 리소스 하나만 지워져도 전부 `STALE_SOURCE` 다.
- 실데이터: **ferendel 워크스페이스(e9b27d7d)가 지금 이 상태다** — inspect/preview → `STALE_SOURCE: scripts/storage-inventory.lock.json`. 진단: metadata 동일, 타일 카탈로그 동일(180=180), 이름 재사용 0, 옛 레코드 61건 삭제(아이콘_눈쿠폰_… 등)·220건 추가. 결과: 미리보기·출력·후보 검토·ZIP(`reviewCandidate:1213 verifySources`) 전부 막히고, 유일한 탈출구인 재가져오기는 초안을 history 로 밀어낸다(복원 UI 없음). `core.test.cjs` 의 "resource … removals … still block" 이 이 동작을 고정하고 있다.
- 방향: 참조되는 레코드(카탈로그·맵/팔레트 RUID)만 불변을 요구하고 나머지 변동은 경고로.

### 2-3. 휠 줌·창 포커스 이탈이 그리는 중인 스트로크를 통째로 되돌린다 — 확인됨(코드), 기준선 대비 회귀

- `src/components/CanvasGrid.tsx:875-883` `onWheel` 이 무조건 `cancelGesture()` → 기본 `rollback=true` → `:657-667` `rollbackEditorStroke(before)`. `:743` `window blur` 도 동일. 기준선(c09697e) 의 onWheel 은 `zoomAt` 만 했다.
- 재현: 브러시로 50칸 드래그 중(버튼 누른 채) 휠로 줌 → 그때까지 칠한 50칸이 전부 사라지고(커밋 전이라 undo 로도 복구 불가) 이후 드래그는 무시됨. moveEntity 드래그 중 휠 → 원위치로 튕김. 스페이스/휠클릭 팬 중 휠 → 팬 종료. Alt+Tab 중 스트로크도 동일.
- 방향: 휠은 카메라만 바꾸고 제스처는 유지(기준선 동작). 네이티브 드래그(runtimeDrag/npcDrag/nativeDrag)는 카메라가 바뀌어도 world 좌표 기준이라 유지 가능하고, 꼭 끊어야 하면 `cancelGesture(false)` 로 롤백 없이 끊을 것.

### 2-4. 가구 정렬(703b186)이 json 기반 원본 오브젝트의 깊이 메타를 바꿔 게임 빌드 게이트 `depth_check (1)` 를 깨뜨린다 — 확인됨(양쪽 코드 대조, 미실행)

- 에디터: `scripts/game-sync/object-edits.cjs:192-206` 이 정렬 역할마다 `IsoDepthMetaComponent` 를 다시 쓴다 — floor → `W/H = size`, `SortPadX = padX`; wall → `W:1,H:1`, `OrderInLayer/StaticOrder = -998`; surface → `Position.z = 받침 z − 0.0001`(`src/lib/objectSorting.cjs:36`).
- 게임: `scripts/depth_check.cjs:796-827` 은 `.map` 의 `Obj_<id8>` 를 `map/<맵>.json` 엔티티(`loadSourceDims` :188-203)와 맞춰 `W/H == round(depthW/H)`, `SortPadX == json sortPadX`, `pos.z == objectDepthZ(pos.y, sortOffset) ±1e-6` 을 요구하고 하나라도 어긋나면 `dimDrift` → exit 1. 동기화 파이프라인은 json 을 갱신하지 않으므로 json 기반 원본에 역할을 주면 구조적으로 어긋난다(2-1 과 같은 뿌리).
- 재현: ferendelshop 열기 → 원본 판매대 `Obj_2172f2cd`(json depth 1×4) 선택 → "벽 장식"(W/H 1×1) 또는 "가구 위 소품"(z 변경) 또는 바닥 가구에서 칸 수 변경 → 후보 출력은 성공(후보 파이프라인은 depth_check 를 돌리지 않음, `core.cjs` 에 참조 없음) → 게임에서 depth_check 실행 시 "차원드리프트" 로 빌드 중단. `Obj_Editor_<uuid>`(복제·서버 소재)는 정규식 `/Obj_([0-9a-f]{8})/` 에 안 걸려 영향 없음 — 사용자가 이미 적용한 `map/ferendelshop.map` 의 `-998` 두 개는 전부 `Obj_Editor_*` 라 지금은 통과한다.
- 부가: `-998` 은 게임 어디에도 정의가 없다(`build_map.cjs:96-99` 는 −1000/−999/0/4000 만, .mlua/.md/.cjs grep 0건). MSW 규칙(SortingLayer→OrderInLayer→Z)상 "모든 order-0 스프라이트 뒤" 가 되므로 벽이 −999(below)인 실내 맵에서만 "벽 앞·캐릭터 뒤" 문구가 맞고, 벽이 order-0 오브젝트인 맵에서는 장식이 벽 뒤로 숨는다 [낮음·의심].
- 방향: 후보 출력 단계에서 게임 `depth_check.cjs` 를 같이 돌려 결과를 report 에 넣거나(이미 `actor-depth.cjs` 가 그 모듈을 require 한다), 정렬 역할을 `map/<맵>.json` 의 depthW/H·sortPadX·sortOffset 으로도 써 주는 경로를 만들 것. `-998` 은 게임 쪽에 상수로 합의.

## 3. 중간

### 3-1. 게임 동기화 API 가 `next dev --hostname` 없이는 항상 403 — 확인됨(Next 소스 추적)

- `src/server/gameSync.ts:13-18` 이 `new URL(req.url).hostname` 을 본다. Next 14.2.35 는 `-H` 가 없으면 `initURL = req.url`(상대)이고(`next-server.js:1162`), 어댑터가 상대 URL 을 `http://n` 기준으로 만들어(`next-request.js:89`) `hostname === "n"` → "게임 동기화는 이 PC의 로컬 에디터에서만…" 403.
- 지금 되는 이유: 떠 있는 서버(PID 31476)가 Codex 런타임에서 `next dev --hostname 127.0.0.1 --port 3000` 으로 시작됐기 때문. `.claude/launch.json` 과 README 상단의 `npm run dev` 만으로는 안 된다. `gameSyncAccess.test.ts` 는 절대 URL `Request` 를 직접 만들어 이 경로를 안 탄다.
- 방향: 이미 검사하는 `host` 헤더만으로 판정하고 `url.hostname` 의존을 빼거나, `package.json` dev 스크립트에 `-H 127.0.0.1` 을 넣을 것(둘 다 권장).

### 3-2. 미리보기 재로딩 중 브러시 클릭에 엉뚱한 안내가 뜨고 스트로크가 버려진다 — 확인됨(코드)

- `src/lib/editorCommands.ts:61-70` `palettePlacementIssue("brush")`: `view.status !== "ready"` 면 `groundBrushRuids` 경로를 건너뛰고 `isServerResourceImage(tile)` 로 떨어진다 → 저장본에서 온 타일(`tilesFromStored` 는 `markServerResourceImage` 를 안 부름; ferendel 저장본 팔레트 185개 전부)은 **"새 배치 전에 서버 이미지 확인이 필요합니다. 왼쪽 팔레트에서 소재를 다시 선택하세요"** 가 뜬다. 실제 원인은 "재컴파일 중". `CanvasGrid.tsx:913-918` 은 issue 가 있으면 return, 없어도 `linkedGroundReady` 로 return.
- 재현: 게임 맵 → B → 한 번 칠하기(`groundVer` 변경 → `useGamePreview.ts:107` 즉시 `status:"loading"`, 250ms 디바운스 + 서버 왕복) → 곧바로 다음 스트로크 → (저장본 타일) 잘못된 안내 + 무시 / (이 세션에서 고른 타일) 소리 없이 무시. 매 스트로크마다 반복되고 그 동안 `Toolbar.tsx:81` canPaint·팔레트 타일 전부 disabled 로 깜빡인다. 연속 칠하기가 사실상 안 된다.
- 방향: 바닥 칠하기는 로컬 `ground` 만 바꾸는 작업이니 재컴파일 중에도 허용하고(서버 검증은 export 때), 안내 문구는 원인별로 분리.

### 3-3. 자동 저장마다 열려 있는 리소스 찾기 창이 리마운트되고 진행 중 선택이 거부된다 — 확인됨(코드)

- `src/components/PalettePanel.tsx:147` `<ResourceBrowser key={resetNonce}>`, `TopBar.tsx:96` `<FileMenu key={resetNonce}>`; 저장 성공 → `gameWorkspace.ts:82-83 markSaved()` → `editorStore.ts:394` `resetNonce+1`(원 의미는 dirty 기준점); `useWorkspaceAutosave.ts:17` 이 dirty 1초 뒤 자동 실행. `ResourceBrowser.tsx:88/96/109` 의 identity 검사도 `resetNonce` 를 포함해 "편집 중인 맵이 바뀌었습니다" 를 던지고, `PalettePanel.tsx:48,63` `chooseTile` 은 불일치 시 **조용히 return** 한다.
- 재현: 연결 맵에서 셀 하나 칠함 → 1초 안에 (a) 아직 서버 확인 안 된 팔레트 타일(새로고침 후 IndexedDB 복원분) 클릭 → 이미지 fetch 중 자동저장 완료 → `chooseTile` 이 return → 도구는 cursor 로 바뀐 채 타일 선택 안 됨, 오류 표시 없음; (b) "＋ 서버 소재 추가" 열고 검색·선택 중 → 자동저장 완료 → 창 리마운트(목록 재요청, 검색어/선택 소실), `register-object-resources` 응답 대기 중이면 서버는 등록했는데 클라이언트는 id 를 버리고 오류 표시. 같은 key 의 `FileMenu` 도 닫힌다.
- 방향: 저장은 프로젝트 정체성을 바꾸지 않으니 identity/key 에서 `resetNonce` 를 빼고 `mapName+baselineId` 만 쓸 것(새로 만들기/열기는 그 둘이 바뀐다).

### 3-4. 편집 표시를 꺼도 몬스터·포털·시작점 배지 자리에 보이지 않는 클릭 영역이 남아 아래 NPC·건물 클릭을 가로챈다 — 확인됨(코드)

- `src/lib/gameRuntimePreview.ts:25-31` `gameRuntimeHit` 은 `entries(scene)` 전부(비활성 포함)에 대해 발 위 10px 반경 12px 원을 **먼저** 검사한다. 그런데 `:46-50` `drawGameRuntime` 은 `labels || isSelected` 일 때만 배지를 그린다(`CanvasGrid.tsx:1276` `labels = showOverlays || runtimePanel !== null`). `CanvasGrid.tsx:937-951` 은 커서 도구에서 항상 이 판정을 NPC/오브젝트보다 먼저 호출.
- 재현: 편집 표시 OFF·런타임 패널 닫힘에서 비활성 포털 셀 근처(또는 몬스터 발 근처 투명 픽셀)를 클릭 → 아무것도 안 보이는데 런타임 패널이 열리고 그 항목이 선택되며 그 아래 NPC/건물은 선택되지 않는다.
- 방향: 배지 히트는 배지를 실제로 그릴 때만(`labels || isSelected`) 검사.

### 3-5. Shift/Ctrl 을 누른 채 드래그하면 키 자동반복이 범위선택·네이티브 드래그를 취소 — 유력(Windows)

- `CanvasGrid.tsx:775` keydown 이 `gameSync && (runtimeDrag||npcDrag||nativeDrag||selectionStart)` 면 **어떤 키든** `cancelGesture()`. `e.repeat` 가드가 없다(파일에 `.repeat` 0건).
- 재현: 건물·장식 → Shift 누른 채 빈 곳 마키 드래그를 0.5초 이상 → Windows 는 보조키도 자동반복 keydown 을 내므로 `selectionStart` 가 비워지고 `mode=null` → 점선 상자가 사라지고 mouseup 때 아무것도 선택되지 않는다. README 의 "Shift+빈 곳 드래그" 가 긴 드래그에서 깨진다('여러 개 선택' 토글로 우회 가능).
- 방향: `if (e.repeat) return;` 과 보조키(Shift/Control/Alt/Meta) 제외.

### 3-6. 연결 모드에서 마우스를 움직일 때마다 게임 씬 전체를 재정렬·재그리기 — 확인됨(코드), 체감은 맵 크기 의존

- `CanvasGrid.tsx:1128` 모든 mousemove 에서 `setHover([gx,gy])`(항상 새 배열) → draw effect 의존성 `:1312 hover` → `draw()` → `:319 drawGamePreview` → `src/lib/gamePreview.ts:205` 가 매 프레임 `sortPreviewSprites`(복사+정렬) + 전 스프라이트 geometry 계산 후 컬링. 기본값 `showOverlays:false` 라 hover 다이아는 그리지도 않는다 → 시각 변화 0 인 재그리기. 팔레트 위에서 움직여도 동일.
- 방향: hover 가 같은 셀이면 setHover 생략, 정렬 결과를 `(scene, 편집 버전)` 키로 memo, 씬 레이어와 오버레이 레이어 분리.

### 3-7. 몬스터 종류 드롭다운이 이름만 보여 같은 이름의 다른 클래스를 구분 못 한다 — 확인됨(브라우저)

- `src/components/GameRuntimePanel.tsx:109` 인스펙터 `<select>` 가 `{c.name}` 만 출력. `DT_MonsterClass` 에는 106000/906000 "숲고블린", 109000/909000 "이끼돌골렘" 처럼 동명 ID 가 있어 목록에 "잎새슬라임 … 정예고블린마법사" 가 두 번씩 뜬다. 추가 목록(`:78`)은 "종류 ID" 를 같이 보여주므로 인스펙터만 맞추면 된다(`npcClassLabel` 의 "1002 — 거미" 형식).

### 3-8. 후보 폴더 `reference/` 에 DataSet 전체를 복사하면서 `config/DT_ServerSecret.csv` 까지 복제 — 확인됨(파일 확인)

- `core.cjs:893-894` 가 `references.captured` 전부를 `reference/` 로 쓴다 → 후보 33개 × 95 CSV(109MB) 에 서버 시크릿이 33벌. `.game-sync/qa-artifacts/` 에도 있다. ZIP 에는 안 들어가는 것은 확인했다(2 entries). `.gitignore` 되어 있긴 하지만 후보 폴더를 통째로 공유·백업하면 같이 나간다.
- 방향: 후보 검증에 실제로 쓰는 CSV(DT_Walk·DT_NpcSpawn·DT_MonsterSpawn·DT_Portal·DT_Bounds·클래스/외형/이름 표)만 복사하거나, 최소한 `config/` 는 해시만 기록.

## 4. 낮음

### 동기화 스크립트 (scripts/game-sync)
- **F3** `core.cjs:101` MapBuilder 사본 탐색 순서 `['.agents/skills','.claude/skills','.codex/skills']` 가 게임 `scripts/skill-paths.cjs` 의 `['.claude/skills','.agents/skills','.codex/skills']`(build_map.cjs:194) 와 반대. 이 PC 엔 둘 다 있고 내용이 다르다(`.agents` 9/6 · `.claude` 9/26, 차이는 `DEFAULT_SPRITE_RUID` — `.claude` 주석이 구 RUID 는 죽은 리소스라고 명시). 에디터는 늘 `ruid` 를 넘겨 지금은 무해하나 게임 정본과 다른 사본으로 컴파일·검증한다. `core.test.cjs:83-91`·`gameSyncWorkflow.test.ts:24` 도 `.agents` 하드코딩.
- **F4** CRLF `.map` 은 편집 시 전체가 LF 로 재작성 — builder `write()` 가 `JSON.stringify(...,null,2)+'\n'`. ferendelmotel/ferendelshop/ferenforest2(LF)는 바이트 동일하지만 **ferendel.map(3.4MB, CRLF 110,454줄)·ironhallmine.map** 은 바닥/오브젝트 편집 후보(`core.cjs:885`)가 전 줄 diff 가 된다(무변경 분기 `:878` 은 바이트 복사라 안전). 원본 줄끝을 감지해 보존할 것.
- **F6** 자유 텍스트 CSV 한 줄이 기능 전체를 끈다 — `runtime.cjs:41`(ST_MonsterName)·`:49`(DT_GameConfig)·`npcs.cjs:75`(ST_NpcName)를 엄격 파서(`npcs.cjs:33` 열 수 불일치 → fail)로 feature try 안에서 읽어, `Note/#Desc` 에 따옴표 없는 쉼표 한 행이면 `portals:false / monsters:false / NPC supported=false`. 메시지는 전부 "NPC CSV 행의 열 수가 헤더와 다릅니다."(런타임 표인데 NPC 로 표기). 표시용 조회는 best-effort 로.
- **F7** 동명 CSV 가 DataSet 어디든 2개면 `readNpcFiles`(`core.cjs:427-440`)/`readRuntimeFiles`(`:497-510`) 가 `AMBIGUOUS_*_SOURCE` hard fail 이고 `inspectLoadedProject:622/625` 가 무조건 호출해 바닥만 편집해도 preview/export 불가(DT_Walk 쪽 `:618-619` 는 graceful). 생성 시 경고 없음.
- **F8** 맵 이름 정체성 — `core.cjs:178` `p.map = raw.map || mapName`(json 값 우선) vs API 는 파일명으로 `readWorkspace`(`gameSync.ts:98`), 저장은 `project.map`(`gameWorkspace.ts:82`). 불일치면 매 열기마다 새 baseline, Windows 에선 `gameWorkspace.ts:72` 로 열기 불가. `testmap2.json` 이 `map:"newmap"`(단 .map 없음).
- **F9** 자원 누적 — 자동저장(1초)마다 전체 사본을 history 에 보관(ferendelmotel 110개/8.4MB), import 마다 새 baseline(19개/90MB, 각 95 CSV), 후보마다 `reference/` 전체(33개/109MB). 정리 없음. `refreshNpc/RuntimeProject`(`core.cjs:489-492, 553-556`)는 폴더를 쓴 뒤 `*_SOURCE_CHANGED` 를 검사해 실패 시 고아 `npc-/runtime-<id>` 폴더가 남는다.
- **F10** `core.cjs:1001-1006` `listCandidates` 가 `startsWith(mapFileName+'-')` → `town` 목록에 `town-east-<uuid>` 가 `skipped` 로 집계. 7차 이전 후보(createdAt·review-manifest 없음)는 전부 skipped — ferendel 은 "0건 표시/5건 건너뜀"(설계상이지만 혼동).
- 테스트 공백: `core.test.cjs:82-85`·`gameSyncWorkflow.test.ts:24-26` 은 하드코딩 경로/env 가 없으면 조용히 스킵(다른 PC/CI 에선 8건만 실행). 2-1(적용→재가져오기)·2-2(lock 삭제)·3-1(Next URL 파생)을 잠그는 테스트 없음.

### 미리보기·선택 라이브러리 (src/lib/game*)
- `gameNpcPreview.ts:107-112`, `gameRuntimePreview.ts` 드래그 초안이 서버의 깊이 보정 z(`actor-depth.cjs`)를 버리고 `position[2]+Δy×DEPTH_SCALE` 로 다시 쓴다 → 드래그 중에만 건물 앞뒤 가림이 바뀌어 보임(놓으면 복귀). 실측 ferendelshop 바르몬 z 2.216→2.24, ferendelmotel 엘드릭 3.22→3.08.
- `gameObjects.ts:123-133` `removeGameObjectEdit(edits, supportId)` 가 `row.entityId` 만 걸러 `setting.supportId===removed` 인 surface 행을 남긴다 → `parseGameObjectEdits`(`:83`)가 거부하는 overlay. 지금은 호출부 2곳(`editorStore.removeGameObject` 1032행, `planGameSelectionTransform` 164행)이 먼저 막지만, 이 함수만 부르는 새 경로가 생기면 자동저장(`exportProject`)·`loadProject` 가 throw 하는 상태가 된다.
- `gameComparison.ts:170-177` 오브젝트 diff 는 scene 과 교차 검증하지 않는다(npc/monster/portal 은 from/to·id 존재까지 검사). 틀린 `to` 나 없는 id 가 와도 통과하고 `outlineObject` 는 조용히 아무것도 안 그린다.
- `gameSelection.ts:79` 정렬 설정 비교가 `JSON.stringify` 키 순서에 의존 — 서버가 `canonical()` 처럼 키를 정렬해 에코하면 정렬 편집된 오브젝트 전부가 영구 "미리보기 갱신" 오류가 된다.
- 테스트 공백: `useGamePreview.ts`(디바운스·abort·baseline 캐시 무효화) 와 `loadSceneImages` 를 잠그는 테스트 없음(`grep useGamePreview src/__tests__` 0건). `gameSelection.test.ts` 의 `sceneFor()` 는 클라이언트 z 식을 베껴 서버를 흉내내는 거울 테스트라 서버 식이 바뀌어도 못 잡는다(지금은 실제 컴파일러와 일치함을 왕복 실험으로 확인).

### UI 컴포넌트
- `CanvasGrid.tsx:926/955/980` 미리보기가 ready 가 아니거나 '게임 배치 보기' 가 꺼지면 커서 좌드래그 팬·클릭 선택이 소리 없이 무시(`:1019` 빈 곳 팬에 도달 못 함). Space/휠클릭 팬만 된다.
- `CanvasGrid.tsx:1005` '여러 개 선택' 켠 상태에서 이미 선택된 오브젝트 재클릭이 해제되지 않음(토글 조건 `(modifier || !selected)`, `:1187` 겹침 순환도 비활성). README "보조 키 없이 클릭으로 선택을 바꿀 수 있습니다" 와 다름(목록 쪽은 토글됨).
- `CanvasGrid.tsx:767-769` Esc 가 선택 해제에 더해 `activateEditorTool("cursor")` → `editorCommands.ts:17 setMultiSelect(false)` 로 '여러 개 선택' 모드까지 끔. 도움말은 "Esc: 선택 해제" 만 안내.
- `PalettePanel.tsx:65-70` 타일 선택의 늦은 응답이 재로딩 중 도착하면 `view.status!=="ready"` 로 조용히 버려짐(busy 만 풀리고 선택·도구 변경·에러 없음).
- `CanvasGrid.tsx:1284` 선택 id 마다 `drawGameObjectSelection`(`gameObjectPreview.ts:87` `scene.sprites.find`) — 마키로 수백 개 선택 후 마우스 이동 시 체감.
- 문구/사소: `TopBar.tsx:105` 세로 NumberField 만 `disabled={loading}` 누락 · `TopBar.tsx:81` alert 가 존재하지 않는 "'RUID 매핑 불러오기'" 버튼 안내(실제: 기존 프로젝트 연결 도구 → "RUID 연결 파일 읽기") · `FileMenu.tsx:68` 새 프로젝트 confirm "칠한 셀·이동불가 초기화" 인데 실제로는 엔티티·맵 이름/크기·게임 연결도 초기화 · `App.tsx:28` 연결 맵 팔레트도 IndexedDB 영속 팔레트로 저장돼 이후 새 일반 프로젝트에 게임 소재 목록이 복원됨(hydrate 쪽만 gameSync 가드) · `GameObjectPanel.tsx:56` 리소스 브라우저를 취소로 닫아도 '소재 골라 배치' 탭으로 전환 · README:94 "무변경이면 **원본 맵과 완전 일치** 표시" — 실제 화면은 "출력 준비 완료" 만 뜨고 그 문구는 검토 창 안에서만 보임 · 몬스터/포털 패널 하단 "원본 다시 읽기" 버튼과 설명이 붙어 "…다시 읽기세 배치 원본만…" 으로 읽힘(여백 없음).

### 스토어·자동저장·API (src/store, src/lib, app/api)
- `editorStore.ts:1081, 1106` 빈 스택 `undo/redo` 가 선택을 해제한다(기준선은 `return {}`) — 되돌릴 게 없는데 Ctrl+Z 한 번 더 누르면 묶음 선택이 사라짐(프로브로 확인). 회귀.
- `useWorkspaceAutosave.ts:16` 자동저장이 한 번 실패하면(`session.status === "error"`) 영구 중단 — status 는 수동 저장 성공/맵 다시 열기 때만 바뀜(`gameWorkspace.ts:93`). 409 충돌은 의도지만 dev 서버 재시작·일시 네트워크 오류 뒤의 편집은 계속 미저장(패널에 오류는 보임, beforeunload 경고는 남음).
- `editorStore.ts:90-104` `mergeProjectPalette` 가 라이브러리 전체를 뒤에 붙이고 `exportProject`(:1209)가 그대로 저장 → 열 때마다 저장본 팔레트가 누적(A 열고 B 열면 B 저장본 = `b1,a1,lib1,lib2`; 실데이터 ferendelmotel 엔티티 17 / 팔레트 210). 손상은 아님.
- 정렬 설정 연속 편집은 미리보기 갱신 전까지 거부 — 같은 scene 으로 두 번째 `sortGameObject` → "현재 편집과 미리보기 배치가 다릅니다". `ObjectSortingPanel` 의 NumberField 4개를 빠르게 연달아 커밋하면(250ms 디바운스 + 서버 컴파일 전) 두 번째부터 오류. 설계대로지만 UI 가 그걸 유도한다.
- `app/api/images/route.ts:36-37, 67-69` 클립/스프라이트 처리의 모든 예외(네트워크 타임아웃 포함)를 "animation-frame-unsupported" / "sprite-download-failed" 로 뭉갠다. `getGroupResourceMetadata` 는 RUID 를 소문자 키로 dedup 해 "ABC"/"abc" 동시 요청 시 한쪽이 resource-not-found.
- `/api/images` 응답 바이트 무제한(pre-existing, HANDOFF A4) — `fetchSpriteAssets` 는 100개 단위 청크(개수만)이고 서버는 원본 PNG base64 를 그대로 싣는다. Vercel 배포의 레거시 팔레트 복원(`imageResolver.ts:69`)은 한 청크가 4.5MB 를 넘으면 throw → catch 가 **나머지 청크 전부**를 스와치로 떨어뜨린다.
- pre-existing(HANDOFF A2): 방향키 `moveEntityTo`(`CanvasGrid.tsx:847`)·`autoFixSortOffsets` 여전히 undo 없음(일반 프로젝트). 연결 프로젝트는 `exportProject` 가 `exportEntities` 를 건너뛰어(`editorStore.ts:1213`) 레거시 엔티티 파생값이 저작값과 어긋난 채 저장되지만, 연결 모드에서는 레거시 엔티티 선택 경로가 막혀 있어(`CanvasGrid.tsx:978-1020`) 실질 도달 불가.
- 테스트 잠금 공백: 빈 스택 undo 선택 해제 · `useWorkspaceAutosave` 훅 자체 · resetNonce 정체성 · `/api/images` 의 MAX_RUIDS/502 경로는 어떤 테스트도 잠그지 않는다.

### 환경
- `data/npcclass.seed.json` 이 CRLF 로 커밋돼 있고 `predev` 가 매번 재생성해 `git status` 에 늘 수정으로 뜬다(내용 차이 0). `.gitattributes`(`*.json text eol=lf`) 또는 스크립트 줄끝 통일.

## 5. 설계·프로세스 위험 (버그는 아니지만 알아둘 것)

1. **`.map` 직접 편집 vs 게임의 `json → convert_map → build_map → .map` 파이프라인이 두 갈래.** 2-1 의 근본 원인이고, 후보 `.map` 을 적용한 맵에 게임 쪽 빌드를 다시 돌리면 편집이 사라진다. 어느 쪽이 정본인지(json 을 같이 갱신할지, build 를 `.map` 기준으로 바꿀지) 게임 쪽과 합의가 필요하다.
2. 게임 repo 작업 트리에 지금 미커밋 변경이 있다: `map/ferendelshop.{map,json}`, `DT_Walk.csv`(+9 ferendelshop), `DT_NpcSpawn.csv`(ferendelshop_N001 4,7→5,8), `AGENTS.md`, 미추적 `map/ferendel.synced.json`, `outputs/`. `.map`/CSV 는 후보 d5e4c2b5·6a47a193 와 해시가 같다(=적용분). 의도한 상태인지 확인.
3. `/api/game-sync`·`/candidate-download` 는 `middleware.ts:10` PROTECTED 에 없다(시크릿 없음). 루프백 바인딩 + Host/Origin + JSON content-type(preflight) 으로 CSRF·원격은 막히는 것을 확인했고 잔여 위험은 같은 PC 의 다른 프로세스뿐 — 로컬 전용이라 수용 가능하나 README 에 명시할 것.
4. (게임 쪽, 아스트라 아님) `legend_of_light/scripts/convert_map.cjs:233` 이 "web-map-editor 의 `gameContractParity.test.ts` 가 이 함수를 직접 불러 커밋된 맵으로 확인한다" 고 적고 있는데, 그 파일은 이 repo 에 존재한 적이 없다(`git log --all` 0건). 게임이 전제하는 양쪽 drift 산식 parity 가드가 실제로는 없다 — 만들거나 주석을 고칠 것.

## 6. 확인했으나 문제 없던 것 (중복 작업 방지용)

- 게임 계약 대조(읽기만): `build_map.cjs:633-657` export(TILE_W 2.56 / TILE_H 1.28 / ORIGIN 15,15 / DEPTH_SCALE 0.21875 / GROUND_ORDER −1000 / PPU 100)가 manifest.constants → `scene.constants` 로 그대로 전달되고 미리보기 모듈은 `iso.ts`(0.56/0.28)를 import 하지 않는다. 바닥 `Tile_<gx>_<gy>` · `z=y×DEPTH_SCALE` · `blockPos` 의 `(n−1)` 항(`retile_ground.cjs:121-123`) · MapBuilder API · `depth_check.cjs` export 시그니처 · DataSet 95개 CSV 헤더(BOM+CRLF) · lock 구조 — 전부 일치. `groundOrigin=[0,0]` 강제라 에디터 셀 == 네이티브 셀 == CSV CellX/Y.
- 이동 역변환: 클라 `translated()`(8자리 반올림) ↔ 서버 `moveTarget`(정수 칸 재유도, 허용 1e-7) 무작위 5000건 최대 잔차 5.8e-9. 실제 기준에서 move→duplicate→delete→정렬→지지대 이동→소품+지지대 복제(supportId 재매핑) 모두 서버 재컴파일 후 `currentGameObjects` 통과, 옛 scene 은 정확히 거부. 비교(NPC 이동·반전·삭제, 몬스터 이동·추가, 포털 방향·이동, 시작점, 오브젝트 이동·추가·삭제)의 from/to 가 scene 위치와 비트 단위 동일.
- 경로/쓰기 안전: `prospectiveRealPath/outsideGame/safeChild/candidateChild` 가 절대경로·`..`·정션·심볼릭링크 차단, 모든 쓰기는 `.game-sync/` 하위 + `wx`, 게임 폴더 쓰기 경로 없음. `saveWorkspace` 는 temp+rename+재검사. core I/O 동기라 프로세스 내 직렬화. Windows 경로·BOM·비-UTF-8 fail-closed 정상.
- ZIP(zip.cjs): 로컬/중앙/EOCD 오프셋·0x800 플래그·stored·CRC32 == `zlib.crc32`(50건), bsdtar/Python `testzip` 통과, 한글 경로 OK. 후보 참조 사본↔report↔review-manifest 삼중 해시 정합, ZIP 전후 이중 review.
- 훅/스토어: 조건부 훅 없음, 비동기 setState 는 generation/AbortController 가드, 리스너 cleanup, StrictMode 이중 마운트 견딤, 컴포넌트의 스토어 액션 호출 시그니처 일치(tsc). 새 팔레트는 원본 index 를 유지해 ground 참조와 일치. Delete 대상 select* 상호 배타. 입력 필드·dialog·IME 중 단축키 차단.
- 자동저장: 편집 → 1초 뒤 저장 → undo → 재저장까지 파일과 UI 가 일치(history 3단 확인). 스토어 `undo` 가 오브젝트·몬스터·NPC overlay 를 정확히 비운다.
- 스토어: undo/redo 스냅샷(`captureEditorSnapshot`:142-149)이 ground/blocked/entities/gameObjectEdits(resources·sorting 포함)/gameNpcEdits·gameNpcSync/런타임 4필드를 전부 보관하고 되돌릴 때 모든 버전 카운터를 올린다(프로브: 이동불가 묶음 이동→undo, 복제→undo→redo 통과). dirty 는 `App.tsx:27-43` 구독이 모든 Ver 변화로 올린다. 자동저장 경쟁(저장 중 편집·undo·큐 직렬화·generation 취소)은 `gameWorkspaceClient.test` 12건이 잠근다. Astra 커밋은 Claude 가 만든 `sortGate/southIntrusion/walkCells/exportDrift/entityExport/validate/entity.ts/palette.ts` 를 건드리지 않았다(diff 0).
- 프로젝트 파일: v2 유지, `toStoredTile` 불변, 워크스페이스 6개에 `data:image` 0건. 비연결 export 는 기준선과 바이트 동일(exportRoundTrip 통과), 옛 파일 로드 OK, 연결 프로젝트 export→load→export 멱등. 새 최상위 키는 convert_map 소비 대상이 아니다.
- `objectSorting.cjs` ↔ `entityGeom.gameDepthZ` 모순 없음: `objectAnchor` 는 `build_map cellToWorldForMap`(:181-187) 의 정확한 역함수; 셀당 Δz = 0.64×0.21875 = 0.14 = CELL_DEPTH, px→z 0.04×0.21875 = 0.00875 = 0.56/64; `SURFACE_EPSILON` 0.0001 은 런타임 `Z_EPSILON` 0.001 + `CLAMP_SPREAD_Z` 0.012(IsoProjectLogic:158) 안쪽; floor `bounds/0.64` 는 `SPRITE_BASE_TO_WORLD`(IsoProjectLogic:285)와 일치; 게이트 후보 필터 `W>1 or H>1`(IsoPlayerDepthLogic:523)로 wall/surface 1×1 은 게이트·가림물에서 빠진다.
- spriteMetadata: 캐시 키 `[CDN, ruid, version, modPath, md5]` 충돌 없음, 64MB 상한·pending dedup OK, 500개 상한은 클라이언트 100 청크로 안전.

## 7. 재현에 쓴 것

- 브라우저: `velos`(바닥만) · `ferenforest2`(오브젝트 67·몬스터 3·포털 6·이동불가 35) · `noxtemple`(NPC 1). 후보: `.game-sync/candidates/ferenforest2-{5a75aa11 무변경, 54f0b196 몬스터 이동, 959f1389 바닥 1칸}`.
- 스크래치(레포 밖): `C:\Users\User\AppData\Local\Temp\claude\D--web-map-editor\08b821f1-ebf7-4155-8e78-f778aa83921c\scratchpad\agent{1,2}\` — 실제 컴파일러 왕복 스크립트(`roundtrip*.cjs`), ferendelmotel 재가져오기 재현.
