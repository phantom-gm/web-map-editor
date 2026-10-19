# 맵에디터 ↔ 인게임 연동 코드 리뷰 (2026-10-19)

- 대상: 에디터 `D:/web-map-editor` (703b186..HEAD = 4a10169·27cfa3a·40f1fa7 + 미커밋 작업 트리) ↔ 게임 `C:/Trunk/legend_of_light` (10-06 이후 연동 커밋 cab287a88·86a13339a·PI-1·c97dfda2e·a8bc6b416). 게임 쪽은 오늘 11:24 커밋 a8bc6b416("벨로스 배치와 그린로드 상점 포탈 연결 반영")이 중간에 들어와, 그 직전 작업 트리를 본 탐색 결과는 검증 단계에서 HEAD 기준으로 보정했다.
- 방법: 7개 관점(export 파이프라인 / 런타임 소비 / 미리보기 정합 / 클라·서버·스토어 / 기준·락·적용 / 가림 마스크·pivot / 문서 계약)으로 병렬 탐색 → 발견마다 반박자(코드 추적·재현) + 계약 심판(게임 repo 대조) + 높음 이상은 영향 심판(실데이터 집계) → 완전성 비평 → 2차 탐색. 두 repo 모두 읽기 전용, 실행은 스크래치에서만.
- 집계: 1차 원시 63건 → 중복 제거 55건 → 검증 통과 42건 · 반박 13건(§9). 완전성 비평이 6개 공백을 지목해 2차 탐색 34건 → 검증 통과 30건(§6) · 반박 4건(§9). 중복을 합치면 **54항목**(높음 4 · 중간 19 · 낮음 31). 모든 발견은 반박자+계약 심판(높음은 영향 심판까지) 검증을 통과했다(§11).
- 선행 리뷰 `ASTRA_REVIEW_2026-10-06.md` 항목별 현재 상태는 §8.

> 표기: 심각도는 검증자 표의 중앙값. `[미커밋]` = 에디터 작업 트리에만 있는 코드. `editor:` / `game:` 은 어느 repo 인지. `[문서]` = 코드가 아니라 문서·주석 결함.

---

## 1. 한눈에 보기

| # | 심각도 | 위치 | 한 줄 |
|---|---|---|---|
| A1 | **높음** | editor:scripts/game-sync/object-edits.cjs:234 | 이미지 미세조정(visualOffsets)이 XY만 옮기고 z·StaticZ를 두어 게임의 `z = 그려지는 y` 계약을 깬다. json 원본이면 게임 depth_check (1)이 exit 1, Obj_Editor_*는 이미 24개가 게임에 적용된 채 정렬키≠그림 |
| A2 | **높음** | editor:scripts/game-sync/core.cjs:236 | 락파일의 부가 키 `verifiedAdditions`를 동일성 비교해 **지금 22개 중 21개 워크스페이스가 STALE_SOURCE**(a8bc6b416이 그 키를 1→3건으로 바꿈). 게임이 `--lock` 재생성하면 다시 반대로 뒤집히는 순환 |
| A3 | **높음** `[미커밋]` | editor:scripts/game-sync/core.cjs:341 · src/server/gameSync.ts:108 | '게임 원본 다시 가져오기'가 옛 기준 로드에 종속돼 기준 폴더 삭제·PC 이동·스냅샷 손상 시 재가져오기 자체가 실패(raw ENOENT 400). HEAD에는 없던 회귀 |
| B1 | 중간 | editor:scripts/game-sync/core.cjs:953 | depth 게이트가 정렬 편집에만 돌고, 카운터에 교차모순·★경계·occlStale이 빠지며, 후보 CSV 대신 게임 현재 DT_Portal/NpcSpawn을 읽는다. 'unchanged' 후보 16개를 재생하면 6개가 실패했어야 했고 그중 ferendel 포탈 건은 게임이 검사 실패 상태로 커밋 |
| B2 | 중간 | editor:scripts/game-sync/object-edits.cjs:43 | StaticZ ≠ Position.z 면 '보호'. 게임 표적 패치가 StaticZ를 안 올려 3개 맵 23개 오브젝트가 편집 불가 |
| B3 | 중간 | editor:src/lib/objectSorting.cjs:26 | sorting.bounds를 소재 메타와 대조하지 않아 px/100 값이 그대로 BaseW/BaseH로 구워짐 → 벨로스 관목 가림 후보 탈락, 검사 (6) 눈멂 |
| B4 | 중간 | editor:scripts/game-sync/object-edits.cjs:211 | '가구 위 소품'(surface) 연결이 .map에 남지 않아 게임 쪽 받침 z 표적 패치 때 소품이 떨어져 액터를 덮는다(f1f0db99b에서 실제 발생) |
| B5 | 중간 | editor:scripts/game-sync/object-edits.cjs:206 | 벽 장식 OrderInLayer −998은 게임에 정의가 없고 모든 order 0 뒤로 간다. 실데이터는 이 역할을 '바닥 데칼'로 쓰고 있음 |
| B6 | 중간 | editor:src/lib/useGamePreview.ts:32 | 클라 이미지 캐시가 version을 안 봐 리소스 제자리 갱신 뒤 낡은 그림·pivot. 그 pivot으로 계산한 bounds가 후보 .map에 구워지는 경로 있음 |
| B7 | 중간 `[문서]` | game:scripts/legacy-map-write-guard.cjs:9 · docs 6곳 | 후보 적용은 map/<name>.json을 안 갱신하는데 정본 문서들이 기존 맵에 `nocode_map --apply --build`를 지시하고 가드 메시지가 우회 플래그를 안내. 플래그로 재빌드하면 ferendelmotel 기준 Obj_Editor_* 34개·DT_Walk 16칸 소실 |
| B8 | 중간 `[문서]` | game:docs/map/WEB_MAP_EDITOR_EXPORT_CONTRACT.md:62 | 계약 §1 앵커 규약(앵커=북쪽 셀, 정렬행=gy+tilesH−1)이 build_map·에디터(앵커=앞-아래 tip, 북서 확장)와 반대. build_map.cjs:478 주석도 자기 코드와 반대 |
| B9 | 중간 `[문서]` | game:docs/map/isometric/guide.md:149 | "정적 오브젝트는 컴포넌트 없음 · z = pos.y"가 현재 build_map(IsoDepthMeta 부착 · z = objectDepthZ)과 다름. 자칭 정본이고 10-04 문서가 정본으로 인용 |
| B10 | 중간 | game:scripts/cover_mask_gen.cjs:727 | `--verify`가 pivot 기록 도입 뒤에도 (0.5,0) 가정으로 대조해 107행 중 46행을 ✗로 세고 exit 1 — 낡은 행(R-6) 검출 절차가 소음에 묻힘 |
| B11 | 중간 | game:scripts/cover_mask_gen.cjs:655 | AnimationClip RUID 가림물(벨로스 중앙광장 분수 5.44u)은 생성기가 행을 못 만들고 런타임은 후보로 뽑아 fail-closed → 페이드 없음, pivot 기록도 없어 검사 (9) 사각형이 2.72u 어긋남 |
| B12 | 중간 | game:scripts/depth_check.cjs:1029 | '후보인데 마스크 행 없음'을 막는 게이트가 없어 c97dfda2e가 고친 조용한 페이드 누락이 바로 다음 커밋에서 재발(velos 2 RUID·velosgreenroad 1) |
| C1 | 낮음 | editor:scripts/game-sync/core.cjs:371 | DT_Walk 기준 가져오기가 json size 밖 셀 하나에 INVALID_BLOCKED로 전체 실패(home 맵에서 실제 발생, UI 비노출) |
| C2 | 낮음 | editor:scripts/game-sync/core.cjs:964 | 맵 이름 대소문자: 게임 depth_check는 소문자 비교, 에디터는 그대로 전달 → TypeError 400 |
| C3 | 낮음 | editor:scripts/game-sync/core.cjs:1019 | export 실패 시 .map만 남은 후보 폴더 잔류(실데이터 11개/30MB) |
| C4 | 낮음 | editor:src/components/ObjectSortingPanel.tsx:33 | bounds 산식이 바닥 피벗 스프라이트의 BaseH를 px/64의 2배로 굽는다(게임 규약은 피벗 무관 px/64) |
| C5 | 낮음 | editor:scripts/game-sync/core.cjs:102 | MapBuilder 탐색 순서가 게임과 반대(.agents 우선). 이 PC의 .agents는 미추적 구판 |
| C6 | 낮음 | editor:src/__tests__/gameSyncIntegration.test.ts:908 | 옵트인 통합 테스트 38건 중 6건 실패 — 전부 낡은 기대값·게임 WIP 데이터 |
| C7 | 낮음 | editor:src/lib/gameNpcPreview.ts:11 · gameRuntimePreview.ts:12 | NPC·몬스터·포탈 드래그 초안이 깊이 보정 전 z를 쓰고, 드롭 직후 옛 칸으로 튄다 |
| C8 | 낮음 | editor:src/lib/gamePreview.ts:179 | 미지 SortingLayer가 하나라도 있으면 씬 전체를 파일 순서로 그린다(잠재) |
| C9 | 낮음 | editor:src/lib/gamePreview.ts:184 | z·order 완전 동률을 미리보기는 파일 순서로 확정, 게임은 임의 |
| C10 | 낮음 | editor:scripts/game-sync/core.cjs:878 | PortalSpriteRuid 빈 셀이면 게임은 폴백 마커를 그리지만 미리보기는 배지만 |
| C11 | 낮음 | editor:src/lib/useWorkspaceAutosave.ts:16 | [10-06 잔여] 자동저장 1회 실패 후 수동 저장류 동작 전까지 영구 중단 |
| C12 | 낮음 | editor:src/store/editorStore.ts:358 · scripts/game-sync/traps.cjs:29 | 함정 경계가 클라(DT_Bounds) / 서버(json size)로 달라 어긋나면 미리보기 error 상태 |
| C13 | 낮음 | editor:src/components/PalettePanel.tsx:117 | [10-06 3-2 잔여] 재컴파일 중 '＋ 서버 소재 추가' 비활성 |
| C14 | 낮음 | editor:src/components/CanvasGrid.tsx:780 | [10-06 잔여] Esc가 '여러 개 선택'·'이동불가 칸 선택' 모드까지 끈다 |
| C15 | 낮음 `[미커밋]` | editor:src/components/ResourceBrowser.tsx:104 · src/server/gameSync.ts:134 | 바닥 소재 일괄 추가에서 규격 외 1개가 섞이면 전부 거부, 어느 항목인지 모름 |
| C16 | 낮음 | editor:src/server/gameWorkspace.ts:94 | [10-06 F9 잔여] 저장·가져오기마다 전체 사본 누적(velos history 830개/280MB, .game-sync 1GB), 정리·상한·고아 정리 없음 |
| C17 | 낮음 | game:scripts/cover_mask_gen.cjs:345 | depth-sprite-pivots.json이 깨진 JSON이면 depth_check가 (9)에서 스택트레이스로 죽어 (10)(11)·요약 못 봄 |
| C18 | 낮음 | editor:src/lib/exportDrift.ts:62 · game:scripts/convert_map.cjs:233 | 게임 주석·문서가 전제하는 `gameContractParity.test.ts`가 에디터에 없고, 두 산식은 이미 갈려 있다(필드 부재 처리, 탐침 22/132 불일치) |
| C19 | 낮음 `[문서]` | editor:DEPTH_SORT.md:4 · src/lib/entityGeom.ts:64-71 | 정본 링크·z 식 위치·검사 번호가 낡음(존재한 적 없는 DEPTH_SORT_CONTRACT.md) |
| C20 | 낮음 `[문서]` | editor:README.md:260·286 | 적용 파일을 DT_Walk/DT_NpcSpawn 2종만 적음(코드는 6종, DT_MapTrap은 README 어디에도 없음) |
| C21 | 낮음 `[문서]` | game:docs/data/DATASET_SCHEMA.md:1335 · RULES.md:357 | DT_SpriteCoverMask 절·MS-25가 c97dfda2e 이후 갱신 안 됨(.map 후보·`--only-missing`·pivot 기록) |
| C22 | 낮음 `[문서]` | editor:HANDOFF.md:11 · README.md:3-17 | HANDOFF가 레거시 경로·c09697e 기준만 적고 동기화 경로·guard를 모름, README 상단 링크 4개 깨짐 |
| C23 | 낮음 `[문서·미커밋]` | editor:README.md:166 | '새 바닥 소재는 페른델 1×1 타일'인데 작업 트리는 256×128·중앙 피벗·PPU 100 서버 스프라이트를 허용·이월 |
| C24 | 낮음 `[문서]` | D:/MSW_아트생산/…/MSW_ISO_Z_SORTING_GUIDE.md:245 | "exporter의 review/gameDepthValidation이 기본 검사 경로"는 과장 — review는 깊이 검사 없음, 정렬 편집 후보만 검사, §10:310 수치 낡음 |
| **D1** | **높음** | editor:scripts/game-sync/npcs.cjs:131 · runtime.cjs:76 · src/store/editorStore.ts:304 | 10-14 신설 게임 검사 55(PI-1 포탈 가드 칸: 포탈 출발 칸+상하좌우에 NPC 금지)를 에디터가 전혀 모른다. NPC를 여관 문 앞에 두거나 포탈을 NPC 옆에 두어도 스토어·서버·검토·ZIP 전부 통과 → 게임 수동 check-all에서 FAIL, 건너뛰면 입구가 영구히 좁아짐 |
| D2 | 중간 | editor:scripts/game-sync/runtime.cjs:130 | 에디터가 OpenCondition을 모른다 — 보스 구역 템플릿에서 나가는 포탈을 추가하거나 보스 출구를 삭제·재추가하면 BossCleared가 빠져 map-route-lint BOSS-EXIT-OPEN FAIL(처치 전 출구) |
| D3 | 중간 | editor:scripts/game-sync/walk-edits.cjs:76 | 이동불가 편집이 '이 맵으로 들어오는 포탈의 도착 칸'을 보지 않는다. 하드 변형 맵에서 기본 맵 입구 도착 칸을 막으면 MAPMETA-DIFFICULTY-ARRIVAL FAIL(기본 맵 자체 도착 칸은 게임 lint도 무방비) |
| D4 | 중간 | editor:scripts/game-sync/core.cjs:15 | 게임에 커밋된 Velos_*/VEL_* 1×1 바닥을 fresh sync가 못 읽는다(FAMILY_NAME 페른델 전용) — 워크스페이스 체인 없이 velos를 가져오면 바닥 편집 불가(2608칸), 캔버스엔 낡은 velos.json 잔디 3600칸이 보임. .game-sync가 gitignore라 협업자는 즉시 막힘(실제 10-18 발생) |
| D5 | 중간 | editor:scripts/game-sync/cli.cjs:34 · src/server/gameSync.ts:101 | CLI/API로 'Velosgreenroad'처럼 대소문자가 다른 맵 이름이 통과돼 blocked 0·런타임 편집 불가 기준이 조용히 만들어지고, 후보 DT_Walk에 게임이 무시할 'Velosgreenroad' 행을 쓴다(C2의 상위 결함) |
| D6 | 중간 | editor:scripts/game-sync/runtime.cjs:47 · scripts/sync-npcclass.mjs:114 | 몬스터 카탈로그가 디버그 전용 원본 행(9SSV00) 21개를 배치 행과 같은 이름으로 배치 가능하게 내놓는다. 5쌍은 AggroType이 달라 초보 필드에 선공 몬스터가 나오고, 게임은 lint WARN뿐 차단 없음 |
| D7 | 중간 | game:scripts/convert_map.cjs:573 | convert_map의 MONSTER_SPAWN_HEADER가 낡은 11열이라 신규 맵/`--allow-legacy-rebuild`에서 13열 라이브 CSV에 병합 시 열이 밀린다(RespawnMaxSec='True', FlipX 유실), 경고 한 줄 외 무에러 |
| D8 | 낮음 | editor:scripts/game-sync/core.cjs:1148 | listCandidates가 이전 기준 후보의 applyFiles를 현재 기준 manifest로 검증해 게임 CSV 경로가 바뀌면 목록에서 사라짐 |
| D9 | 낮음 `[미커밋]` | editor:data/npcclass.seed.json | 커밋된 seed(09-26, 44종)가 10-07 이후 몬스터 12종을 모름 — 배포 에디터의 블루프린트 경로에서 유효 ID에 '카탈로그에 없음' 오탐 confirm. 재생성본은 미커밋 |
| D10 | 낮음 | editor:src/lib/validate.ts:38 | 블루프린트 검증이 NpcClassID 종류(Npc/Monster)를 안 봐 몬스터에 NPC ID를 넣어도 통과, 게임 convert_map에서야 거부 |
| D11 | 낮음 | editor:scripts/game-sync/runtime.cjs:22 · npcs.cjs:38 | Enabled 어휘 불일치: 에디터 '0'=꺼짐·(npcs.cjs) 빈칸=꺼짐 vs 게임 BoolCell '0'/빈칸=켜짐. 손편집 행이 에디터 활성 전용 검사에서 빠진 채 후보에 그대로 실림 |
| D12 | 낮음 | editor:scripts/game-sync/npcs.cjs:69 | 대사 그룹 목록이 SpeakerNpcClassID를 무시해 화자 불일치 지정(엘드릭 초상 + 로건 이름표) 허용, ID 규칙도 런타임 IdCell보다 넓음('SHOP_INTRO'·'030020'이면 NPC 클릭 무반응) |
| D13 | 낮음 | game:scripts/dataset-ref-lint.cjs:2498·3081 | 검사 40/48이 Enabled를 'true'만 켜짐으로 읽어 런타임·검사 55와 모순(빈칸·'1'은 런타임 스폰인데 검사 40 누락·검사 48 오탐) |
| D14 | 중간 | editor:scripts/game-sync/runtime.cjs:82 | 보스방 유일 출구(ferenforestshade_P01, BossCleared)를 삭제하거나 Enabled=False로 두면 에디터·게임 lint(map-route-lint ONE_WAY_OK 예외 + BOSS-EXIT-OPEN은 남은 행만 검사) 모두 통과 → 처치 출구 상실(10분 강제 퇴장만 남음), json↔CSV 교차검사도 없음 |
| D15 | 낮음 `[문서]` | editor:README.md:255-297 | 적용 절차(§6·§7)에 게임 수동 게이트(check-all = dataset-ref-lint·map-route-lint·depth_check) 실행 단계가 없다. velos-a4c83910 후보가 ONE-WAY FAIL로 a8bc6b416에서 수작업 보정된 실사례; 맵 단위 후보는 신규 연결의 역방향 포탈을 담을 수 없어 ONE-WAY를 구조적으로 단독 통과 못함 |

