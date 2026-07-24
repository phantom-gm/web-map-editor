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

## 잠겨 있는 테스트

- `src/__tests__/entityGeom.test.ts` — `gameDepthZ` 가 위 식과 같은지 (4개 과거 버그 회귀 가드)
- `src/__tests__/entityDrawOrder.test.ts` — 멀티셀 점유 위 엔티티가 위로 오는지
- 게임 쪽 `scripts/depth_check.cjs` 검사 (6) — 실맵 전 오브젝트의 baked z 파리티
