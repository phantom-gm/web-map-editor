import { useEditorStore } from "../store/editorStore";
import { ENTITY_META, FACINGS, FACING_LABEL, type MapEntity } from "../types/entity";
import { npcClassLabel } from "../lib/npcClass";
import { makeEntityImageLookup } from "../lib/entityImage";
import { TW } from "../lib/grid";
import { NumberField } from "./NumberField";

// 선택된 엔티티의 속성 편집 패널(캔버스 우상단 플로팅). 종류별 필드 표시.
export function EntityInspector() {
  const selectedId = useEditorStore((s) => s.selectedEntityId);
  const entity = useEditorStore((s) => s.entities.find((e) => e.id === s.selectedEntityId) ?? null);
  const npcCatalog = useEditorStore((s) => s.npcCatalog);
  const palette = useEditorStore((s) => s.palette);
  const updateEntity = useEditorStore((s) => s.updateEntity);
  const setFootprintRects = useEditorStore((s) => s.setFootprintRects);
  const removeEntity = useEditorStore((s) => s.removeEntity);
  const duplicateEntity = useEditorStore((s) => s.duplicateEntity);
  const selectEntity = useEditorStore((s) => s.selectEntity);

  if (!selectedId || !entity) return null;
  const meta = ENTITY_META[entity.kind];

  // 오목 점유 run 목록(없으면 null = 단일 직사각 모드).
  const rects = entity.footprintRects?.length ? entity.footprintRects : null;

  // 팔레트 원본 이미지의 네이티브 픽셀 크기 — "네이티브 크기로" 복원의 기준(없으면 버튼 비활성).
  const img = makeEntityImageLookup(palette)(entity);
  const nativeWH: [number, number] | null =
    img && img.naturalWidth > 0 ? [img.naturalWidth, img.naturalHeight] : null;

  const setNum = (key: keyof MapEntity, v: string) =>
    updateEntity(entity.id, { [key]: v === "" ? undefined : Number(v) });
  const setStr = (key: keyof MapEntity, v: string) =>
    updateEntity(entity.id, { [key]: v === "" ? undefined : v });

  // portal 도착 셀 [x,y] — 한 축 편집(빈칸=0). 아무것도 안 채우면 destCell 미설정(미완성).
  const setDestCell = (axis: 0 | 1, v: string) => {
    const cur = entity.destCell ?? [0, 0];
    const n = v === "" ? 0 : Number(v);
    const next: [number, number] = axis === 0 ? [n, cur[1]] : [cur[0], n];
    updateEntity(entity.id, { destCell: next });
  };

  // monster→Monster, npc→Npc 타입 카탈로그. 비어있으면 드롭다운 대신 id 직접입력 폴백.
  const wantType = entity.kind === "monster" ? "Monster" : "Npc";
  const npcOptions = npcCatalog.entries.filter((e) => e.type === wantType);
  const currentInCatalog = entity.npcClassId != null && npcCatalog.byId.has(entity.npcClassId);

  return (
    <div className="entity-inspector">
      <div className="ei-head" style={{ color: meta.color }}>
        <span className="ei-dot" style={{ background: meta.color }} />
        {meta.label}
        <span className="ei-pos">
          ({entity.gx}, {entity.gy})
        </span>
        <button className="ei-close" onClick={() => selectEntity(null)} title="닫기">
          ✕
        </button>
      </div>

      <label className="ei-row">
        <span>이름</span>
        <input value={entity.name ?? ""} onChange={(e) => setStr("name", e.target.value)} placeholder={entity.kind} />
      </label>
      {entity.ruid && <div className="ei-ruid">RUID: {entity.ruid}</div>}

      {entity.kind === "portal" && (
        <>
          <label className="ei-row">
            <span>목적지 맵 (destMap)</span>
            <input value={entity.destMap ?? ""} onChange={(e) => setStr("destMap", e.target.value)} placeholder="맵 이름" />
          </label>
          <div className="ei-grid2">
            <label className="ei-row">
              <span>도착 X</span>
              <input type="number" value={entity.destCell?.[0] ?? ""} onChange={(e) => setDestCell(0, e.target.value)} />
            </label>
            <label className="ei-row">
              <span>도착 Y</span>
              <input type="number" value={entity.destCell?.[1] ?? ""} onChange={(e) => setDestCell(1, e.target.value)} />
            </label>
          </div>
          <label className="ei-row">
            <span>도착 방향 (destFacing) — 선택. 신경 안 쓰면 무관으로 두면 됨</span>
            <select value={entity.destFacing ?? ""} onChange={(e) => updateEntity(entity.id, { destFacing: (e.target.value || undefined) as MapEntity["destFacing"] })}>
              <option value="">무관 (기본 SE)</option>
              {FACINGS.map((f) => (
                <option key={f} value={f}>
                  {FACING_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {(entity.kind === "monster" || entity.kind === "npc") && (
        <label className="ei-row">
          <span>NpcClass 종류 (npcClassId) — 카탈로그 선택 또는 직접 입력</span>
          {npcOptions.length > 0 && (
            <select value={currentInCatalog ? String(entity.npcClassId) : ""} onChange={(e) => setNum("npcClassId", e.target.value)}>
              <option value="">— 카탈로그에서 선택 —</option>
              {npcOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {npcClassLabel(n)}
                </option>
              ))}
            </select>
          )}
          <input
            type="number"
            value={entity.npcClassId ?? ""}
            onChange={(e) => setNum("npcClassId", e.target.value)}
            placeholder="NpcClassID 직접 입력 (예: 1002)"
          />
        </label>
      )}

      {entity.kind === "monster" && (
        <>
          <div className="ei-grid2">
            <label className="ei-row">
              <span>스폰 수</span>
              <input type="number" min={1} value={entity.spawnCount ?? ""} onChange={(e) => setNum("spawnCount", e.target.value)} />
            </label>
            <label className="ei-row">
              <span>리젠(초)</span>
              <input type="number" min={0} value={entity.respawnSec ?? ""} onChange={(e) => setNum("respawnSec", e.target.value)} />
            </label>
          </div>
          <label className="ei-row">
            <span>분산 (spread) — 스폰 흩어짐 반경(셀). 0 = 앵커에 모여서</span>
            <input type="number" min={0} value={entity.spread ?? ""} onChange={(e) => setNum("spread", e.target.value)} />
          </label>
        </>
      )}
      {entity.kind === "npc" && (
        <label className="ei-row">
          <span>대사 ID</span>
          <input value={entity.dialogId ?? ""} onChange={(e) => setStr("dialogId", e.target.value)} placeholder="스크립트 id" />
        </label>
      )}

      {entity.kind !== "portal" && !rects && (
        <label className="ei-row">
          <span>{entity.kind === "object" ? "타일 크기 (W × H) — 점유(충돌) 영역만. 이미지 크기는 아래 '배율'로 조절" : "타일 크기 (W × H) — 점유 영역. 드래그 핸들로도 조절"}</span>
          <div className="ei-grid2">
            <NumberField
              className=""
              value={entity.tilesW ?? 1}
              min={1}
              onCommit={(w) => updateEntity(entity.id, { tilesW: w })}
            />
            <NumberField
              className=""
              value={entity.tilesH ?? 1}
              min={1}
              onCommit={(h) => updateEntity(entity.id, { tilesH: h })}
            />
          </div>
        </label>
      )}

      {/* 오목(ㄴ/ㄷ/T자) 점유 — 직사각 run 목록. 여관 포치처럼 "벽은 막고 개구부는 걸어 들어가는"
          형태는 직사각 하나로 표현할 수 없다(하나면 포치까지 막힌다). run 모드에선 W×H 는
          run 들의 바운딩 박스라 직접 편집하지 않는다(스토어가 자동 동기). */}
      {entity.kind === "object" && (
        <div className="ei-runs">
          <div className="ei-runs-head">
            <span>
              점유 모양 {rects ? `— 직사각 ${rects.length}개 (바운딩 ${entity.tilesW ?? 1}×${entity.tilesH ?? 1})` : "— 단일 직사각"}
            </span>
            {rects ? (
              <button
                title="직사각 목록을 지우고 단일 W×H 로 되돌립니다"
                onClick={() => setFootprintRects(entity.id, undefined)}
              >
                ↺ 단일로
              </button>
            ) : (
              <button
                title="현재 W×H 를 첫 직사각으로 삼아 오목 모양(ㄴ/ㄷ/T자) 편집을 시작합니다"
                onClick={() =>
                  setFootprintRects(entity.id, [[0, 0, Math.max(1, entity.tilesW ?? 1), Math.max(1, entity.tilesH ?? 1)]])
                }
              >
                ⊞ 오목 모양으로
              </button>
            )}
          </div>

          {rects && (
            <>
              <div className="ei-runs-cols">
                <span>X</span>
                <span>Y</span>
                <span>W</span>
                <span>H</span>
                <span />
              </div>
              {rects.map((r, i) => (
                <div className="ei-runs-row" key={i}>
                  {([0, 1, 2, 3] as const).map((k) => (
                    <NumberField
                      key={k}
                      className=""
                      value={r[k]}
                      min={k < 2 ? 0 : 1}
                      onCommit={(v) => {
                        const next = rects.map((row, j) =>
                          j === i ? (row.map((c, m) => (m === k ? v : c)) as [number, number, number, number]) : row,
                        );
                        setFootprintRects(entity.id, next);
                      }}
                    />
                  ))}
                  <button
                    className="ei-runs-del"
                    title="이 직사각 제거"
                    disabled={rects.length <= 1}
                    onClick={() => setFootprintRects(entity.id, rects.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="ei-fit"
                title="직사각 추가 — 앵커(X,Y=0,0) 기준 상대 오프셋. 합집합이 점유 영역이 됩니다"
                onClick={() => setFootprintRects(entity.id, [...rects, [0, 0, 1, 1]])}
              >
                + 직사각 추가
              </button>
              <div className="ei-runs-hint">
                X·Y = 앵커 기준 상대 오프셋(0 이상) · 합집합이 점유(충돌) 영역. 캔버스의 &quot;점유&quot; 표시로 확인하세요.
              </div>
            </>
          )}
        </div>
      )}

      {entity.kind === "object" && (
        <div className="ei-fitrow">
          <button
            className="ei-fit"
            title="이미지 크기의 기준점을 현재 타일 크기로 재설정 (배율 1.0 = 이 타일 크기)"
            onClick={() =>
              updateEntity(entity.id, {
                baseW: entity.tilesW ?? 1,
                baseH: entity.tilesH ?? 1,
                scaleMul: undefined,
              })
            }
          >
            ⤢ 타일 크기(W×H)에 맞추기
          </button>
          <button
            className="ei-fit"
            title="이미지 크기 기준점을 원본 픽셀 크기로 되돌림 (배치 시 기본값)"
            disabled={!nativeWH}
            onClick={() => {
              if (!nativeWH) return;
              updateEntity(entity.id, { baseW: nativeWH[0] / TW, baseH: nativeWH[1] / TW, scaleMul: undefined });
            }}
          >
            ↺ 네이티브 크기로
          </button>
        </div>
      )}

      {entity.kind === "object" && (
        <label className="ei-check">
          <input
            type="checkbox"
            checked={entity.blocks === true}
            onChange={(e) => updateEntity(entity.id, { blocks: e.target.checked ? true : undefined })}
          />
          <span>충돌 — 이 오브젝트가 이동을 막음 (기본: 통과 가능. 체크 시 footprint 이동불가, 포탈 셀 예외)</span>
        </label>
      )}

      {entity.kind === "object" && (
        <label className="ei-row">
          <span>플레이어 레이어 — 자동(기본): 건물·나무 앞뒤 자동 / 위: 천장·다리 / 아래: 바닥 데칼·러그</span>
          <select
            value={entity.layer ?? "auto"}
            onChange={(e) => updateEntity(entity.id, { layer: e.target.value === "auto" ? undefined : (e.target.value as MapEntity["layer"]) })}
          >
            <option value="auto">자동 (기본 — 건물·나무: 플레이어와 앞/뒤 자동)</option>
            <option value="above">위 (항상 플레이어 위 — 천장·다리·아치)</option>
            <option value="below">아래 (항상 플레이어 아래 — 바닥 데칼·러그)</option>
          </select>
        </label>
      )}

      {entity.kind === "object" && (
        <label className="ei-row">
          <span>우선순위 (겹침) — 같은 줄에서 겹칠 때 값이 클수록 앞(위). 기본 0</span>
          <NumberField
            className=""
            value={entity.sortOffset ?? 0}
            onCommit={(v) => updateEntity(entity.id, { sortOffset: v || undefined })}
          />
        </label>
      )}

      {entity.kind === "object" && (
        <>
          <label className="ei-row">
            <span>배율 (이미지 크기) — 1.0 = 배치 시 기본 크기. W×H(점유)와 독립</span>
            <NumberField
              className=""
              value={entity.scaleMul ?? 1}
              min={0.05}
              step={0.05}
              float
              onCommit={(v) => updateEntity(entity.id, { scaleMul: v })}
            />
          </label>
          <div className="ei-grid2">
            <label className="ei-row">
              <span>X 이동 (px)</span>
              <NumberField
                className=""
                value={entity.offsetX ?? 0}
                onCommit={(v) => updateEntity(entity.id, { offsetX: v || undefined })}
              />
            </label>
            <label className="ei-row">
              <span>Y 이동 (px)</span>
              <NumberField
                className=""
                value={entity.offsetY ?? 0}
                onCommit={(v) => updateEntity(entity.id, { offsetY: v || undefined })}
              />
            </label>
          </div>
          <label className="ei-row">
            <span>기울기 (회전, 도)</span>
            <NumberField
              className=""
              value={entity.rotationDeg ?? 0}
              onCommit={(v) => updateEntity(entity.id, { rotationDeg: v || undefined })}
            />
          </label>
        </>
      )}

      <div className="ei-actions">
        <button onClick={() => duplicateEntity(entity.id)}>복사 (⌘/Ctrl+D)</button>
        {entity.kind !== "portal" && (
          <button className={entity.flipX ? "on" : ""} onClick={() => updateEntity(entity.id, { flipX: !entity.flipX })}>
            ⇄ 좌우반전
          </button>
        )}
      </div>
      <button className="ei-delete" onClick={() => removeEntity(entity.id)}>
        삭제 (Del)
      </button>
    </div>
  );
}
