# 웹 맵 에디터 — 폴더 팔레트 · 오브젝트 에셋 · 실(實)업로드 설계

> 대상 코드: `/Users/soobinim/Documents/project/msw/web-map-editor`
> 작성일: 2026-06-29
> 스택: Next.js 14 (App Router) · React 18 · Zustand 4 · Canvas 2D · MCP(Nexon 자산 서버)

이 문서는 다음 3개 기능의 설계와 파일 단위 변경안을 정의한다.

1. **폴더 팔레트 업로드** — PNG 한 장씩이 아니라 **폴더를 선택하면 그 안의 PNG가 한 번에** 팔레트로 올라간다.
2. **오브젝트 에셋** — 타일 외에 **배치 가능한 오브젝트**를 업로드/팔레트화하고 맵에 자유 위치로 배치한다.
3. **실(實)업로드** — 업로드가 "단발성(세션 한정/미검증)"이 아니라 **실제로 영속**되도록 한다.

---

## 0. 현재 구조 요약 (변경 전 기준선)

| 영역 | 현재 동작 | 관련 파일 |
| --- | --- | --- |
| 팔레트 로드 | `<input type="file" multiple accept="image/*">` 로 PNG 다중 선택 → `loadTiles()` → `addTiles()` | `src/components/PalettePanel.tsx:115`, `src/lib/palette.ts:50` |
| 팔레트 모델 | `PaletteTile{ name, url(dataURL), img, hash, ruid?, regStatus? }` 평면 배열, 페인팅은 `paletteIdx`(배열 위치) 기준 | `src/lib/palette.ts:5`, `src/store/editorStore.ts:59` |
| 편집 레이어 | `ground: Map<CellKey, paletteIdx>`(타일), `blocked: Set<CellKey>`(이동불가) 2종 | `src/store/editorStore.ts:51` |
| 업로드 | `POST /api/upload` → MCP `createSpriteResource`(presigned PUT 2-step) → RUID → 레지스트리 append | `app/api/upload/route.ts`, `src/server/mswMcp.ts:62` |
| 레지스트리 영속 | KV 환경변수 있으면 `KvStore`, 없으면 `MemoryStore`(프로세스 재시작 시 소실) | `src/server/registryStore.ts:31` |
| 인증 | `/api/*` 에 `x-editor-secret` 공유 시크릿 게이트 | `middleware.ts` |
| Export | `Blueprint{ GroundTileMap, StaticTileMap, TileAttributeTileMap }` — Static 은 verbatim 보존 | `src/types/blueprint.ts`, `src/lib/blueprintIO.ts` |

**"단발성" 문제의 실체** (기능3 배경):
- MCP 업로드 경로(`mswMcp.ts:62`)는 주석에 `⚠ 신규 업로드 실경로는 외부 동작 — 첫 실호출 시 응답 필드명 검증 필요`로 **미검증** 상태.
- 레지스트리는 기본 `MemoryStore` → 서버리스/재시작에서 `appendMany` 결과가 **휘발**. 같은 PNG를 다시 올리면 또 "신규"로 보임.
- 즉 업로드가 *로컬 세션 안에서만* 반영되고 **재방문 시 사라지는** 것처럼 보이는 게 핵심 불만.

---

## 1. 기능 1 — 폴더 팔레트 업로드

### 목표
폴더 선택 한 번으로 그 폴더(및 하위 폴더)의 모든 PNG를 팔레트에 올린다. 기존 "PNG 다중 선택"도 유지한다.

### 설계
브라우저 표준 `webkitdirectory` 속성을 쓴다. 별도 라이브러리 불필요.

- `<input type="file" webkitdirectory>` 로 폴더 선택 시 `e.target.files` 에 **하위 모든 파일**이 평탄화되어 들어온다(각 `File.webkitRelativePath` 에 폴더 경로 포함).
- 이미지가 아닌 파일은 기존 `loadTiles()` 가 `if (!f.type.startsWith("image/")) continue;` (`palette.ts:53`)로 이미 거른다 → 폴더에 잡파일이 섞여도 안전.
- 정렬: 폴더 선택은 OS 순서가 비결정적이므로 `webkitRelativePath`(없으면 `name`) 기준 **자연 정렬**해 팔레트 인덱스를 안정화한다(블루프린트의 `paletteIdx` 재현성에 중요).
- 대량 로드 대비: `loadTiles` 가 현재 순차 `await` 이므로 수백 장에서 느릴 수 있다 → **진행 표시**(`n/total`)와 **동시성 제한 병렬화**(예: 8 워커)로 개선.

