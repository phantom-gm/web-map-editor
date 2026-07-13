import { useCallback, useEffect, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { listResources, type ResourceItem } from "../lib/apiClient";
import { tilesFromResources } from "../lib/palette";

// sprite 카테고리의 대표 subcategory(목록/검색용). "all" = 전체. foothold = 바닥 타일.
const SUBCATEGORIES = ["foothold", "object", "background", "npc", "monster", "portal", "trap", "item", "all"];
const PAGE = 24;

export function ResourceBrowser({ onClose }: { onClose: () => void }) {
  const addResolvedTiles = useEditorStore((s) => s.addResolvedTiles);
  const inPalette = useEditorStore((s) => s.palette);

  const [subcategory, setSubcategory] = useState("foothold");
  const [searchWord, setSearchWord] = useState("");
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null); // Shift 범위 선택 기준 인덱스

  const havePalette = new Set(inPalette.map((t) => t.ruid).filter(Boolean));

  const load = useCallback(
    async (reset: boolean) => {
      setBusy(true);
      setErr("");
      try {
        const res = await listResources({
          category: "sprite",
          subcategory,
          count: PAGE,
          searchWord: searchWord.trim() || null,
          cursor: reset ? null : cursor,
        });
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
        if (reset) setAnchor(null); // 목록이 갈리면 Shift 기준 인덱스 무효화
        setCursor(res.nextCursor);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [subcategory, searchWord, cursor],
  );

  // 최초 + subcategory 변경 시 재조회. (mount/파라미터 fetch — 의도된 setState)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subcategory]);

  // 클릭 선택. Shift+클릭이면 직전 기준(anchor)부터 현재까지 범위를 한꺼번에 선택.
  const pick = (e: React.MouseEvent, idx: number) => {
    if (e.shiftKey && anchor !== null) {
      const [lo, hi] = anchor < idx ? [anchor, idx] : [idx, anchor];
      setSelected((prev) => {
        const n = new Set(prev);
        for (let i = lo; i <= hi; i++) {
          const it = items[i];
          if (it && !havePalette.has(it.ruid)) n.add(it.ruid);
        }
        return n;
      });
    } else {
      const ruid = items[idx].ruid;
      setSelected((prev) => {
        const n = new Set(prev);
        if (n.has(ruid)) n.delete(ruid);
        else n.add(ruid);
        return n;
      });
      setAnchor(idx);
    }
  };

  const addSelected = async () => {
    const picks = items.filter((it) => selected.has(it.ruid));
    if (picks.length === 0) return;
    setBusy(true);
    try {
      const tiles = await tilesFromResources(picks);
      addResolvedTiles(tiles);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rb-overlay" onClick={onClose}>
      <div className="rb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rb-head">
          <span>리소스 스토리지 (그룹 소유)</span>
          <button className="rb-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="rb-controls">
          <select value={subcategory} onChange={(e) => setSubcategory(e.target.value)}>
            {SUBCATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            placeholder="이름 검색…"
            value={searchWord}
            onChange={(e) => setSearchWord(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(true)}
          />
          <button onClick={() => load(true)} disabled={busy}>
            검색
          </button>
        </div>

        {err && <div className="rb-err">{err}</div>}

        <div className="rb-grid">
          {items.length === 0 && !busy && <div className="rb-empty">결과 없음</div>}
          {items.map((it, idx) => {
            const already = havePalette.has(it.ruid);
            const sel = selected.has(it.ruid);
            return (
              <button
                key={it.ruid}
                className={"rb-item" + (sel ? " sel" : "") + (already ? " dim" : "")}
                title={`${it.name}\n${it.subcategory}\nRUID: ${it.ruid}${already ? "\n(이미 팔레트에 있음)" : "\n(Shift+클릭: 범위 선택)"}`}
                onClick={(e) => !already && pick(e, idx)}
              >
                <span className="rb-thumb">
                  {it.imageUrl ? (
                    <img src={it.imageUrl} alt={it.name} />
                  ) : (
                    <span className="rb-nothumb">no img</span>
                  )}
                  {already && <span className="rb-have">✓</span>}
                </span>
                <span className="rb-name">{it.name}</span>
              </button>
            );
          })}
        </div>

        <div className="rb-foot">
          <button onClick={() => load(false)} disabled={busy || !cursor}>
            {busy ? "불러오는 중…" : cursor ? "더 보기" : "끝"}
          </button>
          <span className="rb-count">{selected.size} 선택</span>
          <button className="rb-add" onClick={addSelected} disabled={busy || selected.size === 0}>
            팔레트에 추가
          </button>
        </div>
      </div>
    </div>
  );
}