게임 repo 쪽에 전달할 사항은 §7.

---

## 2. 높음

### A1. 이미지 미세조정(visualOffsets)이 z를 보존해 게임 계약을 깬다
- 위치: `editor:scripts/game-sync/object-edits.cjs:229-240` (40f1fa7), 게이트 `core.cjs:953`, 테스트 `core.test.cjs:1680`
- 게임 계약: `game:scripts/build_map.cjs:108-111` "⚠ offset 을 포함한 pos.y 를 쓴다 … 안 그러면 정렬키와 시각이 어긋난다", `objectDepthZ(posY, sortOffset) = (posY − sortOffset×0.64)×0.21875` (:632-635). `depth_check.cjs:827-832` 검사 (1)은 `Obj_<id8>`(json 매칭)마다 `|pos.z − objectDepthZ(pos.y)| ≤ 1e-6`을 요구. 런타임 정렬키는 Transform.Position.z (`IsoPlayerDepthLogic.mlua:565-566`).
- 에디터: visualOffsets 루프는 `position.x/y += offset`만 하고 z·StaticZ를 두는데(주석 "preserving Z"), 같은 파일의 이동(moveTarget :98-101)은 `z += dy×DEPTH_SCALE`로 갱신한다. 게이트는 sorting 행이 없으면 `status:'unchanged'`로 바로 반환해 이 경우를 검사하지 않는다.
- 재현(실데이터, 읽기 전용): ferendelshop `Obj_503a7fac`(판매대, canMove)에 ↓4px 한 번 → export 성공·`gameDepthValidation = unchanged` → 후보를 게임 `depth_check.runCheck`에 넣으면 `차원드리프트 … baked z 2.8 ≠ 저작 sortOffset 0 의 z 2.7912`, ok=false. 가로 오프셋·셀 이동 대조군은 통과.
- 영향:
  - json 유래 `Obj_<id8>`(ferendel 273·ferenforest*·ironhallmine·lumia/nox·motel·shop = 630개 편집 가능): 후보는 에디터에서 성공으로 나가고 게임 `check-all`(수동, CI 없음)에서 exit 1. 현재 후보 90개 중 발생 0건이지만 버튼 한 번이면 재현.
  - `Obj_Editor_*`: 검사 (1) 정규식 `/Obj_([0-9a-f]{8})/`에 안 걸려 조용히 통과. velos 4 + velosroad 20 = 24개가 이미 게임 맵에 "그림은 dy만큼 내려가고 정렬키는 원래 높이" 상태로 적용돼 있다(실측 |dy| 0.1~0.7 world, velos 1개는 6.695). 액터가 그 띠에 서면 오브젝트 앞으로 그려진다. 다만 이 스프라이트들은 pivot_y 0.11~0.5라 Position.y 자체가 그림 바닥보다 1.7~9.9 world 위에 있어, 체감 오차는 pivot 문제가 지배하고 dy는 그 위의 증분이다.
  - 에디터 미리보기는 논리 z로 정렬하고 position+offset에 그리므로 게임 런타임과 **순서는 일치**한다. 불일치 상대는 build_map/depth_check 계약이다.
  - 부수: 정렬 행이 함께 있을 때만 DEPTH_GATE_FAILED가 나는데 메시지가 '정렬 변경' 탓으로 오안내(core.cjs:970-971). `MAX_VISUAL_OFFSET` 40.96u(4096px)까지 입력 가능해 최대 64칸까지 벌어질 수 있다.
- 수정 방향: (a) visualOffsets 적용 시 Position.z와 meta.StaticZ를 이동과 같은 식(`objectDepthZ(new y, sortOffset)`)으로 갱신하고 `core.test.cjs:1680` 기대값을 바꾸거나, (b) json 유래 원본에는 세로 오프셋을 금지하고 복제본·서버 소재에만 허용. 어느 쪽이든 validateSortingDepth를 visualOffsets(및 모든 오브젝트 편집)에도 돌릴 것. 벨로스 중심 pivot 문제와 묶어 설계해야 (a)만으로는 바닥 정렬이 맞지 않는다.
- 참고: 게임 검사 (10) '1×1 남쪽 침범'도 pos.y를 재고 런타임은 z로 정렬하므로, z 보존 오프셋 오브젝트에서는 (10) 판정이 실제 정렬점과 어긋날 수 있다(velosroad 1×1 20개 대상, 미측정).

### A2. 락파일 메타 키 비교가 부가 기록 `verifiedAdditions` 때문에 거의 모든 워크스페이스를 막고, `--lock` 재생성 시 반대로 뒤집힌다
- 위치: `editor:scripts/game-sync/core.cjs:236-237` (27cfa3a) `metadata = lock => entries.filter(k => !['resources','generatedAt','count','note'].includes(k))` → 4개 제외 모든 최상위 키를 동일성 비교.
- 게임: `scripts/storage-inventory.lock.json`은 bcd2805e4(10-15)부터 `verifiedAdditions` 키를 가진다(소비처 0건, 순수 부가 기록). `dump_group_ruids.cjs:157-166` `--lock`은 `{generatedAt, groupCode, count, resources, note}`만 쓰므로 재생성 시 키가 사라진다(재생성은 9-29~10-10 사이 30회 일어난 정상 운영 경로). 문서 `GUIDE_DEVELOPER.md:104-121`은 락을 4키·손 갱신으로 정의해 앞으로도 임의 키가 들어온다.
- 실데이터(22 워크스페이스, inspectSyncProject 실제 호출): 1차 탐색 시점(10-18 lock, verifiedAdditions 1건)에는 10-15 이전 기준 16개가 `metadata-mismatch:[groupCode] vs [groupCode,verifiedAdditions]`였고 그중 11개는 락이 유일한 차단 원인. **a8bc6b416(10-19)이 verifiedAdditions를 3건으로 바꾸자 10-15 이후 기준까지 전부 비호환이 됐다** — 현재 기준 92개 중 91개가 metadata 단계에서 탈락, 호환 1개는 10-19 03:29 생성 velosgreenroad뿐. 양쪽에서 이 키만 빼면 참조 리소스·페른델 카탈로그가 동일해 전부 compatible. 반대로 `--lock` 재생성 시뮬레이션(키 소실)에서는 그 뒤에 만든 기준이 전부 STALE로 뒤집힌다 — 두 집단을 동시에 만족하는 락 상태가 없다.
- 영향: 미리보기·출력·검토·ZIP 전부 차단(fail-closed, 데이터 손상 없음). 유일한 탈출구 '게임 원본 다시 가져오기'는 오브젝트/NPC/런타임 초안을 이관하지 않고 history로 밀어낸다(복원 목록 UI 없음). 초안이 있는 워크스페이스: ferenforestrest·resthard(blocked +22칸)·lumiatemple·noxtemple(NPC)·velosgreenroad(오브젝트+포탈)·velossilverforge(추가 11)·velosvelvet(추가 10)·velos.
- 수정 방향: 메타 비교를 허용목록(groupCode만 — `core.test.cjs:1477`이 groupCode 변경→STALE을 고정)으로 바꾸고 그 외 키는 note처럼 무시. '미지 최상위 키 추가/변경은 호환' 테스트 추가. 게임 쪽에는 verifiedAdditions를 `ruid-whitelist.json _verifiedBatch`(문서가 정한 기록처)로 옮기도록 요청(§7 G4).
- 10-06 리뷰 2-2(높음)와 같은 구조의 재발. 별도 지적된 "타일 카탈로그 전체 동일성(:246)" 조항은 의도된 설계(테스트 고정)이고 실데이터에서 판정을 가른 적이 없어 반박됐다(§9).

### A3. `[미커밋]` 재가져오기(import)가 이전 기준 무결성에 종속돼 유일한 복구 경로가 막힌다
- 위치: `editor:scripts/game-sync/core.cjs:340-351` (미커밋) `if (previousProject !== undefined) { const previous = loadBaseline(previousProject, …); … loadGroundCatalog(previousProject, previous) }` — try/catch 없음, 새 기준 생성보다 앞. `src/server/gameSync.ts:108`은 저장본이 있으면 항상 previousProject를 넘긴다. HEAD는 `createSyncProject({...paths, mapName})`로 옛 기준과 무관.
- 실행(실제 ferendelmotel·noxtemple·velosgreenroad 저장본, 스크래치 baselineRoot): 기준 폴더 없음 → raw `Error ENOENT …\manifest.json`(GameSyncError 아님 → route가 400 + 영문 절대경로 그대로 노출) / manifest.gameRoot 변경(PC 이동·다른 체크아웃) → BASELINE_MISMATCH / 스냅샷 1바이트 변경 → BASELINE_CORRUPT / pointer version 변경 → INVALID_BASELINE / resource-*.json 삭제 → RESOURCE_NOT_FOUND(gameResourceId 팔레트가 있는 velosgreenroad·velossilverforge·velosvelvet). 어느 경우도 새 기준이 생성되지 않는다. previousProject 없이 호출하면 성공.
- 발생 조건은 현재 데이터에 0건(22개 전부 기준 존재·gameRoot 일치). 그러나 baselines 폴더가 92개 UUID/369MB(워크스페이스 참조 22개)로 불어 정리 유혹이 크고, README 113-114가 안내하는 "PC 이동 시 새 동기화" 경로가 바로 이 코드로 막힌다. VERSION 상수를 올리면 22개 맵이 동시에 막힌다.
- 영향: 저장 초안은 `open`으로 계속 열리지만 미리보기·비교·출력·재가져오기가 모두 막힌다. 수동 우회는 `.game-sync/workspaces/<map>/project.json` 삭제(안내 없음). 단 velos·velosgreenroad는 게임 .map에 에디터 등록 바닥 RUID가 적용돼 있어 previousProject 없는 import는 `groundEditingSupported=false`('해석할 수 없는 바닥')가 된다 — 폴백만으로는 바닥 편집을 되찾지 못한다.
- 수정 방향: previousProject 처리를 best-effort로(loadBaseline/loadGroundCatalog 실패를 catch → `report.warnings`에 '이전 기준의 바닥 소재를 이어받지 못함 — 다시 등록하세요'), 기준 폴더 삭제·gameRoot 불일치 후 import 성공 테스트 추가. 더 나아가 복구 카탈로그를 이전 baseline 체인 밖(맵별 내구 파일)에 두고, 참조 중인 baseline을 보존하는 정리 도구/안내를 둘 것(C16). 현재 미커밋 테스트(core.test.cjs:1760-1778)는 성공 경로만 검증.

---

## 3. 중간