### UI
`PalettePanel` 헤드에 버튼 2개:
- `+ PNG` (기존, 파일 다중)
- `+ 폴더` (신규, `webkitdirectory`)

```tsx
// PalettePanel.tsx — 헤드 영역
<button onClick={() => fileRef.current?.click()}>+ PNG</button>
<button onClick={() => dirRef.current?.click()}>+ 폴더</button>
<input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
{/* webkitdirectory 는 React 타입에 없어 ref 로 부여하거나 {...{webkitdirectory:""}} 캐스팅 */}
<input ref={dirRef} type="file" multiple hidden onChange={onFiles} />
```

```tsx
// webkitdirectory 부여 (타입 우회)
useEffect(() => {
  if (dirRef.current) {
    dirRef.current.setAttribute("webkitdirectory", "");
    dirRef.current.setAttribute("directory", "");
  }
}, []);
```

`onFiles` 는 폴더/파일 공용으로 쓰되, 정렬만 추가:

```tsx
const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = Array.from(e.target.files ?? []);
  e.target.value = "";
  if (files.length === 0) return;
  files.sort((a, b) =>
    (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true }),
  );
  setBusy("load");
  try {
    const tiles = await loadTiles(files, (done, total) => setProgress({ done, total }));
    addTiles(tiles); // 또는 오브젝트 탭이면 addObjects(tiles)
  } finally {
    setBusy(""); setProgress(null);
  }
};
```

### 변경 파일
- `src/components/PalettePanel.tsx` — `+ 폴더` 버튼/인풋, 정렬, 진행 표시.
- `src/lib/palette.ts` — `loadTiles(files, onProgress?)` 에 진행 콜백 + 동시성 제한 병렬 로드(선택적 최적화).

### 비고/리스크
- `webkitdirectory` 는 Chrome/Edge/Safari/Firefox 데스크톱 지원(이 도구의 사용 환경). 모바일 비대상.
- 중복 이름 처리: 같은 `name` PNG가 여러 폴더에 있으면 둘 다 팔레트에 들어간다. 레지스트리 매칭은 name+hash 기준이라 **동명 다른 내용**은 `conflict` 배지로 노출됨(기존 로직 그대로). 필요 시 폴더경로를 prefix 한 이름 옵션을 추후 검토.

---

## 2. 기능 2 — 오브젝트 에셋 (배치 가능한 오브젝트)

### 목표
타일(그리드 셀에 칠하는 바닥)과 **별개로**, 오브젝트(나무/바위/구조물 등)를 **자유 위치에 인스턴스로 배치**한다. 오브젝트는 별도 팔레트, 별도 레이어, 별도 export 로 관리한다.

### 2.1 데이터 모델

오브젝트 팔레트는 타일 팔레트와 같은 `PaletteTile` 구조를 재사용하되 **별도 배열**로 둔다. 배치 인스턴스는 신규 타입.

```ts
// src/types/object.ts (신규)
export interface MapObject {
  id: string;            // 인스턴스 고유 id (배치 시 생성)
  paletteIdx: number;    // objectPalette 배열 인덱스
  gx: number;            // 셀 좌표(연속 실수 허용 → 자유 배치) 또는 정수(셀 스냅)
  gy: number;
  // 선택 속성(후속 확장): rotation, scale, z(정렬), flipX
}
```

> **좌표 정밀도 결정**: MVP 는 **셀 스냅(정수 gx,gy)** 으로 시작하되, 모델은 실수 허용으로 두어 후속 "자유 미세배치"를 열어둔다. 렌더는 아이소 변환 `gridToScreen`(`src/lib/grid.ts`) 재사용 + 오브젝트 스프라이트는 셀 바닥 기준 **앵커(하단 중앙)** 정렬.

### 2.2 Zustand 스토어 확장 (`src/store/editorStore.ts`)

