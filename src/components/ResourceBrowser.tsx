import { useCallback, useEffect, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { listResources, type ResourceItem } from "../lib/apiClient";
import { tilesFromResources } from "../lib/palette";
import { getSecret } from "../lib/secret";

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

  const havePalette = new Set(inPalette.map((t) => t.ruid).filter(Boolean));

  const load = useCallback(
    async (reset: boolean) => {
      const secret = getSecret();
      if (!secret) return;
      setBusy(true);
      setErr("");
      try {
        const res = await listResources(
          {
            category: "sprite",
            subcategory,
            count: PAGE,
            searchWord: searchWord.trim() || null,
            cursor: reset ? null : cursor,
          },
          secret,
        );
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
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

  const toggle = (ruid: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(ruid)) n.delete(ruid);
      else n.add(ruid);
      return n;
    });

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
          {items.map((it) => {
            const already = havePalette.has(it.ruid);
            const sel = selected.has(it.ruid);
            return (
              <button
                key={it.ruid}
                className={"rb-item" + (sel ? " sel" : "") + (already ? " dim" : "")}
                title={`${it.name}\n${it.subcategory}\nRUID: ${it.ruid}${already ? "\n(이미 팔레트에 있음)" : ""}`}
                onClick={() => !already && toggle(it.ruid)}
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