### B1. depth 게이트(validateSortingDepth)의 범위·카운터·CSV 출처
- `core.cjs:953` `if (!checked.objects.sorting.length) return {status:'unchanged'}` — 이동·복제·서버 소재 추가·삭제·이미지 오프셋·DT_Walk 단독 변경은 메타/z/가림물을 바꿔도 게임 depth_check가 돌지 않는다. 'unchanged'는 실제로는 'skipped' 의미.
- `core.cjs:968` counters 8개에 게임 fail 식(`depth_check.cjs:1127-1128`)의 `crossCells`·`bndHot`·`occlStale`이 없다. 합성 맵에서 같은 z 바닥 가구 겹침 → crossCells 1~2·ok=false인데 에디터 카운터 전부 0.
- after 실행이 DT_Portal·DT_NpcSpawn을 게임 repo 현재 파일에서 읽는다(`runCheck`는 blocked override만, :870). 같은 후보가 포탈을 옮기면 옛 포탈 위치로 (8)(9)(11)★를 평가.
- 실데이터(검증자 재생 실행): gameDepthValidation 필드가 있는 후보 42개 중 실제 맵/포탈/NPC 변경이 있는 25개 = passed 9 · unchanged 16. 16개를 기준 스냅샷 vs 후보로 재생하면 **6개가 실패했어야 함**: ferendel-9c4c8ccd·b8049f12(10-13, 포탈 3 추가·맵 불변 → portalFail 0→1 + ★3, 후보 DT_Portal로만 검출 가능), velos-00989e99·17daf8eb·e8af25cf(10-13, 이동 6 → bndFresh 0→4), velos-1a941fd7(10-18, 이동 2 → bndFresh 0→2). ferendel 포탈 건은 게임 bcd2805e4가 옮겼다가 e9da60ee1(10-15)이 "depth_check 포탈칸 위반 1·경계 뒤집힘 3쌍 유지"로 검사 실패 상태로 커밋 → a8bc6b416(10-19) 난간 sortPadX 4로 해소. 결과 범주는 "보기 틀림이 게임 check-all에서 뒤늦게 발견 → 4~6일 재작업".
- 완화 요소: 게임 `check-all.cjs`가 map/*.map 전수 depth_check를 돌린다(수동·CI 없음).
- 수정: 게이트 조건을 `checked.objects.changed`(또는 mapUnchanged가 아닐 때)로 확대, status를 'skipped'로 정직하게, counters에 crossCells·bndHot·occlStale 추가(또는 `before.ok && !after.ok`), 게임 runCheck에 portals/npcs override 추가 요청(§7 G2) 후 에디터가 후보 CSV 파싱 결과를 넘기거나 게이트를 CSV 후보 생성 뒤로 이동. `core.test.cjs:487-499`는 runCheck를 스텁해 dimDrift만 보므로 counters 목록 테스트 없음. 아트 Z가이드 §7:245·§1 5단계·§10:310도 정정(C24).

### B2. StaticZ ≠ Position.z 보호 규칙이 게임 표적 패치와 충돌
- `object-edits.cjs:41-43` `!near(meta.StaticZ, position[2])` → '깊이 정렬 메타를 확인할 수 없습니다' → canMove/canDelete/canDuplicate 전부 false.
- 게임 계약: `IsoDepthMetaComponent.mlua:28-33` "StaticZ는 런타임 소스가 아니다", 런타임·depth_check 모두 StaticZ를 읽지 않는다. 그러나 게임 자신의 절차 문서(`sortpad_census.cjs:40-42`, 260928 설계 :349)는 표적 패치 때 Position.z와 StaticZ를 함께 고치라고 적는데, 커밋 f1f0db99b(ferendelshop +0.42)·16b6772bb(ferendel MS-26)는 Position.z만 고쳤다.
- 실측: ferendelshop 21개 중 6개(판매대 3 + 에디터가 얹은 소품 3), ferendel 289 중 16, ferenforest 68 중 1 — 총 23개가 이 사유만으로 보호. 재동기화로 해소 안 됨. 보호된 판매대는 새 소품의 '받치는 가구' 후보에서도 빠진다(ObjectSortingPanel.tsx:41). ferendelshop은 게임이 "Obj_Editor_* 때문에 nocode_map --build 금지"로 명시한 맵이라 에디터가 유일한 저작 도구.
- 수정: StaticZ 불일치를 보호 사유에서 빼고 경고로 내리되 편집 시 StaticZ 재기록(:171·:212)은 유지(자가치유). 이동 경로(:180)는 StaticOrder를 다시 쓰지 않으므로 함께 맞출 것. 게임 쪽은 세 맵 StaticZ 표적 패치 + depth_check에 StaticZ↔Position.z 대조 추가(§7 G1).

### B3. sorting.bounds 무검증 → px/100 메타
- `objectSorting.cjs:24-27`은 `0 < n ≤ 10000`만 검사, `ObjectSortingPanel.tsx:36`은 setting이 있으면 저장 bounds를 그대로 사용, `object-edits.cjs:210`이 그대로 BaseW/BaseH로 굽는다. 패널 자동 계산식은 low_shrub에 ≈[6.75, 5.20]을 내므로 velos의 [4.32, 2.15]는 UI가 아니라 외부 저작(벨로스 작업본 history)에서 온 값. HEAD velos.map(a8bc6b416) 메타 117개 중 px/100 40개 / px/64 68개 / BaseW=0 9개.
- 알려진 px/100 문제의 **추가 결과**:
  - VEL-L03_low_shrub scale 0.6 세 개: 2.15×0.64×0.6 = 0.83 < OCCLUDER_MIN_H 1.2 → 런타임 가림 후보 제외(px/64면 1.29 ≥ 1.2). 단 몸통이 덮이는 발 위치가 전부 DT_Walk 차단 칸이라 가시 결함은 없음(검증자 실측).
  - 검사 (6) 발자국 미달이 눈먼다: 스프라이트 폭을 0.64배 작게 보므로 현재 0건이지만, px/64로 재계산하면 tree_round 8개가 FOOTPRINT_SHORT_FAIL 2.0을 넘어 커밋 게이트가 막았을 건.
  - 별개 드리프트: VEL-HQ-GR(20de5d89) BaseW 17.64는 px/100도 px/64도 아님 — 같은 RUID가 1322×1190→1254×1254로 재업로드된 뒤 BaseW 미갱신(불투명 bbox/64로 저작된 값).
- 수정: inspectObjectEdits에서 소재 metadata(width/height/pixelsPerUnit — validateResource가 이미 강제)로 기대 bounds(px/64)를 계산해 하한(기대값의 1/1.5 이하) 밖이면 INVALID_OBJECT_SORTING. 게임 쪽 depth_check에 "마스크 표 PxW/64 ↔ 메타 BaseW" 대조를 참고 경고로 넣으면 외부에서 들어온 .map도 잡힌다(§7 G7; 하드 검사는 HQ 쌍처럼 bbox로 저작한 경우 오탐).

### B4. surface 소품의 받침 연결이 .map에 남지 않는다
- `object-edits.cjs:207-215`: surface 행은 W/H=1·BaseW/H=0·z = 받침 z − 0.0001만 굽고 받침 식별자는 어디에도 없다(supportId는 에디터 project에만). 런타임은 1×1을 순수 z로만 정렬(`IsoPlayerDepthLogic.mlua:521-523` 멀티셀만 캐시), depth_check/sortpad_census의 어떤 검사도 소품–받침 짝을 모른다.
- 실제 발생: 게임 커밋 f1f0db99b가 판매대 셋 z +0.42 표적 패치 → Maker 실측 "장식이 (7,8) 플레이어를 덮음" → 사람이 장식 3개를 손으로 +0.42. autoTune evaluate()는 '받침만' vs '받침+소품'을 구분 못 한다(지표 동일, 실행 확인). 재발 경로는 autoTune 자동 적용이 아니라(값만 반환, 적용 경로는 guard로 막힘) **수동 표적 패치 절차**(sortpad_census 헤더가 바로 그 절차이고 소품 언급 없음).
- 수정: .map에 받침 식별자를 남기거나(IsoDepthMeta 필드/이름 규약) 게임 census/표적 패치가 'z = 어떤 멀티셀 z − 0.0001' 서명을 부속으로 인식해 함께 옮기도록 합의하고 EXPORT_CONTRACT에 명시. 운영 규칙으로는 "게임 쪽 수동 z 패치 후엔 에디터 재출력"(core.test.cjs:501이 받침 이동 추종을 보장). '받침 footprint 안' 휴리스틱은 실데이터 3개 중 1개만 맞으므로 z 서명이나 명시 필드로만 식별 가능.

### B5. 벽 장식 OrderInLayer −998
- `object-edits.cjs:206` `order = mode==='wall' ? -998 : 0`, 패널 문구 '벽 앞·캐릭터 뒤에 표시합니다'. 게임 `IsoProjectLogic.mlua:90-114` 평면은 −1000/−999/−200/−100/−50/−25/0/4000뿐, 런타임은 정적 오브젝트 order를 되돌리지 않고, depth_check는 order를 전혀 보지 않는다. MSW 정렬은 OrderInLayer 우선이므로 −998은 모든 order 0(건물·액터·그림자 −50까지) 뒤. guide.md:58 "평면 상수는 IsoProjectLogic 단독 소유" 위반.
- 실데이터 정정: velos.map(a8bc6b416 커밋)의 −998 6개는 Water_Velos_Patch·VEL_MarketFloor 매트, −997 3개는 항만 데크 — 전부 **바닥 데칼** 용도이고 그 용도에서는 모든 것 뒤로 가는 것이 원하는 결과다. '액자를 order 0 벽에' 둔 실례는 0건. 미리보기는 MSW와 같은 순서로 그려 WYSIWYG(무음 괴리 아님). 10-06 리뷰 2-4의 "−998 게임 상수 합의"는 여전히 미해결.
- 수정: (a) 게임 IsoProjectLogic에 BELOW(−999)와 ENTITY(0) 사이의 에디터 데칼 평면 상수를 합의·정의하고 build_map export→에디터 CONSTANT_KEYS로 받아 쓰며 depth_check가 허용 order 집합을 검사(§7 G5), (b) 에디터 역할 이름·도움말을 "바닥/벽 장식(모든 오브젝트·캐릭터 뒤, 바닥 위)"로 바로잡고 벽 장식 선택 시 같은 AABB를 덮는 order 0 오브젝트가 있으면 경고.
- 별건: −997은 에디터 코드·git 이력 어디에도 없고 10-17→10-18 사이 게임 쪽 수동 편집(데크를 물 패치 위로)으로 특정됨. 의도된 조치로 보이나 정의 없는 평면이 늘고 있다.

### B6. 클라 이미지 캐시가 RUID만 보고 version을 무시
- `useGamePreview.ts:32` `missing = ruids.filter(r => !cache.has(r))`, cacheRef는 baselineId·refreshNonce 변경 때만 재생성. 서버는 반대로 매 요청 메타 재조회 + no-store(`app/api/images/route.ts:28-32`, 바이트 캐시 키에 version·md5 `mswMcp.ts:250`) — 서버가 의도적으로 지원하는 제자리 갱신을 클라가 무효화.
- 전제: 에디터 업로드는 항상 새 RUID를 만들므로 Maker/MCP에서 같은 RUID의 버전·pivot_x/y를 바꾼 뒤 세션을 이어갈 때만. 회복 경로는 '이미지 다시 읽기'·원본 재가져오기(낡음 표시 없음). ResourceBrowser 썸네일은 매번 신선해 캔버스와 어긋난다.
- 더 나쁜 경로: `ObjectSortingPanel.tsx:21,31-33`이 낡은 asset의 width/height/pivot으로 bounds를 계산해 '바닥 가구' 설정에 담고 `object-edits.cjs:210`이 후보 .map BaseW/BaseH로 굽는다(pivot_y 0.5→0이면 BaseH 2배 차이). 히트테스트(opaqueAt)도 옛 알파.
- 수정: /api/images 응답의 version(또는 contentHash)을 캐시 엔트리와 비교해 다른 RUID만 재요청(현재 캐시 적중 RUID는 요청 자체를 안 하므로 경량 메타 재조회 추가 필요), register/upload 성공 시 무효화, bounds 계산을 서버(object-edits)에서 최신 메타로.

### B7. `[문서]` 후보 적용 ↔ map/<name>.json 미갱신 ↔ `--allow-legacy-rebuild` 재빌드 소실, 그런데 정본 문서는 기존 맵에 `--apply --build`를 지시
- 사실: 에디터 applyFiles는 .map + 외과적 CSV뿐이라 적용 뒤 json은 낡은 채 남는다(`core.cjs:1038`; 갱신된 프로젝트는 후보 폴더의 `editor-project.json`에만). 게임 86a13339a의 `legacy-map-write-guard.cjs:6-12`가 기존 .map이 있으면 build_map/convert_map applyTo*/nocode_map(`--force` 포함, `--apply` 단독도)을 NATIVE_MAP_PROTECTED로 차단하지만, 가드 메시지(:9)가 `--allow-legacy-rebuild`를 직접 안내하고 그 플래그로 뚫으면 `applyToWalk`가 맵 행 전량을 json blocked로 교체(`convert_map.cjs:612-616`)하고 `build_map.cjs:362`가 빈 빌더에서 .map을 재생성한다(기존 .map 안 읽음).
- 실데이터 손실 규모(실행, 쓰기 없음): ferendelmotel — 게임 9499cc28f(10-06)가 에디터 후보로 .map에 Obj_Editor_* 34개 추가·DT_Walk +16행을 적용했고 json은 미변경(blocked 44·오브젝트 13). 재빌드 시 DT_Walk 60→44(16칸 소실), Obj_Editor_* 34개 소실. velos는 json entities 0이라 .map 2727 엔티티(Obj_Editor_* 117)·DT_Walk 1780행·DT_Portal 8행 전부 소실. 재빌드 뒤 깊이 게이트가 실패해도 nocode_map은 "반영 후 게이트"라 손실을 되돌리지 못한다.
- 낡은 문서(가드 도입 뒤 갱신 0건, `allow-legacy-rebuild`·`NATIVE_MAP_PROTECTED`·후보 경로 언급 *.md 0건): `WEB_MAP_EDITOR_EXPORT_CONTRACT.md:13`(대표 명령 자체, :124 "기존 맵 재빌드는 refresh만"과 자기모순), `NOCODE_MAP_FLOW.md:63/66/108/127/151`, `NOCODE_MAP_USAGE.md:14/44`, `ADDING_NEW_MAP.md:263`, **`VELOS_DECORATION_PREP.md:147`**(10-19 수정본이 동기화 배치가 가장 많은 velos에 `--apply --build` 지시), `depth/아이소메트릭_깊이정렬_구현계획.md:174`, `npc/NPC_SPAWN_PIPELINE_PLAN.md:186·237`, `combat/261007_BOSS_ROOM_S4_DATA_REQUEST.md:69`("칸을 옮기려면 json에서 옮기고 --apply"). 에디터 README:103은 가드를 바르게 설명.
- 양쪽 코드는 이미 ".map+DataSet 정본, json 비정본"으로 수렴(에디터 가져오기도 blocked를 DT_Walk에서 읽음)하고 문서만 없는 상태.
- 수정: 게임 — 가드 메시지에서 플래그 안내를 빼고 "에디터 후보로 수정된 맵은 재빌드 시 편집이 사라짐" 명시, 위 문서들을 "`--apply/--build`는 신규 맵 전용, 기존 맵은 동기화 후보(ZIP) 경로"로 정정, "기존 네이티브 맵은 json 비정본" 합의를 EXPORT_CONTRACT에 기재. 에디터 — `editor-project.json`을 applyFiles/ZIP에 `map/<name>.json` 이름으로 포함할지 결정(§7 G11). 10-06 리뷰 2-1의 잔여.

### B8. `[문서]` EXPORT_CONTRACT §1 앵커 규약이 코드와 반대
- `game:docs/map/WEB_MAP_EDITOR_EXPORT_CONTRACT.md:62` "앵커 셀. footprint 뒤(북) 셀", :72-74 "정렬행 = gy + tilesH − 1", :117 "GROUND/ENTITY 2평면 + 앞아래행" ↔ `build_map.cjs:504-507` `ax = shGx; // 앞-아래 tip = 앵커`, `depthGx = ax − (dw−1)`, :632-635 z = objectDepthZ, :97-100 BELOW/ENTITY/ABOVE 3평면. 런타임 `IsoPlayerDepthLogic.mlua:526-527` `ax = GX + W − 1`, 에디터 `entity.ts:201-224` 북서 확장 — 코드 삼자 일치. 실데이터 대조: ferendel 46·ferenforest 7·ironhallmine 25 멀티셀 전부 `GX = gx−(W−1)`, 계약 식 일치 0/78.
- 이력: 계약은 c597871cd(07-13) 당시 build_map(`frontBottomRow = gy+tilesH−1`)과 일치했고, b04194a0a→348e3582b→5834ad48f(07-17~21) 앵커 뒤집기 2회와 z 모델 전환(eb348939a·c623de81e) 뒤 방치. `build_map.cjs:478-482` 주석은 b04194a0a 잔재로 :504-507 코드와 정반대. 같은 낡은 규약: `depth/아이소메트릭_깊이정렬_구현계획.md:36,66`, 에디터 `entity.ts:62-65·70·205` 주석, `entityExport.ts:98-100` 주석. 계약 JSON에 `depthW/depthH`가 없다(build_map이 tilesW/H로 폴백해 값은 맞음).
- 실제 결과(시나리오 정정): 문서대로 북쪽 셀에 앵커를 적으면 build_map은 스프라이트도 그 셀에 놓고 rect도 거기서 북서로 뻗으므로 rect와 그림은 정합한 채 **건물 전체가 (W−1,H−1) 북서로 밀려 배치**되고, 계약:53 예시(양수 footprintCells)대로 쓰면 DT_Walk 차단 칸이 보이는 건물 남동쪽에 떨어진다. 숨은 정렬 오류가 아니라 가시적 배치 오류. 현재 json 생산자(에디터→convert_map)는 일치하므로 운영 영향 0, 문서를 읽고 json을 직접 쓰는 사람·에이전트·생성기만 위험(VELOS_DECORATION_PREP.md:22가 이 문서를 좌표 규칙 정본으로 지시).
- 수정: §1 표·72-74행을 "앵커=앞-아래 tip, rect=(gx−depthW+1..gx), z=objectDepthZ"로, :53 예시를 음수 오프셋으로, JSON에 depthW/H 추가, §5를 3평면+z 모델로, build_map.cjs:478 주석·에디터 주석 동기 수정.

### B9. `[문서]` guide.md §2③ "정적 오브젝트에는 컴포넌트를 붙이지 않는다 · z = pos.y"
- `game:docs/map/isometric/guide.md:3` "실제 구현 기준 교정 정본", :149-158 ↔ `build_map.cjs:509` `z = objectDepthZ(pos.y, sortOffset)`, :530-549 auto 오브젝트마다 `upsertComponent(IsoDepthMetaComponent)`. "컴포넌트를 붙이지 않는다"는 guide 작성 커밋 ffb31cc1b(07-20) 시점에도 이미 틀렸고(메타 부착은 976028160 07-15부터), DEPTH_SCALE 압축(eb348939a 08-28)만 드리프트. `261004_타잔SCC_위상정렬_도입_검토.md:4`가 2026-10-04에도 "깊이 정렬의 정본은 guide.md"라 인용.
- 재현: ferendelshop 판매대 z를 guide 식 `= Position.y`로 바꾸면 depth_check (1) 1건 + 경계뒤집힘 ★6 신규, exit 1(sortOffset −3이라 3.66배). 메타를 지우는 경우는 **검사가 못 잡는다**(depth_check는 메타 있는 엔티티만 수집) — 멀티셀은 정렬 제약, 1×1은 가림 후보에서 조용히 빠짐.
- 같은 문서의 다른 낡은 곳: §2①:107 `z = footWorldY − PlayerZNudge()`, §2②:144 `z = p.y`, §4①:193-197 "z = world_y 그대로, 나누지 말 것"(현재 IsoProjectLogic.mlua:63-71은 정반대로 "모든 지점이 DEPTH_SCALE을 거쳐야"), §1② 상수표에 DEPTH_SCALE 없음. `IsoDepthMetaComponent.mlua:29` StaticZ 주석 "= 그려지는 world_y"도 압축 후 값이라 낡음. `에디터_sortOffset_요구사항.md:132`도 같이 볼 것.
- 수정: §2③을 "로직 컴포넌트는 없지만 데이터 전용 IsoDepthMetaComponent는 auto 오브젝트마다 붙는다 · z = objectDepthZ"로, §2①②·§4①·§1②를 `_IsoProjectLogic:DepthZ` 기준으로 교정.

### B10. `--verify`가 pivot 기록 도입 뒤에도 (0.5,0) 가정으로 대조 (10-18 신규 코드)
- `game:scripts/cover_mask_gen.cjs:245-255` pivotProblem(스토리지 pivot 없음 / ≠(0.5,0) → 사유), :631 `pivotIssue`, :727 `--verify`에서 `bad++`. c97dfda2e가 생성 경로의 `if (meta.pivotIssue) problems.push`는 지우고 effectivePivot(:783-790)으로 대체했지만 --verify 쪽 727행은 그대로 남았다. 같은 블록 733-739행이 pivots.json ↔ 스토리지를 따로 대조하므로 727행은 중복·모순.
- 결과(정적 추적, 네트워크 금지라 --verify 자체는 미실행): depth-sprite-pivots.json 107건 = mod 23 + storage (0.5,0) 61 + storage 기타 23 → **46행이 ✗**, exit 1. 메시지 "검사 (9)의 오프라인 사각형이 어긋난다"는 이제 거짓(검사 (9)는 pivots.json을 쓴다). DATASET_SCHEMA:1348·설계 R-6이 지정한 "낡은 행 발견 절차"가 사실상 무력화(B11·§7 G16의 낡은 행이 그 소음에 묻힘). CI 연결은 없는 수동 도구라 심각도 하한.
- 옛 가정이 남은 곳: cover_mask_gen.cjs 19-20·235-239 주석, 설계 578행(P3 ③), RULES.md:357(MS-25), depth_check.cjs:674 주석. `cover_mask_gen.test.cjs:321-328`이 옛 pivotProblem 동작을 고정.
- 수정: 727행 제거(733-739행만 남김), pivotProblem은 effectivePivot null인 경우로 대체, 테스트·주석·RULES MS-25 갱신.

### B11. AnimationClip RUID 가림물(벨로스 중앙광장 분수)
- `game:map/velos.map`(a8bc6b416 커밋) `Obj_Editor_cfac2c2c` SpriteRUID 5e762583 = 락파일 category "animationclip"("벨로스_분수"), BaseH 8.5 → 5.44u ≥ 1.2. 런타임 Load 필터(`IsoPlayerDepthLogic.mlua:502-504`)는 리소스 타입을 안 보므로 occl에 들어가고, `OccluderFadeLogic.mlua:133·311-314`는 MaskOf nil이면 건너뛴다(fail-closed, 경고 없음).
- 생성기 native 경로 `cover_mask_gen.cjs:646-657` fetchMod는 `extractEmbeddedPng`만 쓰고(:655 `'.mod 안에 PNG 가 없다'` throw) 클립 분기가 없다 — 에디터 캡처 클립 .mod 바이트로 실행해 null 확인. `--png-dir`로 PNG를 넣어도 :773 조건 `!meta.storagePivot && !pivots.has(ruid)`(벨로스는 스토리지 pivot 없음) 때문에 fetchMod가 호출돼 같은 throw → "행 없음". 우회는 pivots.json에 손으로 먼저 적는 것뿐.
- 추가 결과: `nativeSpritePivot`도 클립에서 null → pivot 기록 없음 → depth_check (9)는 (0.5,0) 가정, 런타임은 프레임 스프라이트 pivot(0.5,0.5) → 사각형 2.72u 어긋남. 분수 뒤 걷는 칸 8개가 사각형 상단 1/4 안(실루엣 불투명 여부는 오프라인 확인 불가 — '유력'). 전 .map에서 클립 가림물은 이 1개(락파일 animationclip 298개 대조). 설계 §13.3 R-7은 회전·그룹만 제외로 적고 클립 언급 없음.
- 수정: 생성기가 .mod 헤더로 클립을 식별해 첫 프레임 스프라이트 RUID로 마스크·pivot을 만들고(에디터 parseAnimationClipMod 규칙) 행 키는 클립 RUID로, 또는 클립을 D-OF 제외로 문서화하고 Load에서 제외. 프레임 합집합 사각형과 단일 프레임 마스크 UV는 프레임 크기·오프셋이 같으면 동일(미확인).