```ts
export type Layer2 = "tile" | "object";   // 현재 작업 대상 레이어(팔레트 탭)

interface EditorState {
  // ... 기존 ...
  objectPalette: PaletteTile[];      // 오브젝트 팔레트(타일과 분리)
  objects: MapObject[];              // 배치된 오브젝트 인스턴스
  objectsVer: number;                // 리렌더 트리거(ground/blockedVer 와 동일 패턴)
  activeLayer: Layer2;               // "tile" | "object" — 팔레트/도구 컨텍스트
  activeObjectIdx: number;           // 선택된 오브젝트 팔레트 인덱스
  selectedObjectId: string | null;   // 캔버스에서 선택된 인스턴스(이동/삭제용)

  addObjects: (tiles: PaletteTile[]) => void;
  placeObject: (gx: number, gy: number) => void;     // activeObjectIdx 를 해당 위치에 인스턴스화
  moveObject: (id: string, gx: number, gy: number) => void;
  removeObject: (id: string) => void;
  setActiveLayer: (l: Layer2) => void;
  setActiveObjectIdx: (i: number) => void;
}
```

- **undo/redo 통합**: `Snapshot` 에 `objects` 도 포함하도록 확장(`snap()` 에서 `objects: structuredClone` 혹은 얕은 배열 복사). 오브젝트 배치/이동/삭제도 스트로크 커밋 대상.
- **도구 확장**: `Tool` 에 오브젝트 모드용 동작 추가. 단, 레이어 분리가 더 깔끔 → `activeLayer === "object"` 일 때:
  - 좌클릭 = 배치(`placeObject`)
  - 기존 오브젝트 클릭 = 선택(`selectedObjectId`)
  - 드래그 = 선택 인스턴스 이동(`moveObject`)
  - Delete/Backspace 또는 지우개 = `removeObject`

### 2.3 렌더링 (`src/components/CanvasGrid.tsx`)

