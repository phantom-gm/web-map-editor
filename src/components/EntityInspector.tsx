import { useEditorStore } from "../store/editorStore";
import { ENTITY_META, FACINGS, FACING_LABEL, type MapEntity } from "../types/entity";
import { npcClassLabel } from "../lib/npcClass";
import { NumberField } from "./NumberField";

// 선택된 엔티티의 속성 편집 패널(캔버스 우상단 플로팅). 종류별 필드 표시.
export function EntityInspector() {
  const selectedId = useEditorStore((s) => s.selectedEntityId);
  const entity = useEditorStore((s) => s.entities.find((e) => e.id === s.selectedEntityId) ?? null);
  const npcCatalog = useEditorStore((s) => s.npcCatalog);
  const updateEntity = useEditorStore((s) => s.updateEntity);
  const removeEntity = useEditorStore((s) => s.removeEntity);
  const duplicateEntity = useEditorStore((s) => s.duplicateEntity);
  const selectEntity = useEditorStore((s) => s.selectEntity);

  if (!selectedId || !entity) return null;
  const meta = ENTITY_META[entity.kind];

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
      )}
      {entity.kind === "npc" && (
        <label className="ei-row">
          <span>대사 ID</span>
          <input value={entity.dialogId ?? ""} onChange={(e) => setStr("dialogId", e.target.value)} placeholder="스크립트 id" />
        </label>
      )}

      {entity.kind !== "portal" && (
        <label className="ei-row">
          <span>타일 크기 (W × H) — 점유 영역. 드래그 핸들로도 조절</span>
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
        <>
          <label className="ei-row">
            <span>배율 (사이즈) — footprint 자동크기 × 이 값</span>
            <input type="number" step={0.05} value={entity.scaleMul ?? 1} onChange={(e) => setNum("scaleMul", e.target.value)} />
          </label>
          <div className="ei-grid2">
            <label className="ei-row">
              <span>X 이동 (px)</span>
              <input type="number" step={1} value={entity.offsetX ?? 0} onChange={(e) => setNum("offsetX", e.target.value)} />
            </label>
            <label className="ei-row">
              <span>Y 이동 (px)</span>
              <input type="number" step={1} value={entity.offsetY ?? 0} onChange={(e) => setNum("offsetY", e.target.value)} />
            </label>
          </div>
          <label className="ei-row">
            <span>기울기 (회전, 도)</span>
            <input type="number" step={1} value={entity.rotationDeg ?? 0} onChange={(e) => setNum("rotationDeg", e.target.value)} />
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