### B12. '후보인데 마스크 행 없음'을 막는 게이트가 없어 페이드 누락이 즉시 재발
- `depth_check.cjs:690` `if (!mask) { noMask++; continue; }`, :1027 `bad = occlFresh + occlStale`, :1127-1128 fail 식에 noMask 없음(테스트 :421-423이 "개수만 센다"를 고정). `check-all.cjs`에 cover_mask_gen 없음. `--verify/--only-missing`은 MCP 네트워크 필수, `--dry-run`(:707-714)만 오프라인.
- 실데이터: c97dfda2e(10-18 03:55)가 마스크 107행을 만든 직후 a8bc6b416(10-19)이 velos.map(+163,870줄)·velosgreenroad.map을 커밋하면서 마스크를 다시 만들지 않아 — velos "후보 97 · 마스크 행 없음 2"(5e762583 분수 5.44u, ad14d8e4 VEL-C07_merchant_ship **19.79u**), velosgreenroad "후보 0 · 없음 1"(959605d3 VEL_Greenroad_Counter_SE_15 7.17u). 모두 depth_check "통과 ✓". 과거 HEAD(bcd2805e4) velos도 "후보 11 중 5개 없음"으로 통과했었다. 락파일에는 RUID가 있고(문제는 CSV), `--dry-run`은 이미 "+ 표에 아직 행이 없는 후보 3개"를 출력한다.
- 수정: depth_check (9)에서 noMask > 0(또는 맵별 baseline 밖)이면 실패로 승격하고 RUID·이름 나열(네트워크 불요), 또는 `--dry-run`의 '+' 집계를 check-all에 연결. 클립처럼 영구히 행을 못 만드는 후보는 제외 목록 필요(B11). 즉시 조치: 상선·카운터는 `--only-missing` 한 번이면 행이 생긴다.

---

## 4. 낮음

### C1. DT_Walk 기준 가져오기가 json size 밖 셀에 INVALID_BLOCKED
- `core.cjs:370-373`(4a10169) DT_Walk 행을 blocked로 넣은 뒤 `walkEdits.blockedSet`이 `project.size`(map json) 범위로 fail. 실데이터: `home`(home.map 있음·home.json 없음·DT_Walk 5행)이 지금 실패하지만 listGameMaps가 json 없는 맵을 숨겨 UI로는 미도달(API/CLI로만). 게임 계약은 json size 권위·DT_Bounds 파생(`convert_map.cjs:507`)이고 convert_map도 같은 조건을 fail-closed하므로 "DT_Bounds로 size 확장" 제안은 폐기. 남는 방향: json 부재를 명시 거부, 메시지에 DT_Walk 셀·json size 명시.

### C2. 맵 이름 대소문자 (cab287a88 계약)
- `core.cjs:963-965`는 `manifest.mapName`(입력 그대로)을 넘기고 게임 `depth_check.cjs:870-873`은 `mapNameOf()`(소문자)와 정확 비교 → TypeError가 GameSyncError 아닌 채 400 영문 노출. 현재 맵은 전부 소문자(DS-12)라 UI로는 미발현, Windows에서 API에 'Velos'를 보내면 재현. 단 `blocked.mapName`만 toLowerCase하면 **역효과**: walk-edits.cjs mapRows가 'Velos'로 0행을 읽어 빈 기준선·'Velos' 행 후보가 생기는데 그걸 막던 throw까지 사라진다. 올바른 방향은 진입점(validMapName/createSyncProject/API)에서 소문자만 허용 또는 정규화 + validateSortingDepth try/catch → GameSyncError.

### C3. export 실패 시 반쪽 후보 폴더
- mkdir(:997) → .map 쓰기(:1010) → 게이트(:1019) 순서라 DEPTH_GATE_FAILED·TypeError·PRESERVATION_FAILED·verifySources 실패 모두 폴더를 남긴다. 실데이터 11개(velos 8·velosroad 3, ~30MB)가 이미 report 없는 반제품. UI는 "식별 정보를 확인할 수 없는 N개 제외"로만 표시. 수정: exportEditedProject 전체를 try/catch로 감싸 실패 시 `rmSync(candidateDir)`(outsideGame 검증 뒤).

### C4. ObjectSortingPanel bounds 산식의 피벗 팽창
- `ObjectSortingPanel.tsx:31-34` BaseH = 2·max(py,1−py)·px/64 → 바닥 피벗(0.5,0)이면 2배, 스토리지 (0.527,0.129)면 1.74배. 게임 규약은 피벗 무관 px/64(`IsoDepthMetaComponent.mlua:45-46`, json 경로 `editorStore.ts:667`→`build_map.cjs:545`). 런타임 게이트 halfH가 커져 pos.y 남북 양쪽으로 늘어난다. 실데이터: 워크스페이스 history에 [20.22, 30.06] 기록, 적용된 ferendelshop.map은 19.19/17.25(px/64, 당시 (0.5,0.5) 계산). depth-sprite-pivots.json 107개 중 바닥 61·기타 23이라 과반이 2배 대상. 스트레스(ferendel 멀티셀 46개 ×2): (11)은 불변이나 **(4) 교차모순 0→1**(플레이어가 자기가 선 오브젝트 뒤로) — 에디터 카운터에 crossCells가 없어 통과. 아트 Z가이드 §6:197 "배율 곱한 값 금지"와도 어긋남. 수정: `BaseW = width/ppu/0.64`, `BaseH = height/ppu/0.64`(게임은 바닥 피벗 세로 어긋남을 inFootprint로 이미 보완).

### C5. MapBuilder 사본 순서·불일치 (Astra F3 잔존)
- `core.cjs:102` `['.agents','.claude','.codex']` vs 게임 `skill-paths.cjs:23` `['.claude','.agents','.codex']`. 이 PC의 `.agents`는 gitignore된 미추적 로컬 캐시(8/04 시점 내용)로 727dfbb50(죽은 RUID 교체)·8d940c821(CoreVersion 스탬프·네이티브 컴포넌트 보강) 두 커밋 뒤처짐. baseline/candidate manifest 148건 전부 `.agents` 기록. 현재 산출물 차이 0(두 판으로 6개 맵 read→build 바이트 동일; 에디터는 항상 ruid 명시·read()만 사용·완전수식 컴포넌트명). 수정: 게임 `skill-paths.cjs` require 또는 `.claude` 우선 + 해시 불일치 경고. 테스트 픽스처 `.agents` 하드코딩(core.test.cjs:91/285/919, gameSyncWorkflow.test.ts:25/49)도 함께.

### C6. 옵트인 통합 테스트 6건 실패
- `MSW_GAME_SYNC_TEST_ROOT=게임`으로 4 스위트 38건 중 32 통과/6 실패: ① summary toEqual에 traps* 4키 누락(4a10169) ② 대사 그룹 56→112 ③ DT_MonsterSpawn 15→25(같은 줄의 Count 250·DT_Portal 50·DT_Bounds 13도 낡음) ④ DT_MonsterClass 빈 줄 → throw 기대인데 40f1fa7 runtime-dependencies가 참조 행만 서명(의도된 완화) ⑤ velos Tile 자산 — 1차 탐색 시점엔 게임 미커밋 velos.map 재도색(110 신규 RUID)이 원인이었고, a8bc6b416이 velos.map과 lock(+134건)을 함께 커밋했으므로 **재실행으로 재확인 필요**. 수정: 기대값을 CSV 파싱 기반으로, ④는 참조 클래스 행 변경으로, ⑤는 `groundEditingSupported===false`면 coverage 단언 건너뛰기. 부수: velos 동기화 결과 project.ground가 낡은 `map/velos.json`(60×60 잔디)로 채워져 미리보기에 .map에 없는 잔디가 보인다(내보내기는 바이트 동일, 표시만).

### C7. NPC·몬스터·포탈 드래그 초안 z
- `gameNpcPreview.ts:11`·`gameRuntimePreview.ts:12`가 descriptor z(순수 y×DEPTH_SCALE)에 Δ를 더해 actor-depth의 클램프·포탈 DecalZBack+ε+대역(+0.153)을 버린다(오브젝트 `spriteWithDraftPosition`은 보정값 보존). 실례: ferendel N004 [51,10]→[50,10] 드래그 중 건물 뒤, 확정 후 앞. 드롭 시 `setNpcDraft(null)` 직후 옛 scene이 그려져 원래 칸으로 튀었다가 250ms+컴파일+이미지 로드 뒤 새 칸(오브젝트는 movement feedback으로 유지). 10-06 리뷰 :122에 드래그 z 소실은 기보고, 포탈 오프셋·드롭 플래시는 신규. 수정: 초안 z = sprite.position[2]+Δy×DEPTH_SCALE, NPC/런타임도 scene 도착 전 draft 유지. 기존 테스트 gameNpcPreview.test.ts:38-44가 순수 z를 고정.

### C8. 미지 SortingLayer 하나로 씬 전체 파일 순서
- `gamePreview.ts:177-185` non-Default 하나라도 있으면 전부 sourceOrder. 게임은 레이어 블록 우선이고 Default 안은 여전히 OrderInLayer→Z. 실행: ferendel에 1개만 'UI'로 두면 Default 1635/1635 위치 변경, 바닥 897개가 오브젝트 위. 히트테스트(gameObjectPreview.ts:60 등)도 같은 정렬. 현재 23개 맵에 키 0건(5/27까지 MapLayer0 4건 전례). 경고 문구(core.cjs:850)는 "해당 레이어"로 과소 안내. 수정: Default는 정상 정렬, 미지 레이어만 별도 블록 + 경고 문구 수정.

### C9. z·order 동률 타이브레이크
- 같은 셀(또는 같은 대각선)에 depthOffset 0으로 두 소재 → 동일 z·order 보장(셀 스냅). 미리보기는 sourceOrder로 확정(core.cjs:789 주석 "file order needed for render ties"는 게임 repo에 근거 없음), 게임은 `261004_타잔SCC` F2 "동률은 엔진 임의 순서", build_map.cjs:121 타이브레이크 의도적 미설치. 자기 셀 위 복제(added, dgx=dgy=0)도 원본과 완전 동률(moved와 달리 가드 없음). 검사 (4)는 멀티셀 전용이고 순수 추가는 게이트가 안 돈다. 수정: 컴파일 시 "같은 order·같은 z 쌍 N개 — 게임에서는 앞뒤 임의" 경고, ε 자동 부여는 선택 옵션(0.0001 정수배).

### C10. PortalSpriteRuid 빈 셀 폴백
- `core.cjs:878` `if (actor.enabled && actor.ruid)`, `runtime.cjs:52` 빈/비정형/중복이면 ''. 게임 `PortalSpawnerLogic.mlua:161-166`은 **빈 문자열일 때만** ISO_TILE_RUID + 청록 틴트 폴백(ENTITY 평면·데칼 z). 비-hex 값은 게임도 그대로 대입해 로드 실패(포탈 안 보임) — 이 분기는 에디터와 일치하므로 불일치는 빈 셀 한정. 중복 행은 DS-PK-DUP가 막아 무관. 현재 CSV는 채워져 있어 잠재. 수정: 빈 셀이면 게임 repo의 `PrimitiveSpriteStyleLogic.ISO_TILE_RUID`·`PORTAL_TINT`를 읽어 미러(리터럴 금지 AS-1), 비-hex 값은 "게임에서 포탈이 보이지 않을 수 있음" 경고. 게임 쪽 별건: dataset-ref-lint `CFG_RUID=['GoldDropSpriteRuid']`뿐이라 PortalSpriteRuid 오타가 lint에 안 걸린다(DATASET_SCHEMA.md:1573와 불일치, §7 G8).

### C11. 자동저장 1회 실패 후 영구 중단 [10-06 잔여]
- `useWorkspaceAutosave.ts:16` `status==='error'`면 즉시 return, 복구는 saveManagedProject 성공(작업 저장·다시 저장·Ctrl+S·출력·다른 맵 열기)·맵 재로딩뿐. 재현: 500 후 편집 30회·300초 경과해도 fetch 1회 그대로. dirty 유지·배너·beforeunload는 살아 있어 손실은 배너 무시 + 강제 종료 때만. 수정: 편집이 새로 생기면 지수 백오프 재시도, 단 409는 제외 — 현재 `gameRequest`가 status를 버리므로 먼저 status를 실은 오류로 바꿔야 함.

### C12. 함정 경계 판정 불일치
- 클라 `assertTrap`→DT_Bounds, 서버 `traps.cjs:29`→json size. 게임 계약은 DT_Bounds(DATASET_SCHEMA:344·lint MAPTRAP-BOUNDS·MapBoundsLogic)이므로 **서버를 bounds 기준으로** 통일(runtime.cjs:67에 이미 있음), GameTrapPanel NumberField max도. 현재 22맵 일치(home만 예외, UI 비도달). 발현 경로: 게임 재변환으로 size·DT_Bounds가 바뀐 뒤 '배치 원본 다시 읽기'. 어긋나면 바닥·런타임 편집 잠김(NPC 편집은 가능), Undo로 복구.

### C13. '＋ 서버 소재 추가' 재컴파일 중 비활성 [10-06 3-2 잔여]
- `PalettePanel.tsx:117` `status!=='ready'` 유지(27cfa3a가 :31·:69·Toolbar·editorCommands는 `!=='error'`로 완화). 드래그 전체+250ms+왕복+이미지 로드 동안 깜빡임. ResourceBrowser는 status를 안 보고 loading 중 보존되는 scene만 쓰므로 완화해도 안전. 수정: `status!=='error' && scene?.baselineId===gameSync.baselineId`.

### C14. Esc가 다중선택·이동불가 칸 선택 모드까지 끈다 [10-06 잔여]
- `CanvasGrid.tsx:780-782` → `activateEditorTool('cursor')` → `editorCommands.ts:15-17` `setSelectionMode('objects'); setMultiSelect(false)`. README 127-137의 이동불가 셀 묶음 편집 절차 한가운데(step 5 "Esc는 선택을 해제")에서 모드가 풀린다. 같은 패널 ✕ 버튼은 multiSelect를 유지해 두 해제 수단이 다르다. 수정: Esc 전용 경로(clearGameSelection + 배치 취소 3종)로 분리, `editorCommands.test.ts:62-69`의 cursor 케이스 조정.

### C15. `[미커밋]` 바닥 소재 일괄 추가 전체 거부
- `ResourceBrowser.tsx:104-110` 선택 전체를 100개 청크로 register-ground-resources, `gameSync.ts:121-123·134-137`은 첫 불일치에서 item.name 없이 throw → 규격 맞는 항목도 추가 안 됨, 몇 개가 문제인지도 모름. 101개 이상이면 앞 청크 resource-*.json은 기록되고 팔레트엔 없음(무해한 고아). 게이트(256×128·중앙 피벗·PPU 100)는 CAMERA_TILE_SPEC §2-1·`groundResourceFits` 실제 계약이므로 유지. 수정: 오류에 item.name·실제 규격 포함, 서버가 전 항목 검사 후 실패 목록 반환, 연결 맵에서 분류 foothold 고정 또는 사전 필터.

### C16. 저장·가져오기마다 전체 사본 누적, 정리·상한 없음 [10-06 F9 잔여·악화]
- `src/server/gameWorkspace.ts:91-96` 저장(자동저장 1초 디바운스 포함)마다 전체 project.json을 history/<sha>.json으로 복사(상한·GC 없음, 읽는 코드 없음 — '파일 사본 열기'로 열 수는 있음). import마다 새 baseline 폴더(현재 코드는 REFERENCE_NAMES 16장 ≈1.9MB, 옛 폴더는 94장 3~4MB). 실측: .game-sync 1006MB = workspaces 359 + baselines 369 + candidates 264; velos history 830개/280MB(10-17 하루 600개); UUID 기준 폴더 92개 중 workspace 참조 22, history/candidate 참조까지 합치면 89/92라 "참조 보존" 규칙으로는 거의 회수 안 됨 — history를 먼저 쳐내야 GC가 의미 있음. import 중 다른 창 자동저장이 끼면(createSyncProject 0.2~0.4초 창) 기준 폴더만 남는 고아 발생(재현). 수정: history 개수/용량 상한 또는 diff 저장, superseded baseline·고아 npc-/runtime- GC 명령(보존 집합에 candidates 참조 포함), import는 기준 생성+저장을 한 트랜잭션으로.