타일 그리드 위에 오브젝트를 **그 다음 패스로** 그린다(painter's algorithm):
- 오브젝트는 `gy` (그리고 `gx`) 기준으로 정렬해 **뒤→앞** 순서로 draw → 아이소 겹침 자연스럽게.
- 각 오브젝트는 `objectPalette[paletteIdx].img` 를 셀 바닥 앵커에 맞춰 그린다(타일보다 세로로 큰 스프라이트 가정 → 하단 중앙 정렬).
- 선택된 오브젝트는 외곽선/핸들 표시.
- `objectsVer` 구독 추가(기존 `groundVer`/`blockedVer` 패턴과 동일).

### 2.4 팔레트 UI (`src/components/PalettePanel.tsx`)

상단에 **탭** 추가: `[ 타일 ] [ 오브젝트 ]`.
- 탭 = `activeLayer` 토글. 탭에 따라 표시 팔레트(`palette` vs `objectPalette`)와 업로드 대상이 바뀐다.
- `+ PNG` / `+ 폴더` / `서버 조회` / `업로드(n)` 버튼은 **현재 탭 팔레트**에 작동.
- 업로드 시 오브젝트 탭이면 `subcategory: "object"`, 타일 탭이면 `subcategory: "tile"` 로 보낸다(§3 참조).

> 컴포넌트 비대화 방지: 팔레트 로직을 `usePaletteController(layer)` 훅으로 추출해 타일/오브젝트가 동일 코드를 공유하도록 리팩터 권장.

### 2.5 Import/Export (`src/lib/blueprintIO.ts`, `src/types/blueprint.ts`)

오브젝트는 그리드 셀 인덱스 모델에 안 맞으므로 **별도 표현**이 필요하다. 두 가지 선택지:

- **(A) 블루프린트 확장** — `Blueprint` 에 `objects` 섹션 추가:
  ```jsonc
  {
    "map": "...",
    "layers": { "GroundTileMap": {...}, "StaticTileMap": {...}, "TileAttributeTileMap": {...} },
    "objects": {
      "palette": ["tree_a", "rock_b"],         // 이름(RUID 는 별도 매핑/레지스트리)
      "instances": [ { "name": "tree_a", "gx": 4, "gy": 7 }, ... ]
    }
  }
  ```
  → 게임 런타임이 이 섹션을 읽어 오브젝트를 스폰하도록 파이프라인 합의 필요(**런타임 측 작업 동반**).

- **(B) 별도 파일** — `map_objects_<Map>.json` 으로 분리 export. 기존 블루프린트 왕복(round-trip diff 0, vitest 게이트)을 **건드리지 않음** → 가장 안전.

> **권장: (B) 별도 파일**로 시작. 기존 `roundtrip.test.ts` 게이트를 깨지 않고, 런타임 연동은 독립 일정으로 진행 가능. 런타임이 통합 포맷을 원하면 추후 (A)로 병합.

### 2.6 변경 파일 (기능2)
- `src/types/object.ts` (신규) — `MapObject`.
- `src/store/editorStore.ts` — 오브젝트 상태/액션, undo 스냅샷 확장.
- `src/components/PalettePanel.tsx` — 타일/오브젝트 탭, 컨트롤러 훅 추출.
- `src/components/CanvasGrid.tsx` — 오브젝트 렌더 패스 + 선택/이동/배치 입력.
- `src/components/Toolbar.tsx` / `StatusBar.tsx` — 오브젝트 모드 표시.
- `src/lib/objectsIO.ts` (신규) — `map_objects_<Map>.json` import/export.
- `src/__tests__/objectsIO.test.ts` (신규) — 왕복/검증 테스트.

---

## 3. 기능 3 — 실(實)업로드 (영속) — **권장: MCP 실경로 + KV 영속**

### 결정 근거
이 에디터의 블루프린트/게임은 결국 **RUID**(Nexon 자산 서버 ID)를 참조한다. 로컬 디스크나 별도 DB에 PNG를 저장하면 **게임이 못 보는 고아 자산**이 되어 자산 파이프라인이 두 갈래가 된다. 따라서:
- **소스 오브 트루스 = MCP(Nexon)** 유지. 기존 업로드 경로를 *실제로 검증·동작*시킨다.
- **name↔RUID 레지스트리 = KV(Vercel KV / Upstash) 영속**. 재방문/재시작에도 "이미 등록됨" 판정이 유지된다.
- 로컬 개발 편의를 위해 **디스크 폴백 어댑터**(파일 JSON)를 보조로 추가(KV 미설정 + 로컬일 때).

### 3.1 MCP 업로드 경로 검증 (핵심)
`src/server/mswMcp.ts:62 createSpriteResource` 의 2-step 흐름을 **실제 응답으로 검증**한다.

- 첫 실호출 응답을 로깅하여 필드명 확정:
  - step1 presignedUrl 후보: `presignedUrl|presignedURL|uploadUrl|url` (`mswMcp.ts:76`)
  - step2 RUID 후보: `ruid|guid|resource_guid|resourceGuid` (`mswMcp.ts:104`)
- 검증 체크리스트:
  1. step1 이 정말 presignedUrl 을 주는가(필드명/중첩).
  2. presigned PUT 의 헤더 요구(Content-Type, Content-Length, 혹은 추가 서명 헤더) 일치 여부.
  3. step2 finalize 가 RUID 를 반환하는가, 아니면 별도 commit 툴이 필요한가.
  4. **중복 업로드 시 서버 동작**(같은 name → 신규 RUID? 기존 반환? 에러?). 멱등성 정책 확정.
- 산출물: `mswMcp.ts` 의 `deepFind` 키 목록을 실제값으로 좁히고, `⚠ 미검증` 주석 제거. 응답 샘플을 `docs` 에 기록.

> **검증 방법**: `.env` 에 실 토큰(`MSW_MCP_TOKEN`) 세팅 후, 작은 테스트 PNG 1장으로 `POST /api/upload` 1회 실행 → 응답·로그 확인. 비용/부작용(외부 자산 생성)을 인지하고 **명시적 승인 후** 진행.

### 3.2 레지스트리 영속 (KV)
이미 `KvStore` 구현 존재(`registryStore.ts:43`). 할 일은 **설정/운영 확정**:
- `.env` 에 `KV_REST_API_URL` + `KV_REST_API_TOKEN` 세팅 → 자동으로 `getStore()` 가 KvStore 선택(`registryStore.ts:86`).
- 동시쓰기 주의: 현재 단일 JSON blob RMW(last-write-wins, `registryStore.ts:8` 주석). 기획자 1인 도구라 허용하나, 다중 사용 시 per-field `HSET` 원자연산으로 교체.
- **오브젝트 추가 대응**: 레지스트리 엔트리에 `subcategory`(또는 `kind: "tile"|"object"`) 필드 추가 권장 → 같은 이름이 타일/오브젝트로 갈릴 때 분리.

```ts
// src/lib/registry.ts — RegistryEntry 확장
export interface RegistryEntry {
  name: string;
  ruid: string;
  hash?: string | null;
  kind?: "tile" | "object";   // 신규(옵션, 하위호환)
}
```

### 3.3 디스크 폴백 어댑터 (로컬 개발용, 선택)
KV 미설정 + 로컬 실행일 때 `MemoryStore` 대신 파일 영속을 쓰면 "재시작 시 소실" 불만이 로컬에서도 사라진다.

```ts
// src/server/registryStore.ts — FileStore (Node fs, 로컬 전용)
class FileStore implements RegistryStore {
  // data/registry.local.json 읽기/머지/쓰기 (gitignore 대상)
}
// getStore(): KV > (NODE_ENV!=production && fs 가능) FileStore > MemoryStore
```
> 주의: Vercel 서버리스는 파일시스템이 휘발/읽기전용 → **프로덕션은 KV 필수**. FileStore 는 로컬 dev 한정.

### 3.4 업로드 UX 보강 (`PalettePanel.tsx`)
"단발성처럼 보임" 체감을 없애기 위해:
- 업로드 후 응답의 `store`/`persisted` 를 사용자에게 표시(`persisted:false`(=memory)면 **경고 배너**: "영속 저장소 미설정 — 재시작 시 사라질 수 있음").
- 업로드 성공 시 RUID 를 팔레트 배지/툴팁에 노출(이미 `applyResolutions` 로 반영됨, `PalettePanel.tsx:92`).
- 실패 항목 재시도 버튼.

### 3.5 변경 파일 (기능3)
- `src/server/mswMcp.ts` — 응답 필드 확정, 미검증 주석 제거, (필요 시) finalize/commit 보정.
- `src/server/registryStore.ts` — `FileStore` 추가, `getStore` 우선순위, `kind` 머지.
- `src/lib/registry.ts` — `RegistryEntry.kind`, `resolveTile` 의 kind 인지(선택).
- `app/api/upload/route.ts` — `subcategory`/`kind` 전달·기록(이미 `subcategory` 수용, `route.ts:57`).
- `src/components/PalettePanel.tsx` — `persisted` 경고 배너, 재시도.
- `.env.example` — KV 키 안내 강화(이미 존재).

---

## 4. 통합 변경 파일 요약

| 파일 | 기능1 | 기능2 | 기능3 |
| --- | :-: | :-: | :-: |
| `src/components/PalettePanel.tsx` | ● 폴더 인풋·정렬·진행 | ● 타일/오브젝트 탭 | ● persisted 배너·재시도 |
| `src/lib/palette.ts` | ● 진행 콜백·병렬 | | |
| `src/store/editorStore.ts` | | ● 오브젝트 상태/액션·undo | |
| `src/components/CanvasGrid.tsx` | | ● 오브젝트 렌더/입력 | |
| `src/types/object.ts` (신규) | | ● MapObject | |
| `src/lib/objectsIO.ts` (신규) | | ● 오브젝트 export/import | |
| `src/server/mswMcp.ts` | | | ● 경로 검증 |
| `src/server/registryStore.ts` | | ● kind 머지 | ● FileStore·KV |
| `src/lib/registry.ts` | | | ● kind 필드 |
| `app/api/upload/route.ts` | | ● subcategory | ● kind 기록 |

---

## 5. 구현 순서 (마일스톤)

- **M1 — 폴더 업로드(기능1)**: 가장 작고 독립적. 즉시 체감 개선. (반나절)
- **M2 — 업로드 영속(기능3)**: MCP 경로 **실검증** + KV 설정 + persisted 배너. "단발성" 근본 해결. (1~2일, 외부 호출 승인 필요)
- **M3 — 오브젝트(기능2)**: 데이터모델→스토어→렌더→팔레트탭→objectsIO→테스트. 가장 큼. (2~4일)

> M2 를 M3 보다 먼저 두는 이유: 오브젝트도 결국 같은 업로드/영속 경로를 타므로, 업로드를 먼저 단단히 하면 오브젝트 업로드가 공짜로 따라온다.

---

## 6. 테스트 / 검증

- **기능1**: 폴더(하위폴더 포함) 선택 → 이미지만, 정렬 안정, 진행 표시. 잡파일 무시.
- **기능2**: `objectsIO.test.ts` 왕복(diff 0), 배치/이동/삭제 undo/redo, 아이소 겹침 정렬. 기존 `roundtrip.test.ts` 그대로 통과(블루프린트 불변).
- **기능3**: MCP 응답 필드 확정 후 `mswMcp` 의 deepFind 키가 실제값과 일치. KV 왕복(이미 `registryStore.test.ts` 존재) + 재시작 후 등록 유지. `persisted` 플래그 정확.
- 회귀: `npm run typecheck` · `npm run lint` · `npm run test`(vitest 게이트).

---

## 7. 미해결/합의 필요

1. **오브젝트 런타임 연동**: §2.5 (A)통합 블루프린트 vs (B)별도 파일. 본 문서는 **(B)별도 파일** 권장 — 게임 런타임이 `map_objects_<Map>.json` 을 읽는 작업은 별도 일정/팀 합의 필요.
2. **오브젝트 좌표 정밀도**: MVP 셀 스냅(정수) 확정 여부. 자유 미세배치/회전/스케일은 후속.
3. **MCP subcategory 어휘**: 타일=`"tile"`, 오브젝트=`"object"` 로 확정할지(현재 기본값이 `"object"`, `mswMcp.ts:66`). 게임 자산 분류 규칙과 일치시킬 것.
4. **MCP 실호출 승인**: §3.1 검증은 외부 자산을 실제로 생성한다 → 테스트 그룹/네이밍 규칙 합의 후 진행.

---

## 부록 B — 리소스 스토리지에서 불러오기 (구현 완료, 2026-06-29)

그룹 소유 리소스를 검색→썸네일과 함께 팔레트에 추가하는 기능. (로컬 PNG 업로드 없이 기존 메이플월드 자산 사용)

**흐름**: `ResourceBrowser`(검색/필터/페이지네이션/다중선택) → `POST /api/resources` → MCP `asset_list_group_resources`(그룹 목록) + `asset_get_group_thumbnail`(RUID별 썸네일, 동시성 8) → `tilesFromResources`(썸네일 이미지 로드 + ruid/registered) → `addResolvedTiles`(RUID 보존 append, 중복 방지).

**구현 파일**: `src/server/mswMcp.ts`(listGroupResources/getGroupThumbnail), `app/api/resources/route.ts`(신규), `src/lib/apiClient.ts`(listResources), `src/lib/palette.ts`(tilesFromResources), `src/store/editorStore.ts`(addResolvedTiles), `src/components/ResourceBrowser.tsx`(신규), `src/components/PalettePanel.tsx`("스토리지" 버튼), `src/lib/secret.ts`(분리), `app/globals.css`(모달).

**MCP 읽기 툴(실서버 확인)**: `asset_list_group_resources`(resourceList[]+nextCursor), `asset_get_group_thumbnail`(thumbnail_url|null), `asset_search_resources`, `asset_*_metadata_bulk` 등 총 32개. 응답 필드 확정됨.

**이미지 소스 — `.mod` 임베드 PNG 추출 (foothold 타일 검증 완료)**: 서버 썸네일(`asset_get_group_thumbnail`)은 스프라이트의 애니메이션 프레임에서 뽑기 때문에 **정적 스프라이트(foothold 타일 등)는 `"Missing resultData in metadata"` 로 미생성**(실측 foothold 20/20, 최근 리소스 150/150 썸네일 없음). 대신 리소스의 `modFiles.win.path` 가 가리키는 `.mod` 바이너리를 CDN(`mod-ugc.dn.nexoncdn.co.kr`, 인증 불필요)에서 받으면 **작은 헤더 뒤에 원본 PNG 가 그대로 임베드**돼 있다(PNG 매직~IEND). 서버에서 이를 추출해 `data:image/png;base64,...` 로 반환한다.
- 검증: foothold `tile000_*` 다수 → 유효한 **56×28 RGBA PNG**(2:1 아이소 타일) 추출, `/api/resources` end-to-end 로 dataURL 반환 확인.
- 구현: `fetchSpritePngBase64`(mswMcp.ts), 라우트가 목록의 각 modPath 를 동시성 8로 추출. 추출 실패/미보유는 `no img` 자리표시자(선택·추가·export RUID 는 정상).
- 서버에서 추출하므로 CORS·canvas 타인트 문제 없음. ResourceBrowser 기본 subcategory = `foothold`.

향후: ① 애니메이션 스프라이트는 첫 PNG(첫 프레임)만 추출 — 다프레임 미리보기는 추후, ② 에디터 업로드 경로 thumbnail 생성은 선택.

> dev 유틸: `scripts/probe-mcp*.mjs` (읽기 전용 MCP probe — listTools/list/thumbnail. 시크릿은 런타임에 .env에서만 읽음).

## 부록 A — 무관 정리 항목 (별건)
이 repo 이전(legend_of_light → web-map-editor) 후, `README.md` 의 설계문서 링크가 `../../docs/map/...` 상대경로라 **새 repo에서 깨져** 있다. 본 작업과 별개로 링크를 새 repo 기준(예: 이 문서처럼 루트 동봉)으로 갱신 필요.
