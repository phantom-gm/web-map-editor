# 깊이정렬(앞/뒤) — 에디터 쪽 요약

> **정본은 게임 프로젝트에 있다:**
> `legend_of_light/docs/map/isometric/DEPTH_SORT_CONTRACT.md`
> 규칙을 바꾸려면 거기부터 고치고, 아래 두 구현과 두 테스트를 **한 커밋에서 같이** 바꾼다.

## 유일한 깊이식

```
z = −(gx + gy) × 0.14  −  offsetY_px × PX_TO_WORLD  −  sortOffset × 0.14      (작을수록 앞)
```

- 구현: [`src/lib/entityGeom.ts`](src/lib/entityGeom.ts) `gameDepthZ()`
- 게임 원본: `legend_of_light/scripts/build_map.cjs:392` (`z = pos.y − extra × CELL_DEPTH`)
- **`sortOffset` 1 = 정확히 한 칸.** `gy+1` 로 옮긴 것과 z 가 완전히 같다.

## 이 식에 넣지 말 것

`tilesW`/`tilesH`(앵커가 이미 앞-아래 tip), `baseW`/`baseH`, footprint 중심·앞줄.
넷 다 과거에 넣었다가 사고가 났다(정본 §9).

## 밴드가 z 보다 먼저

`layer` = `below`(−999) < `auto`(기본) < `above`(4000). 밴드가 다르면 z 는 비교되지 않는다.

## 캐릭터만 예외

플레이어·몬스터·NPC 는 게임 런타임이 매 프레임 z 를 보정한다(큰 건물 안을 걸어다녀야 하므로).
에디터는 `sortEntitiesForDraw()` 에서 같은 시각을 재현한다. **오브젝트끼리는 순수 z 뿐이다** —
게임에도 오브젝트용 런타임 보정이 없다.

**포탈도 예외다(2026-09-14, PD-1).** 게임은 포탈을 ENTITY 평면에 두고 액터와 **같은 rect 규칙**으로 z 를 풀되, 기준점을 마름모
맨 뒤 꼭짓점(한 칸 뒤)에 두고 풀이 뒤 한 눈금(ε)을 더한다 → 그 칸의 어떤 액터보다 뒤, 그 칸을 점유한 건물보다 앞. 에디터의
"rect 안 비-object 는 반 칸 앞" 규칙이 이미 같은 시각을 보여 준다. ⚠ 배치 전제 — 포탈을 건물 rect 의 **북쪽 행·서쪽 열**에
두지 말 것(게임 `depth_check` 검사 (8) 이 막는다). 정본: `legend_of_light/docs/map/depth/포탈_렌더순서_개선_설계.md` §3.1·§5.1.

## 1×1 오브젝트는 바닥선이 곧 순서다 (2026-09-26, MS-26)

위 식에서 `offsetY_px` 는 스프라이트가 그려지는 **바닥선**을 아래로 내린다 — z 도 같이 내려간다. 1×1 오브젝트는 게임 런타임
보정이 없어(멀티셀만 클램프) 이 바닥선이 화면 순서 그 자체다. 액터의 z 는 발 y 이므로, 바닥선이 **남쪽 이웃 칸**(`gx+1` 또는
`gy+1`, 셀 중심에서 16px = TH/2 아래) 의 중심 아래로 내려가면 그 칸에 선 몬스터·NPC·다른 플레이어가 오브젝트 뒤로 간다.
페른델 가로등 12개(offsetY 17px)가 그랬다.

| offsetY | 앞 칸 여유 | 에디터 | 게임 `depth_check` 검사 (10) |
|---|---|---|---|
| ≤ 13px | ≥ 3px | 정상 | 통과 |
| 14~15px | 1~2px | **경고**(주황 ▼ 배지) | 관찰만 |
| ≥ 16px | ≤ 0 | **차단 표시**(빨강 ▼ 배지, export 검증 "•") | 위반 — exit 1(동결 목록 밖) |

권장값은 **11px**. 판정은 [`src/lib/southIntrusion.ts`](src/lib/southIntrusion.ts) 한 곳이 소유하고, 캔버스 배지·선택 시
**정렬 바닥선**(가로선 + 이웃 중심 점선)·인스펙터 경고(권장값 버튼)·상태바 건수·export 검증이 전부 그것을 부른다.
"설 수 없는 칸"(이동불가 칠 + 충돌 오브젝트 footprint, 포탈 칸 제외)은 export 가 DT_Walk 로 굽는 것과 같은 재료다 — 맵 밖 이웃도
설 수 있다고 보는 관대함까지 게임 게이트와 같다(다르면 "에디터 통과·빌드 실패"가 생긴다).

⚠ z 를 셀 기준으로 바꾸는 요청은 하지 않는다 — 게임이 셀 중심·발자국 tip 앵커를 시도했다가 신고 3건으로 폐기했다. 처방은 저작이다.
같은 RUID 를 새로 놓으면 마지막 저작값(offset·배율·기울기·점유·충돌·레이어)이 기본으로 채워진다(`objectDefaults`, 세션 한정 +
같은 맵의 마지막 오브젝트 폴백) — 한 번 정한 값이 맵 전체에 일관되게 퍼지게. 요청서:
`legend_of_light/docs/map/depth/260926_웹맵에디터_1x1_오브젝트_offset_요청.md`.

## 잠겨 있는 테스트

- `src/__tests__/southIntrusion.test.ts` — 임계값(13/14~15/16)·대상(1×1 auto)·설 수 없는 칸·맵 밖 이웃 관대함
- `src/__tests__/objectDefaults.test.ts` — RUID 별 마지막 저작값 기본 채움(옮기지 않는 필드 포함)

- `src/__tests__/entityGeom.test.ts` — `gameDepthZ` 가 위 식과 같은지 (4개 과거 버그 회귀 가드)
- `src/__tests__/entityDrawOrder.test.ts` — 멀티셀 점유 위 엔티티가 위로 오는지
- 게임 쪽 `scripts/depth_check.cjs` 검사 (6) — 실맵 전 오브젝트의 baked z 파리티