### C17. depth-sprite-pivots.json 손상 시 depth_check 크래시 (10-18 신규 코드)
- `cover_mask_gen.cjs:345` `JSON.parse` try/catch 없음 → `depth_check.cjs:1021`에서 SyntaxError 전파 → (1)~(8) 출력 뒤 (9) 라벨·(10)(11)·요약 없이 종료(exit 1이라 check-all은 막힘, 거짓 통과 없음). 같은 파일 `readBaselineAllowed`(:603-607)는 손상 JSON을 catch하는 관례와 불일치. nocode_map 경로는 이미 catch. 수정: 빈 Map 반환은 fail-open(전 스프라이트 (0.5,0) 가정)이라 권장하지 않음 — (9) 블록에서 catch해 "입력 파일 손상 → 검사 불능 = 실패"로 출력하고 (10)(11)은 계속.

### C18. `gameContractParity.test.ts` 부재 + 두 산식이 이미 갈림 (ASTRA §5 항목 4 미해결)
- `game:scripts/convert_map.cjs:233`·`260928_웹맵에디터_sortPadX_요청.md:119`가 "에디터의 gameContractParity.test.ts가 이 함수를 직접 불러 확인한다"고 적지만 에디터 repo 역사상 그 테스트는 없었고(`git log -S` 0건), 게임 커밋 089f2c9d4가 "한 쌍"으로 지목한 에디터 커밋 3abbb9e도 존재하지 않는다 — 에디터 쪽 절반이 랜딩되지 않은 것.
- 실행(스크래치 vitest, 22맵 695 오브젝트): 커밋된 맵은 양쪽 0건 일치. 탐침 132건 중 22건 불일치 — 전부 "scale/offset 필드 삭제"(옛 파일 모양) 케이스로 게임은 잡고 에디터 `exportDrift.ts:62` `if (stored === undefined) continue;`는 건너뛴다(테스트 :53이 그 동작을 고정). 게임 요청서 §7.3이 "2판까지는 건너뛰었다 — 틀렸다"고 명시한 바로 그 옛 의미론. 구체 시나리오: 스크립트가 쓴 json 오브젝트에 scale/offset이 없음 → 에디터로 열어 무변경 저장하면 값이 채워져 렌더가 바뀌는데 에디터 확인창은 경고 없음(게임 테스트·--build 경고는 잡음).
- 수정: 에디터 exportDrift의 필드 부재 처리를 "없는 필드 = 빌더 기본값과 비교"로 맞추고 exportDrift.test.ts:53 수정 + convert_map.editorContractDrift를 require하는 parity 테스트 추가(둘을 같이 해야 테스트가 즉시 실패하지 않음). 아니면 게임 주석·문서 삭제.

### C19. `[문서]` DEPTH_SORT.md·entityGeom.ts 주석
- `editor:DEPTH_SORT.md:4` 정본 포인터 `docs/map/isometric/DEPTH_SORT_CONTRACT.md`는 두 repo 어디에도 존재한 적 없음; :14 `build_map.cjs:392 (z = pos.y − extra × CELL_DEPTH)`는 두 번 낡음(현재 :632-635 objectDepthZ + DEPTH_SCALE); :99 '검사 (6) baked z 파리티'는 처음부터 틀림((6)은 신설 때부터 발자국 미달, z 파리티는 c623de81e가 (1)에 신설). README:50·52, HANDOFF:64·84가 링크하는 살아있는 문서. 같은 죽은 포인터가 `src/lib/entityGeom.ts:64-71` 주석에도(CELL_DEPTH "build_map과 동일" — 실제는 z 공간값 0.14 vs world 0.64; 작업자가 이를 '고치면' 깨짐). 게임 `depth_check.cjs:17` 헤더도 (1)에 z 대조가 추가된 뒤 미갱신.

### C20. `[문서]` README §1·§6·§7 적용 파일 목록
- `README.md:96-98·260·286`이 적용 대상/ZIP 내용을 DT_Walk/DT_NpcSpawn 2종"만"으로 적지만 `core.cjs:1065-1072 runtimeApplyPaths`가 DT_MonsterSpawn·DT_Portal·DT_Bounds·DT_MapTrap도 변경 시 적용 파일로 낸다(테스트 core.test.cjs:1343-1349·1374-1379 고정). DT_MapTrap은 README 어디에도 없고 :101은 함정을 "게임 반영 파일이 아닙니다" 맥락에서만 언급(4a10169가 README를 안 고침). 완화: report.json applyFiles(README:160)·후보 검토 창·REVIEW.txt는 6종을 표시. 수정: 세 목록을 6종으로 통일하고 함정 편집 절 추가.

### C21. `[문서]` DATASET_SCHEMA DT_SpriteCoverMask 절·RULES MS-25
- `DATASET_SCHEMA.md:1335` "전량 재작성"은 기본 실행에선 여전히 참이나 `--only-missing`과 .map(IsoDepthMeta) 네이티브 후보가 빠짐, :1337-1338 "썸네일 알파에서 굽는다"는 네이티브 후보(.mod PNG)에 안 맞음, :1347 "PxW = palette[].px"는 json 후보만. 설계 §5.1 열 표(:173)도 동일. `RULES.md:357` MS-25 "오프라인 사각형은 (0.5,0) 가정 · 61행 전부 맞았다"는 107행 중 46행에 대해 거짓(검사 (9)는 pivots.json 사용). 작업자가 벨로스 (9) 결과를 pivot 가정 탓으로 무시할 위험. 수정: 두 문서에 `--only-missing`·.map 후보·pivot 기록표 반영(B10과 같이).

### C22. `[문서]` HANDOFF.md·README 상단
- `HANDOFF.md`(미추적)는 2026-10-02 레거시 시점 기술: :11-12 json→convert_map→build_map 경로(게임 가드로 기본 차단됨을 모름), :67 pivot=바닥-중앙(저작 규칙으로는 지금도 맞으나 "강제되지 않으며 동기화 경로는 실제 구워진 pivot을 읽는다" 단서 없음 — 벨로스는 규칙을 어긴 에셋), :75-77 c09697e(19 커밋 뒤처짐)·launch.json 미커밋(이미 커밋됨). README:3 "blueprint export" 헤드라인은 동기화 프로젝트에 없는 버튼, :5-8 `../../docs/map/*.md` 4개 깨짐(MVP_DESIGN·PIPELINE은 게임 repo에도 없음), :17 `cd tools/web-map-editor` 옛 경로 — HANDOFF:89가 스스로 보고했으나 미수정. 수정: HANDOFF를 '레거시 전용·10-02 시점'으로 표기하고 동기화 경로 요약 링크 추가, README 상단 정정.

### C23. `[문서·미커밋]` README 바닥 소재 규칙
- `README.md:166` "새 일반 바닥 소재는 등록된 페른델 1×1 타일"·:39 팔레트 문단 ↔ 작업 트리 `gameSync.ts:112-141 register-ground-resources`·`core.cjs loadGroundCatalog`는 256×128·중앙 피벗·PPU 100 서버 sprite(animationclip 불가, RectTile 맵만)를 바닥 브러시로 허용하고 재가져오기 때 카탈로그를 이월(A3 조건부). 게임은 이미 임의 256×128 스프라이트를 바닥으로 소비 중(velos Tile 2608개 비페른델 RUID 110종). 아트 Z가이드 §9:293 "전용 바닥 카탈로그를 잃는다"는 코드가 충족한 요구이므로 완료형으로. 벨로스류 맵은 "등록 → 저장 → 원본 다시 가져오기" 2단계 뒤에야 바닥 편집이 되는 절차도 README에 필요(UNSUPPORTED_GROUND).

### C24. `[문서]` 아트 Z가이드 §7:245 "exporter가 깊이 검사"
- `D:/MSW_아트생산/…/MSW_ISO_Z_SORTING_GUIDE.md:245`·§1 5단계: reviewCandidate는 해시·무결성만 검사(깊이 검사 없음), gameDepthValidation은 정렬 편집 후보만(B1), 포탈·NPC는 게임 현재 CSV. §10:310 "메타 109개·통과"는 117개로 낡음(통과는 맞음). 에디터 README:105는 "정렬 변경 후보는"으로 정확히 한정. 수정: "정렬 편집 후보만 exporter가 검사, 그 외 후보는 ZIP 적용 후 게임 check-all/depth_check를 직접"으로.

---

## 5. 2차 검증에서 '이미 해결됨'으로 판정된 것 (게임 a8bc6b416, 10-19 11:24)

- `depth_check.test.cjs:508`이 pivots를 안 넘겨 (0,37) 오판을 재현하던 문제 — 그 커밋에서 `cmg.loadPivots(...)` 전달로 수정(테스트 41/41). 508행을 되돌리면 지금 velos.map에서 (0,37) 오탐이 즉시 재발하므로 수정은 load-bearing.
- c97dfda2e가 남겨둔 velos 포탈 (0,39)↔가로등 20%·velosroad (0,5)↔작은활엽수 53% — 같은 커밋에서 배치 이동으로 해소(CLI 4개 맵 (9) 신규 0, baseline 동결 없음).
- velos.map·velosgreenroad.map·lock(+134건) 커밋 → 1차 탐색의 "미커밋 velos.map" 서술은 전부 HEAD 기준으로 보정했다.

---

## 6. 완전성 비평의 추가 탐색 결과 (D1–D15)

비평이 지목한 공백 6개: ① PI-1 포탈 가드 칸을 에디터가 모름 ② 게임 커밋 게이트(dataset-ref-lint·map-route-lint)를 에디터 후보에 실제로 돌린 적 없음 ③ 리뷰 도중 게임 작업트리 변경(a8bc6b416) 재고정 ④ 아무도 안 읽은 파일(GameCandidate*·cli.cjs·compare·prune) ⑤ npcclass.seed.json ↔ 게임 카탈로그 ⑥ 에디터가 쓴 CSV 행을 게임이 열 단위로 어떻게 읽는지. ②는 게임 lint 두 개를 스크래치 미러에서 실제 후보 33개 + 합성 후보에 실행했다.

### D1. **높음** — PI-1 포탈 가드 칸(게임 검사 55)을 에디터 NPC·포탈 검증이 전혀 모른다
- 게임 계약: `dataset-ref-lint.cjs:3951-4008` 검사 55 NPC-PORTAL-GUARD(e7032e454, 10-14) — 켜진 포탈 출발 칸 + `MovementRulesLogic.DELTAS` 4방향(1,0)(0,−1)(−1,0)(0,1)을 가드 칸으로 만들고 켜진 NPC가 거기 있으면 FAIL(exit 1). 런타임 `PortalIdlePolicyLogic.mlua:26-45` 같은 색인. 설계 `261014_PORTAL_IDLE_GUARD_DESIGN.md §2.1` "NPC를 가드 칸에 배치하면 입구는 영원히 좁아진다 — 런타임은 고치지 않고 데이터 검사가 커밋에서 막는다", D-PI11(NPC는 옮기지 않음). 예외는 `ALLOW_NPC_ON_PORTAL_GUARD`(사유 필수, 현재 비어 있음).
- 에디터: `npcs.cjs:106/131/137-145` NPC 추가·이동 검증은 맵 안·NPC끼리 점유·이동불가 경고뿐, `runtime.cjs:76-78/88` 포탈 검증은 경계·도착지·BLOCKED_PORTAL·포탈끼리 점유뿐, `editorStore.ts:304-308/344-356` assertNpcCell/assertPortal도 동일. 같은 파일에서 몬스터(:73)·시작점(:94)은 NPC 점유를 보면서 포탈만 안 본다. `core.cjs:712`가 이미 `npcs.descriptors`와 `portals.records`를 함께 가지므로 추가 입력 없이 교차검사 가능. 에디터 repo 전체 grep 'PORTAL-GUARD|PortalIdle|검사 55|가드 칸' 0건, README:321·338도 안내 없음.
- 재현(실데이터, 스크래치): ferendel 기준에서 NPC 101을 여관 문 ferendel_P07(8,9) 바로 아래 (8,10)에 추가 → inspect OK(경고는 보일러플레이트 3줄) → export → 후보 DT_NpcSpawn에 행 기록 → reviewCandidate **ready**, packageCandidate ZIP 생성 → 검사 55 복제: `NPC-PORTAL-GUARD … @ferendel|8,10 blocks ferendel_P07`. (8,10)은 P07의 유일한 입구(삼면 blocked)라 여관 문이 완전 봉쇄된다. N010을 포탈 칸 (8,9) 자체로 이동해도 통과. 역방향 — N010(6,21) 옆 (7,21)에 포탈 추가, P07을 (7,21)로 이동, NPC가 선 칸 (6,21) 바로 위에 포탈 추가 — 전부 통과. velosgreenroad (3,14)/(2,14)도 동일(lint exit 1 실제 실행). 현재 게임 데이터는 위반 0이고 `dataset-ref-lint`는 0 issue PASS라 이 후보를 적용하면 검사 55가 유일한 FAIL이 된다.
- 영향: 게임 게이트가 명시적 메시지로 잡지만 check-all은 수동(훅·CI 없음)이라 건너뛰면 런타임 경고 없이 입구가 영구히 좁아진다. 게이트를 돌려도 lint 문구가 "NPC를 옮겨라"(D-PI11)라 방금 둔 포탈이 원인임을 가리키지 않아 왕복 비용. 검증자 심각도: 높음·중간·높음·중간·높음·중간(발견 3건) — 게임 설계가 "데이터 검사가 막는다"고 방어선을 명시했고 그 검사가 수동인 점을 감안해 높음으로 둔다.
- 수정: `runtime.cjs` inspectRuntime(또는 core.cjs:712 근처)에서 편집 반영 후 켜진 포탈 출발 칸+4방향 집합과 편집 반영 후 켜진 NPC 칸을 **양방향** 교차검사해 fail('NPC_PORTAL_GUARD', '포탈 X의 입구 칸(포탈 칸과 상하좌우) — 게임 검사 55가 막습니다. 일부러면 게임 ALLOW_NPC_ON_PORTAL_GUARD에 사유와 함께'). 4방향은 lint처럼 게임 `MovementRulesLogic.mlua` 선언을 읽어 미러(4개가 아니면 fail-closed). 스토어 assertNpcCell/assertPortal에도 같은 선검증(드롭 즉시 오류). Enabled 판정은 게임 규칙(빈칸=켜짐, 'false'만 꺼짐, 좌표 floor(n+0.5)). README NPC·포탈 절에 규칙·출처(설계 §2.1·RULES D-PI11) 기재. 테스트 3종에 가드 회귀 케이스 추가. 더 넓게는 export 직후 게임 `dataset-ref-lint`/`map-route-lint`를 후보 DataSet에 돌리는 공통 게이트(depth_check와 같은 자리)를 두면 D1~D3 부류가 한 번에 닫힌다(lint는 ROOT 고정이라 디렉터리 미러 필요).

### D2. 중간 — OpenCondition을 모른다 → BOSS-EXIT-OPEN
- `runtime.cjs:10/12` P_FIELDS/P_COLUMNS에 openCondition 없음, :130 추가 행은 header 전열 ''(= OPEN_ALWAYS, `BossRoomPolicyLogic.mlua:40·60`), :62 exact()가 openCondition 필드를 INVALID_RUNTIME_EDIT로 거절, GameRuntimePanel 포탈 입력은 도착 맵/방향/활성뿐. 게임 열 도입 dd2feed6f(10-13), 에디터 runtime.cjs 마지막 변경 40f1fa7(10-14) 미반영.
- 재현: ferenforestvalley(InstanceKind=BossCopy 템플릿) 기준에서 (0,4)→ferenforest4 포탈 추가 → export OK → 후보 행 `…,NW,True,` → map-route-lint `[BOSS-EXIT-OPEN]` FAIL. 더 현실적인 경로: 보스방 유일 출구 ferenforestshade_P01(BossCleared)을 삭제 후 같은 칸에 재추가하면 BossCleared가 사라진 행이 구워져 동일 FAIL. 수정(이동)은 original을 보존해 BossCleared 유지(확인).
- 게임 lint(:24-25 "맵 에디터가 모르는 필드를 지워도 조용하지 않게")가 이 경우를 설계한 게이트로 잡으므로 런타임 결과(처치 전 출구)는 check-all 생략 시만. 단 HEAD가 이미 ORPHAN-MAP 2건으로 빨간 상태라 새 줄이 묻힐 여지. 계약 귀속: `EXPORT_CONTRACT.md §2` 포탈 필드에 openCondition이 없고 `DATASET_SCHEMA.md:1329`만 "맵 json의 openCondition이 정본"이라 적혀 있어 D-BR45(10-13) 이후 계약 드리프트.
- 수정: 포탈 편집 필드에 openCondition 추가(어휘는 게임 `BossRoomPolicyLogic.mlua` OPEN_* 선언에서 읽기), 최소한 `DT_MapMeta.InstanceKind`를 읽어(runtime.cjs FILES에 DT_MapMeta 추가) 템플릿→비템플릿 추가는 BossCleared 없이는 거절/경고. 게임 EXPORT_CONTRACT §2에 openCondition 추가 요청(§7 G20).
- 부수(문서, 낮음): 에디터가 추가하는 포탈은 OpenCondition ''(늘 열림) 고정이고, 열림 조건 없이 실내 맵(몬스터·신전·PvP 없음)으로 가는 포탈은 게임 규칙(D-PI3 `PortalIdlePolicyLogic:IsSafeDoor`)상 자동으로 '안전한 문'(가드 칸에 20초 머물면 자동 진입)이 된다 — 설계 의도이지만 README 포탈 절에 안내가 없다. 유일 출구 삭제 경로는 D14.

