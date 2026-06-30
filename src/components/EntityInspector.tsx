import { useEditorStore } from "../store/editorStore";
import { ENTITY_META, type MapEntity } from "../types/entity";

// 선택된 엔티티의 속성 편집 패널(캔버스 우상단 플로팅). 종류별 필드 표시.
export function EntityInspector() {
  const selectedId = useEditorStore((s) => s.selectedEntityId);
  const entity = useEditorStore((s) => s.entities.find((e) => e.id === s.selectedEntityId) ?? null);
  const updateEntity = useEditorStore((s) => s.updateEntity);
  const removeEntity = useEditorStore((s) => s.removeEntity);
  const selectEntity = useEditorStore((s) => s.selectEntity);

  if (!selectedId || !entity) return null;
  const meta = ENTITY_META[entity.kind];

  const setNum = (key: keyof MapEntity, v: string) =>
    updateEntity(entity.id, { [key]: v === "" ? undefined : Number(v) });
  const setStr = (key: keyof MapEntity, v: string) =>
    updateEntity(entity.id, { [key]: v === "" ? undefined : v });

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
            <span>타겟 맵</span>
            <input value={entity.targetMap ?? ""} onChange={(e) => setStr("targetMap", e.target.value)} placeholder="맵 이름" />
          </label>
          <div className="ei-grid2">
            <label className="ei-row">
              <span>타겟 X</span>
              <input type="number" value={entity.targetX ?? ""} onChange={(e) => setNum("targetX", e.target.value)} />
            </label>
            <label className="ei-row">
              <span>타겟 Y</span>
              <input type="number" value={entity.targetY ?? ""} onChange={(e) => setNum("targetY", e.target.value)} />
            </label>
          </div>
        </>
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

      <button className="ei-delete" onClick={() => removeEntity(entity.id)}>
        삭제 (Del)
      </button>
    </div>
  );
}