### D3. 중간 — 이동불가 편집이 포탈 도착 칸을 보지 않는다
- `walk-edits.cjs:76-81` inspectBlocked는 집합 차이만, `runtime.cjs:77-78` BLOCKED_PORTAL은 편집한 포탈에만, FILES에 DT_MapMeta 없음(DifficultyBaseMap 모름). 게임 규칙 D-BR42(17d4b86ef 10-10): 변형 맵은 기본 맵 입구 포탈의 도착 칸을 공유(`EnterBossRoomUseCaseLogic.mlua:384-392`), `dataset-ref-lint.cjs:1990-2005` MAPMETA-DIFFICULTY-ARRIVAL.
- 재현: ferenforestvalleyhard 기준에서 (1,3)을 이동불가 추가 → export OK(관련 경고 없음) → lint FAIL "ff4_to_valley_1 도착 칸 (1,3)이 Hard 변형의 DT_Walk 차단 칸". 런타임은 D4 착지 산개(3×3)로 옆 칸에 내리므로 "벽 안에 선다"는 과장이나 게이트 차단은 확정. 기본 맵 ferenforestvalley 자체의 (1,3) 차단은 에디터도 게임 lint도 통과 — 양쪽 무방비(§7 G23).
- 같은 뿌리의 다른 축(검증 완료): ferendelmotel 새 기준에서 DT_MapMeta ReturnCell (8,13)을 이동불가로 → export OK → reviewCandidate ready → ZIP → lint `MAPMETA-RETURN-CELL` FAIL(스크래치 미러 실행). 런타임은 `OccupancyGridStoreLogic.Reserve`가 DT_Walk를 보지 않아 혼자 귀환하면 산개 없이 벽 칸에 선다(무에러, 첫 걸음으로 탈출 가능). (8,13)은 ferendel_P07의 도착 칸이기도 한데 BLOCKED_PORTAL은 현재 맵에서 편집한 포탈에만 적용돼 역시 못 잡는다. 기존 시작점 칸을 막는 편집도 BLOCKED_SPAWN이 spawnChanged일 때만 돌아 통과.
- 수정: 런타임 프로파일에 DT_MapMeta 포함(스냅샷·드리프트 서명에도), walk 편집 경로(inspectBlocked 또는 core.cjs:708 직후)에서 after 집합 ∩ {DT_Bounds Spawn, DT_MapMeta Return 셀, 현재 맵(및 DifficultyBaseMap 가족)을 DestMap으로 갖는 켜진 포탈 도착 칸, 이 맵의 켜진 포탈 출발 칸}을 BLOCKED_PORTAL 급 fail로. Revive 셀은 런타임이 IsWalkable로 거르므로 경고면 충분.

### D4. 중간 — fresh sync가 게임에 커밋된 Velos 바닥을 못 읽는다
- `core.cjs:15` FAMILY_NAME `^(페른델)_(1|2|4)x\2_…$`, :110-123 catalogFromLock은 이 이름만 카탈로그로. a8bc6b416 velos.map Tile_* 2608개 = Velos_grass/edge/stone 110 RUID(lock에 전부 있으나 이름 불일치), velosgreenroad 225개 = VEL_InteriorWood 4 RUID. 게임은 바닥을 이름으로 소비하지 않고(build_map은 palette→RUID·px만) 게임 쪽 바닥 소재 정본도 없음(palette_ruids_velos.json 낡음, tile_registry Velos 0건, lock에 px/pivot 없음).
- 실행: previousProject 없이 createSyncProject('velos') → groundEditingSupported=false, 경고 2608 '해석할 수 없는 바닥'; 바닥 편집 export는 UNSUPPORTED_GROUND(이동불가·오브젝트 편집은 정상). 워크스페이스 기준 10d53553의 manifest.catalog(resource: 224)가 110 RUID를 커버해 미커밋 previousProject 체인으로만 복구 — 영수증(resource-*.json)이 아니라 이전 baseline manifest 상속이라 기준 폴더가 사라지면 영수증만으론 복구 불가(A3와 결합). HEAD core.cjs(previousProject 없음)는 워크스페이스가 있어도 false. 실제 발생: `.game-sync/baselines/caece146`(10-18 11:25) manifest가 supported=false·2608. 부수: fresh sync의 project.ground는 낡은 `map/velos.json`(60×60 잔디 3600칸)에서 와 캔버스가 실제 Velos 타일이 아닌 잔디를 보여준다(내보내기는 바이트 동일). 옵트인 테스트 velos 케이스 실패의 진짜 원인도 이것(assets regex 페른델 전용 + groundEditingSupported true 기대).
- 수정: 바닥 소재 등록 정보를 워크스페이스 체인 밖 정본으로 — (a) register-ground-resources 때 검증한 메타(256×128·pivot 0.5,0.5·PPU 100)를 맵별 바닥 소재 레지스트리(게임 repo에 커밋되는 파일, 예: palette_ruids_<map>.json에 dims/pivot 확장)에 기록하고 createSyncProject가 읽거나 (b) 게임 dump_group_ruids에 sprite 크기/피벗 포함. 둘 다 게임 합의 필요(§7 G24). 테스트는 velos를 '자원 타일 맵' 케이스로 분리.

### D5. 중간 — CLI/API 맵 이름 대소문자가 조용히 잘못된 기준·후보를 만든다 (C2의 상위)
- `core.cjs:31` validMapName은 정규식만, :327-332 readSnapshotSet은 Windows 대소문자 무시 FS에서 'Velosgreenroad'를 통과. 이후 모든 CSV 필터(core.cjs:371, runtime.cjs:38/67/69/80/108, walk-edits.cjs:51)가 `row.map === mapName` 정확 비교라 velosgreenroad 행이 전부 빠진다. `gameSync.ts:101` open/import도 정규식만(UI는 listGameMaps 파일명만 쓰므로 안전).
- 재현: `cli create --map Velosgreenroad` 성공 → blocked 0(실제 15), runtimeEditingSupported monsters/portals/spawn=false('현재 맵 경계가 없습니다'), walkEditingSupported=true(빈 집합끼리) → blocked 추가 후 export → 후보 DT_Walk에 `Velosgreenroad,2,2` 행 추가, 기존 15행은 '다른 맵 행'으로 보존, walkComparison currentMapCellsExact=true. 게임 `ObstacleManifestLogic.mlua:23` 정확 비교라 새 행은 영구 무시(`DATASET_SCHEMA.md:2030` "값은 소문자 — 대소문자 불일치가 이동불가 사고를 냈다"). 정렬 편집도 함께 있으면 depth_check가 TypeError(C2). 게임 lint KEY-MAPCASE가 적용 후엔 잡는다.
- 수정: `path.basename(realpathSync.native(...))`가 `mapName + '.map'`과 정확히 같지 않으면 INVALID_MAP(또는 디스크 이름으로 정규화), API open/import는 listGameMaps 포함 여부 검사. 게임 규약(DS-12 소문자)에 맞춰 비소문자 자체를 거부하는 것이 가장 단순.

### D6. 중간 — 몬스터 카탈로그가 디버그 전용 원본 행을 배치 가능하게 내놓는다
- 게임 정책 `DATASET_SCHEMA.md:726/746`: 원본 9SSV00은 "디버그 spawnnpc로만", 배치 1SSVNN이 콘텐츠용, lint 검사 38이 스폰 표의 원본 배치를 **WARN**(비차단). 런타임(MonsterSpawnCatalogLogic)은 OriginMonsterID를 읽지 않아 그대로 스폰. 이력상 909000(shade_boss_1)이 사람 손으로 실제 배치됐다가 교체된 전례.
- 에디터: `runtime.cjs:47` canAdd = ModelID·Idle SE RUID·BodyScale·BodyTint만(OriginMonsterID 미참조), :48 이름이 ST ko 우선이라 `#DevName`의 '(필드)/(보스방)' 구분이 사라짐. 실행: 카탈로그 43 중 원본 21개 전부 canAdd=true, 동명 쌍 21(잎새슬라임 901000/101000 … 웨어울프 910000/110000). 패널·스토어·validateMonster 모두 canAdd만 보므로 910000 추가 → 후보 DT_MonsterSpawn에 기록. 구형 블루프린트 경로(`sync-npcclass.mjs:114` seed + validate.ts 멤버십 + convert_map 멤버십)도 동일.
- 영향(검증자 실측): 21쌍 중 스탯·경험치·골드·드랍은 전부 동일하고 **AggroType만 5쌍**(901000·902000·904000·904100·905000 원본 Aggressive vs 배치 Passive) 다름 → 초보 필드에 선공 슬라임. 나머지 16쌍은 지금은 사본이나 원본 튜닝 시 갈라질 행이고 퀘스트 Hunt는 배치 ID 정확 일치라 원본 처치가 안 잡힌다.
- 수정: runtime.cjs required 열에 OriginMonsterID 추가, 다른 행의 OriginMonsterID로 참조되는 행(또는 /^9\d{5}$/, 테스트용볏단 10처럼 체계 밖은 참조 기준이 안전)은 canAdd=false + reason, 이름에 `#DevName` 병기. seed 생성도 `origin: true` 기록 후 EntityInspector에서 숨김/라벨.

### D7. 중간 (게임) — convert_map MONSTER_SPAWN_HEADER가 낡은 11열
- `convert_map.cjs:573` 헤더 `…,RespawnSec,Enabled,Scale,FlipX`(0c3de65f2 07-23 이후 불변) vs 라이브 13열 `…,RespawnMinSec,RespawnMaxSec,FirstSpawnSec,Enabled,Scale,FlipX`(31ed5b684 09-18). mergeMapScopedCsv :548-551 isPureAppend=false → 13열 헤더 유지 + 11값 행 패딩 → `RespawnMaxSec='True'`, `Enabled`=FlipX 값, `FlipX=''`. 실행 재현. 결과: FlipX 유실(실제 회귀), RespawnMaxSec에 비숫자 리터럴(Min 고정이라 거동은 저작 의도와 같음), FirstSpawnSec에 convScale(scale)이 들어가 scale 있는 json이면 첫 스폰 지연. 신규 맵·`--allow-legacy-rebuild`에서만(기존 맵은 가드). 테스트 convert_map.test.cjs:170·324가 구헤더를 하드코딩해 29/29 통과하며 가리고, lint에 수치 검사 없음. 같은 낡은 헤더 :519 spawnCsv.
- 수정: 13열로 갱신(respawnSec→RespawnMinSec, Max/First ''), '순수 append 아님'이면 throw, 테스트는 실제 DT_MonsterSpawn.csv 첫 줄과 헤더 일치 검사(§7 G22).

### D8. 낮음 — listCandidates가 이전 기준 후보를 현재 기준 manifest로 검증
- `core.cjs:1148-1152` 모든 후보의 applyFiles를 현재 기준의 datasetFiles/mapRelative로 재계산해 불일치면 skipped('식별 정보를 확인할 수 없는 N개 제외'), 반면 reviewCandidate(:1254)는 후보 자신의 기준으로. 게임이 CSV를 다른 폴더로 옮긴 뒤 새 기준을 만들면 그 CSV를 적용 파일로 가진 옛 후보가 목록에서 사라진다(재현; 직접 review하면 blocked로 열림). 중복 CSV는 AMBIGUOUS_RUNTIME_SOURCE로 기준 생성 자체가 막혀 해당 없음. 게임 CSV 이동은 8-22/27 두 번(에디터 첫 기준 이전) — 실데이터 미발현. 수정: recordedBaseline≠현재면 그 기준 manifest로 계산하거나 목록은 형식만 검사하고 '이전 기준(검토 필요)'로 노출, README:294-296 문구 정정.

### D9. 낮음 `[미커밋]` — npcclass.seed.json 낡음
- HEAD seed(847cf20, 09-26) 44종은 910000/110000(10-07)·910100/110100(10-10)·911000~912000·111000~112000(10-15)·913000~914000·113000~114000(10-17) 12종을 모른다. `sync-npcclass.mjs:61-66`은 게임 DataSet이 없으면 커밋 seed 유지 → 배포(vercel) 에디터의 블루프린트 경로에서 유효 ID 111000에 "NpcClassID 111000 — 카탈로그에 없음 … 게임 변환·빌드가 거부합니다" 오탐 confirm(게임 convert_map은 실제 CSV로 검증해 통과). 게임 동기화 경로는 무관(runtime.cjs가 게임 CSV 직접 읽음). 'NPC목록' CSV 로드는 세션 한정. 작업 트리 seed ↔ 게임 전수 대조 불일치 0 → 재생성본을 커밋하고, confirm 문구를 "에디터 카탈로그 기준"으로 완화.

### D10. 낮음 — validate.ts가 NpcClassID 종류를 안 본다
- `validate.ts:36-38` `npcClassIds.has(id)` 멤버십만(byId는 Npc·Monster 합본). 몬스터에 101(엘드릭)·NPC에 몬스터 ID를 넣어도 통과, 게임 `convert_map.cjs:367-370`은 kind별 테이블로 거부(실행: 에디터 1건 vs 변환기 3건 — validate.ts:13-14의 "1:1" 약속 깨짐). `EntityInspector.tsx:49` currentInCatalog도 type 무시. 블루프린트 저장/export 경로 한정(게임 동기화는 종류별 카탈로그). 수정: Map<number,NpcClassEntry>를 받아 `entry.type === (kind==='monster'?'Monster':'Npc')` 검사. 부수: `EXPORT_CONTRACT.md:88`이 monster/npc 모두 "DT_NpcClass에 존재"라 적혀 낡음.

### D11. 낮음 — Enabled 어휘 불일치
- `runtime.cjs:22` bool(): '0'→꺼짐·'1'→켜짐·''→켜짐, `npcs.cjs:38` truth(): '1'→켜짐·**빈칸→꺼짐**. 게임 `DataSetRepoLogic.mlua:91-101` BoolCell: 'true'/'false'만, 그 외·빈칸=기본값 **true**(MonsterSpawnCatalogLogic:104·PortalRegistryLogic:39). 손편집 Enabled='0' 포탈이 에디터에선 비활성으로 보여 PORTAL_OCCUPIED(:88)·BLOCKED_PORTAL·함정 경고(traps.cjs:38-39)에서 빠지고, :131 원문 보존으로 후보 ZIP에 '0'이 그대로 실려 게임은 켜진 채 받는다(같은 셀에 새 포탈 추가 → 게임 중복 출발 셀 에러 로그). npcs.cjs 쪽(검증 완료): 빈칸 Enabled NPC를 에디터는 꺼짐으로 보고 점유·미리보기·몬스터 빈 칸 계산에서 빼므로 같은 칸에 새 NPC 추가가 허용되는데, 게임은 한 Build 안에서 `used` 표로 칸 중복을 막고 에디터가 추가 행을 맵의 첫 행 앞에 끼우므로 **기존(빈칸=켜짐) NPC가 조용히 사라진다**; 켜진 NPC를 빈칸 NPC 칸으로 옮기면 반대로 옮긴 NPC가 사라져 미리보기와 정반대. 같은 truth()가 FlipX에도 쓰여 '1'은 게임(BoolCell default false)에서 반전 안 됨. 게임 오프라인 도구끼리도 미인식 값 해석이 갈린다(D13). 현재 CSV는 전부 'True'(에디터 출력도 'True'/'False' 고정)라 손편집에서만. 수정: 두 파일의 bool 어휘를 게임 BoolCell(true/false 대소문자 무시, 빈칸·미인식=열별 기본값: Enabled true·FlipX false)로 통일하고 그 외 값은 UNSUPPORTED로 거부.

### D12. 낮음 — 대사 그룹 지정이 화자·ID 규칙을 안 본다
- `npcs.cjs:69-70` DT_QuestSequence의 SequenceGroupID만 Set으로(SpeakerNpcClassID 미사용), :112 멤버십만, GameNpcPanel datalist 112개 전부 제시. 게임은 대화창 화자를 그룹 행 SpeakerNameKey로 그려(`QuestDialogUILogic.mlua:615`) 엘드릭 초상 + 로건 이름표가 한 창에 뜨고 로그도 없음. 게임 lint도 단일 FK뿐이라 게임 쪽 교차 검사가 1순위(§7 G25). 112 그룹 중 104는 퀘스트 흐름 대사라 화자만 맞춰도 '퀘스트 완료 대사'를 평시 대화로 지정 가능 → "퀘스트 표가 참조하지 않는 그룹"도 구분.
- ID 규칙: 에디터 `/^[A-Za-z0-9_-]{1,128}$/` vs 게임 IdCell(양의 정수·SequenceOrder>0). 'SHOP_INTRO'·'0'·'030020'·'01'·'1e3'은 에디터·lint FK 통과, 게임 HasGroup=false → NPC 클릭 무반응 + 서버 E 로그(SequenceOrder 빈 행은 QF-ORDER가 잡음). 현재 112 그룹 전부 양의 정수. 수정: dialogGroups 산출·비교·기록을 `/^[1-9]\d*$/` + 그룹에 SequenceOrder>0 행 존재 조건으로.

### D13. 낮음 (게임) — dataset-ref-lint 검사 40/48 Enabled 판정이 런타임과 모순
- `:2498`(검사 40 레벨대·종 중복)·`:3081`(검사 48 지도 마커) `!== 'true'`면 건너뜀(주석 "BoolCell과 같게 — True만 켜짐"은 처음부터 틀림), 검사 24/55·depth_check:250은 `!== 'false'`(런타임과 일치). 빈칸·'1'·'Yes' 행은 런타임 스폰인데 검사 40은 누락(레벨대 밖 배치 못 봄), 검사 48은 MAPMARKER-FALSE-MAP 오탐. DT_MonsterSpawn/NpcSpawn/Portal Enabled 어휘 lint 없음. 현재 데이터 전부 'True'. 수정: `!== 'false'`로 통일 + Enabled 어휘(True/False/빈칸) 검사 추가(§7 G21).

### D14. 중간 — 보스방 유일 출구 삭제·비활성이 에디터·게임 lint 모두 통과
- `runtime.cjs:82` removed는 존재만 확인하고 삭제(validatePortal은 updated/added만), 에디터에 OpenCondition 개념 없음(D2). 게임 `map-route-lint.cjs:50-53` ONE_WAY_OK에 'ferenforestrest>ferenforestshade'가 예외 등재돼 역방향 소실이 ONE-WAY로 안 잡히고, :136-145 BOSS-EXIT-OPEN은 남아 있는 행만 순회해 삭제된 행은 검사 대상이 없으며, :85는 Enabled=false 행을 읽기 단계에서 뺀다. dataset-ref-lint에도 "템플릿 맵 BossCleared 출구 ≥1" 검사 없음.
- 재현: 현재 게임으로 ferenforestshade 기준 생성 → P01(유일 출구 (9,4)→ferenforest4, BossCleared) removed → inspect OK(경고 0) → 후보 DT_Portal에 ferenforestshade 행 0개 → 스크래치 미러 map-route-lint PASS(53→52쌍 0 issue)·dataset-ref-lint 변화 없음. Enabled=False 갱신 경로도 동일 통과.
- 정정: 워크스페이스 ferenforestshade 초안의 removed=[P02,P01]은 옛 기준(10-07)의 되돌아가는 문(9,19)/(10,19)이고 게임 dd2feed6f가 같은 ID P01을 (9,4) 처치 출구로 재사용했으므로 "초안이 바로 이 조작"은 아니다(현재 기준으로는 INVALID_RUNTIME_EDIT로 막히고 재가져오기는 초안을 이월하지 않음). 결과도 영구 갇힘이 아니라 설계된 즉시 출구 상실 → 귀환·사망·10분 강제 퇴장(LingerPhase→EvictZone)으로 퇴화. 후보 적용 시 게임 map/ferenforestshade.json(openCondition 정본)은 P01을 유지해 json↔DT_Portal이 어긋나며 교차검사 없음.
- 수정: OpenCondition=BossCleared 행 또는 템플릿→비템플릿 마지막 enabled 포탈의 삭제·비활성 거절(또는 강한 경고). 게임에는 템플릿 맵마다 BossCleared 출구 ≥1 검사 + json↔DT_Portal 교차검사 요청(§7 G27).

### D15. 낮음 `[문서]` — 적용 절차에 게임 게이트 실행 단계가 없다
- README §6·§7(:255-297)은 해시 재검사·REVIEW.txt·"실제 반영·백업·복구·Maker 검증은 별도 작업"만 말하고 `node scripts/check-all.cjs`(dataset-ref-lint·map-route-lint·depth_check 전수)를 돌려 커밋하라는 단계가 없다. 에디터 repo의 절차 문서(README·HANDOFF)에 두 lint 언급 0건, 게임 EXPORT_CONTRACT에도 게이트 목록 없음. 게임 RULES §1.3 "CI 없음 — 커밋 전 check-all을 돌리는 개발자 한 번에 달렸다".
- 실사례: velos-a4c83910(10-18, velos→velosgreenroad 포탈 5행 추가·역방향 없음)을 부모 커밋 DataSet 위에 올리면 map-route-lint `[ONE-WAY]` FAIL(미러 실행) → a8bc6b416에서 도착 칸 5개 재지정 + 역방향 5행 수작업 추가로 해소. 후보는 맵 단위라 신규 연결의 역방향 포탈을 같은 후보에 담을 수 없어 새 맵 연결 후보는 구조적으로 ONE-WAY를 단독 통과 못한다.
- 수정: README §7 ZIP 단계 뒤에 "게임에 복사 → check-all(또는 세 스크립트) 통과 후 커밋" 명시, EXPORT_CONTRACT에도 같은 목록. 더 나아가 reviewCandidate에서 게임 scripts/·DataSet/·src/·docs/를 임시 폴더에 미러하고 후보 CSV를 덮어 두 lint를 실행해 REVIEW.txt에 싣는 것(이번 검증 방식 그대로, 네트워크 불요)이 D1~D3·D14 부류를 한 번에 닫는 길.

### ②에서 추가로 드러난 실사례(B1 보강)
- velos-a4c83910(10-18): 구울 당시 역방향 포탈이 없어 map-route-lint ONE-WAY FAIL이 될 후보였고, a8bc6b416에서 사람이 역방향·도착 칸을 손으로 보정. 10-13 DT_Portal 후보 6건·velosroad DT_Bounds 후보는 STALE성 FAIL(에디터 reviewCandidate가 '현재 게임 원본' 검사로 이미 차단함을 실행 확인). 합성 후보로 ONE-WAY·BOSS-EXIT-OPEN·SPAWN-BAND-MISSING/LEVEL·SPECIES-DUP·NPC-PORTAL-GUARD·MAPMETA-DIFFICULTY-ENTRANCE/ARRIVAL·MAPMETA-RETURN-CELL이 모두 "에디터 통과 → lint FAIL"로 재현됐다. 문제 없던 것: DialogID FK(에디터가 DT_QuestSequence로 검사), DT_Walk 19건·DT_NpcSpawn 4건·DT_MonsterSpawn 1건·DT_MapTrap 4건 실제 후보는 두 lint에서 새 FAIL 0, 에디터 ID 형식 `<map>_Editor_<uuid>`는 NAME-PK-DUP·KEY-MAPCASE·KEY-MAPSEP 통과.

### ③·⑥에서 문제 없던 것
- 23맵 depth_check 전부 EXIT 0(a8bc6b416), depth_check.test 41/41·cover_mask_gen.test 42/42·core.test 117/117. 작업트리 DT_Walk 3308±·DT_Portal 5±는 순수 재배열(행 집합 동일, 에디터 후보 산출물 아님), DT_Bounds/MapMeta/ST_MapName/SceneBgm +2는 미추적 velossilverforge·velosvelvet 행. 에디터 22 워크스페이스 inspect: 21 STALE(lock 13·json 6·.map 2) / 1 OK(velosgreenroad).
- 에디터 추가 CSV 행 ↔ 게임 소비: DT_MonsterSpawn Count/Spread/Respawn*/FirstSpawn 기본값·클램프 양쪽 일치, Scale ''은 아무도 안 읽음(MS-22), Enabled 'True'/'False'·DestFacing 4값·빈값 SE·DT_Bounds SpawnX/Y floor(+0.5)·DT_Walk 열 인덱스·DT_MapTrap #Memo — 전부 정합. seed 56종 ↔ 게임 CSV 불일치 0. 연동 모드에서 seed 기반 엔티티는 배치 불가(CanvasGrid 연동 분기)라 조용한 유실 없음. GameCandidatePanel/History/Comparison ↔ 서버 1:1(vitest 134/134), CLI outsideGame 가드, prune-sensitive-references 경로 필터·dry-run 0/0, compareEditedProject 삼자 정합.

---

## 7. 게임 repo 쪽에 전달할 사항

| # | 내용 | 관련 |
|---|---|---|
| G1 | 표적 패치 f1f0db99b(ferendelshop)·16b6772bb(ferendel/ferenforest)가 Position.z만 고치고 StaticZ를 안 고쳤다 — 자기 절차 문서(sortpad_census.cjs:40-42)와 불일치. 세 맵 StaticZ 표적 패치 + depth_check (1)에 StaticZ↔Position.z 대조 추가 | B2 |
| G2 | `depth_check.runCheck`에 portals/npcs override 추가(현재 blocked만, :870 한 곳에서 적재하므로 인자 하나로 (8)(9)(11) 전부 반영). ferendel 10-13 포탈 건이 이 공백의 실사례 | B1 |
| G3 | 에디터 오브젝트(`Obj_Editor_*`)의 z 드리프트를 검사 (1)이 못 본다 — 정규식 `/Obj_([0-9a-f]{8})/` 한정. 에디터 오브젝트에도 `z = objectDepthZ(pos.y)` 또는 StaticZ 대조를 적용할지 결정 | A1 |
| G4 | 락파일 `verifiedAdditions`는 소비처 없는 부가 키인데 값이 바뀔 때마다(10-15 1건→10-19 3건) 에디터 기준 전부를 무효화하고, `dump_group_ruids --lock`은 그 키를 버린다. 문서가 정한 `ruid-whitelist.json _verifiedBatch`로 이동 | A2 |
| G5 | −998(에디터 벽 장식 → 실사용은 바닥 데칼)·−997(velos 데크, 수동) 평면이 IsoProjectLogic에 정의 없음. BELOW와 ENTITY 사이 데칼 평면 상수 합의·build_map export + depth_check 허용 order 집합 검사 | B5 |
| G6 | surface 1×1 소품: sortpad_census 헤더·표적 패치 절차에 "z = 받침 z − 0.0001인 1×1을 함께 옮겨라" 누락. 서명 기반 인식 또는 EXPORT_CONTRACT에 받침 식별자 규약 | B4 |
| G7 | 메타 BaseW/BaseH 단위 검증 부재 — depth_check에 "마스크 표 PxW/64 ↔ BaseW" 참고 경고(벨로스 px/100 40개·greenroad 낡은 BaseW를 한꺼번에 잡음; 하드 검사는 bbox 저작 케이스 오탐) | B3 |
| G8 | dataset-ref-lint `CFG_RUID`에 PortalSpriteRuid 없음(DATASET_SCHEMA.md:1573 "CFG-RUID-FORM"과 불일치) | C10 |
| G9 | `.agents/skills/.../msw_map_builder.cjs`는 미추적 구판(DEFAULT_SPRITE_RUID 죽은 RUID 8ef238e0…, 단 ruid-whitelist.json:206에 올라 있어 lint가 못 거름) | C5 |
| G10 | `cover_mask_gen --verify`의 pivotIssue(727행) 제거 — 기록된 pivot 46행을 ✗로 세어 항상 exit 1. 주석 19-20·235-239, 설계 578행, RULES MS-25:357, depth_check:674, 테스트 321-328 갱신 | B10 |
| G11 | 기존 네이티브 맵에 `nocode_map --apply --build`를 지시하는 문서 9곳(EXPORT_CONTRACT:13·NOCODE_MAP_FLOW/USAGE·ADDING_NEW_MAP:263·VELOS_DECORATION_PREP:147·구현계획:174·NPC_SPAWN_PIPELINE_PLAN:186,237·BOSS_ROOM_S4:69) 정정, 가드 메시지의 `--allow-legacy-rebuild` 안내 제거 + 손실 경고, "기존 맵 json 비정본" 합의 문서화 | B7 |
| G12 | EXPORT_CONTRACT §1 앵커 규약·§5 평면 모델·depthW/H 누락·:53 예시, build_map.cjs:478-482 주석, 구현계획.md:36,66 | B8 |
| G13 | guide.md §2③·§2①②·§4①·§1② 상수표, IsoDepthMetaComponent.mlua:29 주석 | B9 |
| G14 | AnimationClip RUID 가림물(벨로스 분수) — 생성기 클립 분기 또는 D-OF 제외 결정, pivot 기록 공백 | B11 |
| G15 | depth_check (9) noMask를 fail에 반영(또는 `--dry-run` '+' 집계를 check-all에). 즉시: `--only-missing`으로 상선(19.79u)·그린로드 카운터 행 생성 | B12 |
| G16 | `DT_SpriteCoverMask.csv:37` b5cc544c 행이 낡음(R-6): 같은 RUID가 10-18 19:18 "VEL-HQ-VV 벨벗 상단 본부" 2580×2438로 재업로드됐는데 마스크는 옛 920×870 "가배치_일반민가" 이미지(Version 6ad2d591≠6ad49ce0). 오프라인 (9)는 폭을 1/2.8로 보고, 런타임은 옛 실루엣을 새 캔버스에 입힘. `--only-missing`은 낡은 행을 보존하므로 전량 재생성 필요 | B10·B12 |
| G17 | `depth-sprite-pivots.json` 파싱 실패 처리(C17), `depth_check.cjs:17` 헤더 (1) 설명 낡음, DATASET_SCHEMA DT_SpriteCoverMask 절·설계 §5.1 표(C21) | C17·C19·C21 |
| G18 | convert_map.cjs:233·sortPadX 요청서 §7.3의 "gameContractParity.test.ts" 전제 — 에디터에 없고 지목한 에디터 커밋 3abbb9e도 없음. 에디터 쪽 정렬(C18) 또는 문장 삭제 | C18 |
| G19 | `check-all`이 수동·CI 없음이라 A1 류 드리프트가 그대로 커밋될 수 있고(ferendel 10-15 e9da60ee1이 검사 실패 상태로 커밋된 전례), 설계 §6.3 "41 RUID 41프레임 ≈0.7초"는 벽시계 실측이 아니라 큐 길이 환산 — 0.1초/첫 조회가 맞다면 첫 방문 수 초(재측정 요청, 결함 아님) | A1·B1 |
| G20 | 검사 55 가드 칸 규칙·`ALLOW_NPC_ON_PORTAL_GUARD`·OpenCondition(어휘 BossRoomPolicyLogic OPEN_*)·D-BR42 도착 칸 공유가 EXPORT_CONTRACT §2·DATASET_SCHEMA DT_NpcSpawn 절에 없다 — 에디터가 미러할 계약을 문서에 올려 달라. lint 문구 "NPC를 옮겨라"는 포탈이 원인일 때 오안내 | D1·D2·D3 |
| G21 | dataset-ref-lint 검사 40(:2498)·48(:3081) Enabled 판정 `!== 'true'` → `!== 'false'`로 통일(주석 "BoolCell과 같게"는 틀림), DT_MonsterSpawn/NpcSpawn/Portal Enabled 어휘 검사 추가. check-all.cjs:139 라벨 "검사 1~52" 낡음 | D13·D11 |
| G22 | convert_map.cjs:573 MONSTER_SPAWN_HEADER 11열 → 라이브 13열, mergeMapScopedCsv '순수 append 아님'은 throw, 테스트 :170/:324 구헤더 픽스처 교체, :519 spawnCsv 동일 | D7 |
| G23 | 기본 맵 자신의 입구 포탈 도착 칸·자기 포탈 출발 칸을 DT_Walk가 막는 경우를 잡는 검사가 없다(MAPMETA-DIFFICULTY-ARRIVAL은 변형 맵만) | D3 |
| G24 | 바닥 소재 정본 부재: lock에 px/pivot 없음, palette_ruids_velos.json·tile_registry.json Velos 0건. 맵별 바닥 소재 레지스트리(dims/pivot 포함) 또는 dump_group_ruids에 크기/피벗 포함 합의 | D4 |
| G25 | DT_NpcSpawn.DialogID ↔ DT_QuestSequence 화자(SpeakerNpcClassID) 교차 검사·SequenceGroupID 정수 형식 검사가 lint에 없다(CSV 손편집도 같은 구멍) | D12 |
| G26 | (10-19 18:12 cf59737ea 이후 해소) map-route-lint HEAD는 PASS — 한때 ORPHAN-MAP 2건(velossilverforge·velosvelvet)으로 빨간 상태였다. check-all.cjs:139 라벨 "검사 1~52" 낡음 | D2 |
| G27 | 템플릿 맵마다 OpenCondition=BossCleared 출구 ≥1 검사 추가(ONE_WAY_OK 예외가 출구 존재를 가리지 않도록), map/<map>.json ↔ DT_Portal openCondition 교차검사, dataset-ref-lint 검사 55 판정 함수를 (portal rows, npc rows, deltas) 인자형으로 분리해 에디터가 후보 단계에서 재사용 가능하게 | D14·D1 |

---

## 8. 10-06 선행 리뷰 항목 현재 상태

| 항목 | 상태 | 근거 |
|---|---|---|
| 2-1 json/DT_Walk 분기(적용 후 재가져오기 영구 차단) | 고쳐짐·잔여 | core.cjs:369-373 DT_Walk에서 blocked 파생 + 게임 --allow-legacy-rebuild 가드. 잔여: 플래그 우회·낡은 문서·json 미갱신(B7), 범위 밖 셀(C1) |
| 2-2 lock 무관 리소스 삭제 → STALE | 고쳐졌으나 **다른 키로 재발·악화** | compatibleInventory가 참조 RUID만 비교하지만 메타 키 비교가 남아 A2(현재 21/22 차단) |
| 2-3 휠/blur 롤백 | 고쳐짐 | onWheel 카메라만, blur→finishGesture(lastPointer, true) |
| 2-4 가구 정렬 ↔ depth_check (1) | 부분 | validateSortingDepth 도입(27cfa3a). 단 범위가 sorting뿐(B1), 10-14 visualOffsets가 같은 구멍을 다시 엶(A1), −998 상수 미합의(B5) |
| 3-1 --hostname 403 | 고쳐짐 | package.json dev = `next dev --hostname 127.0.0.1`, hostname 'n' 허용 |
| 3-2 재로딩 중 브러시 | 대부분 고쳐짐 | status!=='error' 기준. PalettePanel:117 버튼만 잔여(C13) |
| 3-3 resetNonce 리마운트 | 고쳐짐 | documentNonce 분리 |
| 3-4 보이지 않는 배지 히트존 | 고쳐짐 | gameRuntimePreview.ts:263-268 labels/selected 조건 |
| 3-5 키 자동반복 | 고쳐짐 | e.repeat + 보조키 제외 |
| 3-6 hover 재그리기 | 부분 | setHover 중복 제거·정렬 memo(drawOrderCache). 셀 바뀔 때 재그리기는 남음(성능, 범위 밖) |
| 3-7 드롭다운 | 고쳐짐 | |
| 3-8 DT_ServerSecret 복사 | 고쳐짐 | REFERENCE_NAMES 16종만 + prune 스크립트 |
| F3 MapBuilder 사본 | 남음 | C5 |
| F4 CRLF .map 재작성 | 고쳐짐 | CRLF 복원 |
| F6/F7 동명 CSV·자유 텍스트 행 hard fail | 남음(코드 그대로) | |
| F8 p.map = mapName | 고쳐짐 | projectDefaults |
| F9 자원 누적 | 남음·악화 | C16 (.game-sync 1GB, 반제품 후보 11개 C3) |
| §5 항목 4 parity 테스트 부재 | 남음·악화 | C18 (산식이 실제로 갈림) |
| 드래그 z 소실(:122) | 남음 | C7 |
| 자동저장 중단(:138) | 남음 | C11 |
| Esc 다중선택(:131) | 남음 | C14 |
| −998 평면(:60) | 남음 | B5 |

---

## 9. 반박된 발견(참고 — 왜 아닌지)

| 발견 | 반박 근거 |
|---|---|
| velos.map −997 데크 3개가 '고아 평면' | 10-17→10-18 게임 쪽 수동 편집으로 데크를 물 패치(−998) 위에 올린 의도된 조치. 양쪽 도구 모두 문제 없이 처리. 정의 없는 평면이라는 점은 B5·G5에 포함 |
| 런타임 정렬 게이트가 중심 pivot을 가정해 바닥 pivot 여관이 틀어진다 | 기하 전제는 맞지만 게임이 이미 알고 inFootprint OR 항으로 보완(IsoPlayerDepthLogic:400-412). 23개 맵 18.7만 표본 전수 비교에서 가시 차이 0~3건(마름모 꼭짓점 스침). 제안한 '그림 기준 게이트'로 바꾸면 ironhallmine 벽·ferendel 다리에서 오히려 회귀 |
| actor-depth가 depth_check만 캐시 무효화해 build_map 상수가 낡는다 | core.cjs loadDependencies가 매 미리보기마다 build_map.cjs를 먼저 재로드하고 depth_check 재평가가 그 인스턴스에 묶임(실행 확인). 상수 불일치는 STALE_SOURCE로 먼저 막힘 |
| 스토리지 pivot ≠ .mod 네이티브일 때 엔진이 어느 쪽인지 실측 근거 없음 | 게임팀 8/12 측정(PART_ANCHOR_V2.md:134-139 Q9)·9/05 무기 pivot 전환·10월 Maker 실측 전부 "엔진 = 스토리지 속성". 계약도 cover_mask_gen effectivePivot·설계 §196-199에 명문화 |
| 엔진 `sp.Pivot`이 nil이면 SpriteBoundsCatalogLogic이 (0.5,0)으로 후퇴해 벨로스 23개가 반 높이 어긋난다 | `Environment/NativeScripts/Misc/Sprite.d.mlua:26-32`가 Pivot을 값형 Vector2 배치 피벗으로 선언(nil 주석 없음), .mod 필드 4에 (0.5,0.5) 실재, 7/14-15 인게임 실측으로 속성 없는 스프라이트 = 네이티브 중심 배치 확정, ChatBalloon/EmotionBubble이 가드 없이 Pivot 역참조. (0.5,0) 폴백은 단위시험 목(mock)용. 남는 것은 설계 §5.2에 근거 한 줄 적는 것뿐 |
| 정상 적용된 후보가 재검토·재ZIP에서 blocked | README 7차에 명시된 계약(적용 = 게임 원본 변경). 설계 경로는 previousProject 재가져오기 → 재출력이며 실데이터도 그대로 |
| map json 해시 엄격 + 초안 미이월로 json 커밋만으로 초안이 막힌다 | json은 게임 저작 정본(.map·DT_Walk·DT_Portal의 원천)이라 엄격 판정은 타당하고 테스트 고정. 실데이터 "json 원인 STALE 6개"는 verifySources 정렬 순서의 착시로 전부 lock/.map도 동시 STALE. 제안한 완화 규칙으로도 0개 풀리고, 자동 rebase는 ferenforestshade에서 게임이 id를 재사용한 새 BossCleared 출구를 지우는 잘못된 결과를 냄. 10-06 2-2 기지 사항 |
| 타일 카탈로그 전체 동일성(:246)이 변형 하나 추가에도 전 기준을 막는다 | 의도된 설계로 테스트(core.test.cjs:1464 "new tiles still block") 고정, 출력은 manifest.catalog로 패킹해 잘못된 출력 없음. 실데이터 92개 기준 중 :246이 판정을 가른 건 0건 — 전부 :237 메타데이터(A2)에서 탈락 |
| depth_check 테스트 (9)가 pivots를 안 넘긴다 | a8bc6b416에서 수정됨(§5) |
| 생성기가 .mod 선언 크기(필드 1/2)≠PNG 캔버스를 검사하지 않아 벨로스 3 RUID가 2.8배 어긋난다 | 2.8배의 원인은 생성기 검사 누락이 아니라 재업로드 뒤 낡은 행(R-6, G16). 당시 버전은 선언 크기=캔버스=920×870이라 검사가 있었어도 통과. VEL-HQ-GR/SF는 BaseW가 불투명 bbox/64로 저작된 것이라 어느 쪽도 틀리지 않음. PPU≠100 거부 제안은 정상 스프라이트의 페이드를 잃게 함 |
| px/100 추가 결과 — 저관목 1개 후보 탈락·질의창이 좁아 나무 가장자리 띠에서 페이드 안 걸림 | 수치는 재현되나 몸통이 덮이는 발 위치가 전부 DT_Walk 차단 칸이고, 창 밖 띠 7개 중 6개는 마스크 투명·1개는 차단 칸. 단위를 px/64로 바로잡으면 전 맵 창 밖 0 — pivot 비대칭 단독으로는 어느 객체도 초과하지 않음(최소 여유 0.149u). 유용한 잔여는 G7 |
| 벨로스 데우기 예산(31 RUID)으로 맵 진입 뒤 수 초 페이드 공백 | 큐는 x 오름차순이라 도착 포탈(서쪽) 근처 가림물이 #5~#12로 먼저 데워지고, 여관은 모든 도착 칸에서 22~27칸(≥8.8초) 거리인데 #19(≈0.32초, 정지 가정 ≈2초)에 준비. 0.1초/첫 조회는 NPC 클립 수치의 외삽이지 맵 오브젝트 실측 아님. 설계 R-10이 수용한 트레이드오프 |
| 아트 Z가이드 "exporter 검사" — 실데이터 velos-a4c83910 (9) 위반이 'unchanged'로 통과 | 그 위반은 후보가 아니라 기준 스냅샷에 이미 있던 빚(occlFresh 1→1)이라 게이트가 돌았어도 passed, 포탈 행은 10-15 커밋분, a8bc6b416에서 해소. 구조적 지적은 B1에 합치고 진짜 실사례(ferendel 10-13 포탈)는 B1에 반영, 문서 과장은 C24 |
| 기준에 게임 git 상태가 없고 listGameMaps가 미추적 맵도 올려 velos 기준이 어느 커밋에도 없는 velos.map 위에 떠 있다 | 그 바이트는 기준 스냅샷과 후보 velos-7269ab38 출력에 그대로 보관돼 있고(10-18 후보 적용 체인의 정상 흔적), 그 위의 후보는 reviewCandidate가 blocked 처리해 ZIP으로 못 나간다. 게임 계약에 커밋 요구 없음, 미추적 맵 목록화는 신규 맵 저작에 필요한 동작 |
| '원본과 비교'가 기준 vs 초안이라 STALE 뒤엔 적용 후 확인 용도로 못 쓴다 | README:213-218이 명시한 설계이고 core.test:818이 고정. 적용 후 '현재 게임 == 후보' 바이트 확인은 후보 검토 창의 SHA-256(currentSourceSha256/candidateSha256)으로 이미 가능 |
| 가드 칸 회귀 테스트가 에디터 테스트 3종에 없다 | 존재하지 않는 검사(D1)의 테스트 부재는 독립 결함이 아니라 D1 수정과 함께 쓰일 것. 게임 계약은 에디터에 이 검사를 요구하지 않음 |
| OpenCondition 열이 없는 9열 DT_Portal 후보 68개가 디스크에 남아 적용 시 BossCleared가 사라진다 | 68개 중 62개는 reference/ 참고 사본(ZIP 미포함), 적용 경로 9열 후보 6개는 전부 reviewCandidate '현재 게임 원본' 불일치로 blocked → packageCandidate CANDIDATE_BLOCKED(실행 확인). 손으로 복사해도 map-route-lint BOSS-EXIT-OPEN 6건 FAIL. 수치·결과 서술 모두 틀림 |

---

## 10. 확인했으나 문제 없던 것(요약)

- IsoDepthMeta 필드 의미·단위: GX/GY 최소코너, W/H, BaseW(중앙 피벗) px/64, ScaleX/Y abs, SortPadX, StaticOrder=OrderInLayer — build_map·IsoDepthMetaComponent와 일치. 이동·복제 z = 원 z + Δy×DEPTH_SCALE로 objectDepthZ 불변식 유지(288/288).
- surface z = 받침 z − 0.0001: 런타임 Z_EPSILON 0.001·CLAMP_SPREAD_Z 0.012·Front/BackMargin 안쪽, float32 ulp의 50배 → 의도대로.
- CSV 후보 6종: BOM·줄끝·끝 개행·따옴표·열 집합 보존, 다른 맵 행 raw byte 대조, DT_MapTrap 열명 = MapTrapCatalogLogic need 목록, 실파일 7종 BOM+CRLF와 파서 전제 일치.
- .map 보존 검증: 보호 엔티티 stable() 2회 대조·CRLF 복원·최상위 필드 패스스루.
- cab287a88 ↔ 40f1fa7 blocked override 형식 일치(set 키 'x,y'·Set·맵명 — 대소문자만 C2).
- 서버 API 입력 검증(mapName/UUID 정규식, safeChild/outsideGame/정션 차단)·로컬 전용 가드(Host 루프백·Origin·hostname) — 경로 탐색 없음. saveWorkspace revision CAS·클라 직렬 큐 정합.
- 미리보기 행렬(pivot·PPU·회전·flip×음수 scale 상쇄)·정렬 규칙(orderInLayer→z→sourceOrder)·NPC 외형(±BodyScale·셀 중심·이름표 3.03)·포탈 z(DepthZ+0.153 미러)·액터 깊이 입력 — 게임과 동형(vitest 50건·기준선 실행으로 확인).
- OccluderFade·CollectBehind ε와 surface ε·depthOffset 상호작용 없음. 런타임 pivot은 엔진 메타로 자기정합.
- 미커밋 바닥 소재 등록 경로(loadGroundCatalog 256×128·중앙 피벗·PPU 100 fail-closed), animationclip 등록, 로컬 런처, load-core 핫리로드: 정합. tsc·vitest 72/72·core.test 117/117·cover_mask_gen.test 42/42·depth_check.test 41/41(HEAD) 통과.
- 10-18 신규 코드(관점 F): native 후보 필터 == 런타임 Load, spriteRect pivot·mirrored == SpanL/SpanR·CoversAt, 썸네일/.mod UV 규약 동일, `--only-missing` 기존 73행 바이트 보존(화분 6행은 부모가 이미 비정렬), loadMasks 중복 규칙 == 런타임, pivot 우선순위(storage→native) == 에디터 parseSpriteMod == 게임 실측.
- 게임 legacy-map-write-guard: build_map 2회·convert_map applyTo* 전부·nocode_map(--force 무시)에서 NATIVE_MAP_PROTECTED, 테스트 3건 고정.

---

## 11. 검증 상태

모든 항목이 반박자(코드 추적·재현)와 계약 심판(게임 repo 대조)을 통과했고, 1차 높음 발견은 영향 심판(실데이터 집계)까지 거쳤다. 재실행으로 판정이 채워진 2차 발견 10건의 귀결: 귀환 셀 차단(→D3), 보스 출구 삭제(→D14), npcs.cjs Enabled 빈칸(→D11), OpenCondition ''·안전한 문 안내(→D2 부수), 검사 55 ALLOW 통로·계약 문서(→G20·G27), README 게이트 단계(→D15), 함정 size vs DT_Bounds(→C12, 2차 검증도 확인), 통합 테스트 드리프트 케이스·대사 그룹 56(→C6 ④·②, 2차 검증도 확인). 반박 2건(가드 테스트 부재·9열 후보 68개)은 §9.

검증자들이 공통으로 지적한 서술 보정은 본문에 반영했다: 게임 게이트는 훅·CI가 아닌 수동 `check-all`(건너뛰면 런타임까지 간다), 게임 HEAD는 리뷰 도중 a8bc6b416(11:24)·cf59737ea(18:12)로 두 번 바뀌어 velos.map·velossilverforge/velosvelvet.map이 추적됨, "미커밋 velos.map" 전제 발견은 전부 HEAD 기준으로 다시 썼다.

## 12. 수정 현황 (2026-10-19 저녁, 에디터 repo · 미커밋)

에디터 작업 트리에서 아래를 고쳤다. 아스트라의 미커밋 변경(16:21) 위에 얹혀 있고 커밋·푸시는 하지 않았다. 게임 repo는 건드리지 않았다.
검증: `node --test scripts/game-sync/core.test.cjs` 130/130 · `npx vitest run` 582 통과(38 옵트인 생략) · `tsc --noEmit` · `eslint .` 통과.
실데이터: 39개 워크스페이스 읽기 전용 점검에서 새로 실패하는 곳 없음(STALE 7개는 게임 원본 변경). ferendelshop·velosgreenroad를 스크래치에 새로 가져와 오브젝트 이동 후보를 만들어 실제 게임 depth_check가 통과하는 것까지 확인.

| ID | 처리 |
|---|---|
| A1 | 이미지 미세 조정의 세로 이동만큼 z(=StaticZ 기록)도 이동, 가구 위 소품은 받침 최종 z 바로 앞으로 재고정. 클라 stale 판정 식도 같이 변경 |
| A2 | 락파일 비교를 groupCode만으로(verifiedAdditions 등 장부 키 무시) |
| A3 | 이전 기준 바닥 소재 이어받기를 실패해도 가져오기는 진행, 경고만 |
| D1 | 포탈 입구 칸(포탈 칸+상하좌우)에 활성 NPC를 두는 새 편집을 서버·클라 양쪽에서 거부(검사 55) |
| B1 | 깊이 게이트를 오브젝트·이동불가 편집 전체로 확대, 교차모순 카운터 추가, occlStale/bndHot은 경고, 무편집은 `skipped`. (게임 depth_check가 후보 CSV 대신 게임 현재 DT_Portal/NpcSpawn을 읽는 부분은 게임 쪽 과제로 남음) |
| C3 | export 실패 시 후보 폴더 삭제 |
| C2·D5 | 맵 이름 대소문자가 게임 파일과 다르면 `MAP_NAME_CASE`로 거부 |
| D2·D14 | DT_MapMeta를 읽어 보스 구역에서 존 밖으로 나가는 새·수정 포탈은 OpenCondition=BossCleared로 기록, 마지막 처치 출구 삭제·끄기는 `BOSS_EXIT_REQUIRED`로 거부 |
| D3 | 새로 막는 칸이 들어오는 포탈 도착 칸(난이도 변형의 기본 맵 입구 포함)·포탈 출발 칸·시작점·부활/귀환 지점이면 `BLOCKED_ARRIVAL` |
| D6 | OriginMonsterID로 참조되는 원본 몬스터는 배치 불가 + 이름에 '원본' 표시, 블루프린트 seed도 '(원본·디버그 전용)' 라벨 |
| D11 | Enabled/FlipX를 게임 BoolCell과 같게(true/false만, 나머지는 기본값) |
| B2 | StaticZ≠z는 보호 사유에서 제외(`staleStaticZ` 표시만), 편집 시 StaticZ 재기록 |
| B3·C4 | 패널 bounds 식을 피벗 무관 px/ppu/0.64로, 서버는 소재 크기 대비 1/1.5 미만 bounds 거부 |
| B6 | 이미지 캐시를 60초마다 메타만 조회(`metaOnly`)해 버전·내용·피벗이 바뀐 RUID만 다시 받음 |
| C1 | json 없는 맵은 `MAP_JSON_MISSING`, 맵 밖 DT_Walk 칸은 좌표와 크기를 적은 메시지 |
| C11 | 자동저장 실패 후 지수 백오프 재시도(409 충돌 제외) |
| C13 | 서버 소재 추가 버튼을 재컴파일 중에도 사용 가능 |
| C14 | Esc는 선택·배치만 해제하고 여러 개 선택·이동불가 칸 모드는 유지 |
| C15 | 바닥/오브젝트 소재 일괄 추가 시 맞지 않는 항목을 이름·실제 규격과 함께 모두 알림 |
| D8 | 후보 목록이 후보 자신의 기준 manifest로 적용 파일을 확인 |
| D10 | 블루프린트 검증·인스펙터가 NpcClassID 종류(Npc/Monster)까지 확인 |
| D12 | 대사 그룹은 양의 정수 ID + 순서 있는 행만, 화자가 다르면 경고 |
| D15·C20·C23 | README에 게임 check-all 실행 단계·6종 적용 파일·서버 바닥 소재 규칙 추가 |
| C19·C22 | DEPTH_SORT.md·entityGeom 주석의 죽은 계약 링크·낡은 식 정정, README 상단 링크를 게임 repo 경로로, HANDOFF에 낡음 표시 |

남은 것: 게임 쪽 §7 전부(B7~B12·C17·C21·D7·D13 포함), 합의가 필요한 B4(받침 연결 기록)·B5(−998 평면)·D4(벨로스 바닥 등록), 그리고 C5·C6·C7·C8·C9·C10·C12·C16·C18·C24(아트 가이드는 이 repo 밖). D9는 재생성된 seed를 커밋하면 해소.
