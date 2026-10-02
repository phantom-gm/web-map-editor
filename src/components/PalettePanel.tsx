import { useGamePreviewStore } from "../store/gamePreviewStore";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { loadTiles, fallbackColor, DEFAULT_CATEGORY, type PaletteTile } from "../lib/palette";
import { isEntityKind } from "../types/entity";
import type { RegStatus } from "../lib/registry";
import { resolveTiles, uploadTiles } from "../lib/apiClient";
import { getSecret } from "../lib/secret";
import { buildCatalogFromCsv, catalogFromEntries } from "../lib/npcClass";
import { ResourceBrowser } from "./ResourceBrowser";

const BADGE: Record<RegStatus, { sym: string; cls: string; label: string }> = {
  registered: { sym: "✓", cls: "reg", label: "리소스 스토리지 등록됨" },
  renamed: { sym: "✓", cls: "reg", label: "내용 일치(이름 다름) — 등록됨" },
  conflict: { sym: "⚠", cls: "conf", label: "같은 이름, 다른 내용 — 확인 필요" },
  new: { sym: "●", cls: "new", label: "미등록 — 업로드 필요" },
};

function tileTitle(t: PaletteTile): string {
  if (!t.regStatus) return t.name;
  const b = BADGE[t.regStatus];
  return `${t.name}\n${b.label}${t.ruid ? `\nRUID: ${t.ruid}` : ""}`;
}

export function PalettePanel() {
  const gameSync = useEditorStore(s => s.gameSync);
  const groundBrushRuids = useGamePreviewStore(s => s.scene?.baselineId === gameSync?.baselineId ? s.scene?.groundBrushRuids : undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const regRef = useRef<HTMLInputElement>(null);
  const npcRef = useRef<HTMLInputElement>(null);
  const palette = useEditorStore((s) => s.palette);
  const activeIdx = useEditorStore((s) => s.activeIdx);
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveIdx = useEditorStore((s) => s.setActiveIdx);
  const addTiles = useEditorStore((s) => s.addTiles);
  const removeTiles = useEditorStore((s) => s.removeTiles);
  const clearPalette = useEditorStore((s) => s.clearPalette);
  const loadRegistry = useEditorStore((s) => s.loadRegistry);
  const loadNpcCatalog = useEditorStore((s) => s.loadNpcCatalog);
  const setNpcCatalog = useEditorStore((s) => s.setNpcCatalog);
  const npcCount = useEditorStore((s) => s.npcCatalog.entries.length);
  const applyResolutions = useEditorStore((s) => s.applyResolutions);
  const [busy, setBusy] = useState<"" | "resolve" | "upload">("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set()); // 다중선택(팔레트 원본 인덱스)
  const [anchor, setAnchor] = useState<number | null>(null); // Shift 범위 기준
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null); // 우클릭 컨텍스트 메뉴

  // 폴더 선택 인풋 — webkitdirectory 는 React 타입에 없어 ref 로 부여.
  useEffect(() => {
    if (dirRef.current) {
      dirRef.current.setAttribute("webkitdirectory", "");
      dirRef.current.setAttribute("directory", "");
    }
  }, []);

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // 폴더 선택은 OS 순서가 비결정적 → 경로 기준 자연 정렬로 인덱스 안정화.
    const sorted = Array.from(files).sort((a, b) => {
      const pa = (a as File & { webkitRelativePath?: string }).webkitRelativePath || a.name;
      const pb = (b as File & { webkitRelativePath?: string }).webkitRelativePath || b.name;
      return pa.localeCompare(pb, undefined, { numeric: true });
    });
    const tiles = await loadTiles(sorted);
    addTiles(tiles);
    e.target.value = "";
  };

  const onRegistry = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      loadRegistry(JSON.parse(await f.text()));
    } catch (err) {
      alert("레지스트리 로드 실패: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // 몬스터/NPC 카탈로그 로드. 게임 CSV 를 변환 없이 **여러 장 한 번에** 받는다 —
  //   클래스표가 NPC/몬스터로 쪼개지고 이름이 로컬라이즈 표(ST_*)로 빠져 한 장으로는 부족하다.
  //   판별은 파일명이 아니라 헤더로 하므로 순서·개수·추가 파일에 무관하다(buildCatalogFromCsv).
  //   JSON 스냅샷 1장도 그대로 지원(구 경로).
  const onNpcCatalog = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    try {
      const sources = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
      // JSON 스냅샷 1장이면 구 경로로. (CSV 와 섞어 넣는 건 지원하지 않는다 — 의미가 모호하다.)
      const head = sources[0].text.trimStart();
      const isJson = sources.length === 1 && (head.startsWith("{") || head.startsWith("["));
      if (isJson) {
        loadNpcCatalog(JSON.parse(sources[0].text));
        return;
      }
      const { entries, warnings, stats } = buildCatalogFromCsv(sources);
      if (entries.length > 0) setNpcCatalog(catalogFromEntries(entries));
      if (warnings.length > 0) {
        alert(
          `NPC목록 ${entries.length}종 불러옴 (NPC ${stats.npc} · 몬스터 ${stats.monster})\n\n` +
            warnings.map((w) => "• " + w).join("\n"),
        );
      }
    } catch (err) {
      alert("NpcClass 카탈로그 로드 실패: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // 서버 레지스트리로 등록/신규 판정 (오프라인 파일 로드의 온라인 버전)
  const onResolveOnline = async () => {
    if (palette.length === 0) return;
    // 이미 RUID 보유한 타일(스토리지에서 가져온 등록 타일)은 조회 제외 — 권위 있는 RUID 유지.
    const targets = palette.filter((t) => !t.ruid);
    if (targets.length === 0) {
      alert("미등록 타일이 없습니다 — 모두 등록 상태입니다.");
      return;
    }
    setBusy("resolve");
    try {
      const results = await resolveTiles(targets.map((t) => ({ name: t.name, hash: t.hash })));
      applyResolutions(results);
    } catch (err) {
      alert("서버 조회 실패: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy("");
    }
  };

  // 신규(미등록) 타일 PNG 업로드 → RUID 확보 → 상태 갱신.
  const onUploadNew = async () => {
    const secret = getSecret();
    if (!secret) return;
    const targets = palette
      .filter((t) => t.regStatus === "new" && t.url.startsWith("data:"))
      .map((t) => ({ name: t.name, hash: t.hash, dataBase64: t.url.split(",")[1] ?? "" }))
      .filter((t) => t.dataBase64);
    if (targets.length === 0) {
      alert("업로드할 신규 타일(PNG 보유)이 없습니다.");
      return;
    }
    if (!window.confirm(`신규 타일 ${targets.length}개를 그룹 스토리지에 업로드할까요? (외부 동작)`)) return;
    setBusy("upload");
    try {
      const res = await uploadTiles(targets, secret);
      applyResolutions([
        ...res.uploaded.map((u) => ({ name: u.name, status: "registered" as RegStatus, ruid: u.ruid })),
        ...res.skipped.map((u) => ({ name: u.name, status: "registered" as RegStatus, ruid: u.ruid })),
      ]);
      const msg = `업로드 ${res.uploaded.length} · 건너뜀 ${res.skipped.length} · 실패 ${res.failed.length}`;
      if (res.failed.length) {
        alert(msg + "\n실패: " + res.failed.map((f) => `${f.name}: ${f.error}`).join("\n"));
      }
    } catch (err) {
      alert("업로드 실패: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy("");
    }
  };

  // 등록/신규 카운트 (palette 가 레지스트리 로드 시 새 배열로 바뀌어 자동 갱신)
  const registered = palette.filter((t) => t.ruid).length;
  const isNew = palette.filter((t) => t.regStatus === "new").length;

  // 카테고리별 그룹 — 표시용. 원래 인덱스(paletteIdx)는 보존(ground/export 가 그 인덱스를 씀).
  const groups = useMemo(() => {
    const m = new Map<string, Array<{ t: PaletteTile; i: number }>>();
    palette.forEach((t, i) => {
      if (gameSync && (!t.ruid || !groundBrushRuids?.includes(t.ruid))) return;
      const c = t.category || DEFAULT_CATEGORY;
      const arr = m.get(c);
      if (arr) arr.push({ t, i });
      else m.set(c, [{ t, i }]);
    });
    return [...m.entries()];
  }, [palette, gameSync, groundBrushRuids]);

  const toggleCat = (c: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });

  // 화면 표시 순서(접힌 그룹 제외)의 팔레트 인덱스 — Shift 범위는 이 순서를 따른다.
  const visibleOrder = useMemo(
    () => groups.filter(([cat]) => !collapsed.has(cat)).flatMap(([, items]) => items.map((x) => x.i)),
    [groups, collapsed],
  );

  // 타일 클릭: 일반=단일선택+활성, Shift=직전 기준부터 화면순서 범위 선택.
  const onTileClick = (e: React.MouseEvent, i: number) => {
    if (e.shiftKey && anchor !== null) {
      const a = visibleOrder.indexOf(anchor);
      const b = visibleOrder.indexOf(i);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(visibleOrder.slice(lo, hi + 1)));
        setActiveIdx(i);
        return;
      }
    }
    setSelected(new Set([i]));
    setAnchor(i);
    setActiveIdx(i);
  };

  // 우클릭: 선택에 없던 타일이면 그것만 선택한 뒤 메뉴 표시(파일 탐색기 관례).
  const onTileContext = (e: React.MouseEvent, i: number) => {
    e.preventDefault();
    if (gameSync) return;
    if (!selected.has(i)) {
      setSelected(new Set([i]));
      setAnchor(i);
      setActiveIdx(i);
    }
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const deleteSelected = () => {
    const targets = [...selected];
    setMenu(null);
    if (targets.length === 0) return;
    const names = targets
      .map((i) => palette[i]?.name)
      .filter(Boolean)
      .slice(0, 5)
      .join(", ");
    const more = targets.length > 5 ? ` 외 ${targets.length - 5}개` : "";
    if (!window.confirm(`팔레트 타일 ${targets.length}개(${names}${more})를 삭제할까요?\n이 타일로 칠한 셀도 함께 지워집니다.`)) return;
    removeTiles(targets);
    setSelected(new Set());
    setAnchor(null);
  };

  // 메뉴 바깥 클릭 / Esc / 스크롤 시 닫기.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  return (
    <div className="palette">
      {gameSync && <div className="palette-head"><strong>바닥 소재</strong><small>큰 타일은 자동 배치</small></div>}
      {!gameSync && <div className="palette-head">
        <span>팔레트 ({palette.length})</span>
        <button onClick={() => fileRef.current?.click()} title="PNG 이미지 파일 추가 (여러 장 선택)">
          + PNG
        </button>
        <button onClick={() => dirRef.current?.click()} title="폴더 통째로 PNG 추가 — 폴더명이 카테고리가 됩니다">
          + 폴더
        </button>
        <button
          className="palette-clear"
          disabled={palette.length === 0}
          title="팔레트를 모두 비웁니다. 팔레트로 칠한 바닥 타일도 함께 지워집니다(오브젝트·포탈·몬스터·NPC는 유지)."
          onClick={() => {
            if (palette.length === 0) return;
            if (!window.confirm("팔레트를 초기화할까요?\n\n팔레트 타일과 그 타일로 칠한 바닥이 모두 지워집니다.\n(배치한 오브젝트·포탈·몬스터·NPC는 그대로 유지됩니다.)")) return;
            clearPalette();
            setSelected(new Set());
            setAnchor(null);
          }}
        >
          초기화
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
        <input ref={dirRef} type="file" multiple hidden onChange={onFiles} />
      </div>}
      {!gameSync && <div className="palette-subhead">
        <button className="reg-load" onClick={() => regRef.current?.click()} title="RUID 매핑 JSON 불러오기(이미지 아님) — 오프라인: tile_registry.json / palette_ruids.json">
          RUID파일
        </button>
        <input ref={regRef} type="file" accept="application/json,.json" hidden onChange={onRegistry} />
        <button className="reg-load" onClick={() => npcRef.current?.click()} title={`몬스터/NPC 종류 카탈로그 불러오기 — 게임 CSV 를 여러 장 한 번에 선택하세요:\n  DataSet/npc/DT_NpcClass.csv + monster/DT_MonsterClass.csv\n  + locale/ST_NpcName.csv + ST_MonsterName.csv (이름 표시용)\nJSON 스냅샷 1장도 가능. 현재 ${npcCount}종`}>
          NPC목록({npcCount})
        </button>
        <input ref={npcRef} type="file" accept="application/json,.json,text/csv,.csv" multiple hidden onChange={onNpcCatalog} />
        <button className="reg-load" onClick={onResolveOnline} disabled={busy !== "" || palette.length === 0} title="서버 /api/resolve 로 등록여부 조회">
          {busy === "resolve" ? "조회중…" : "서버 조회"}
        </button>
        <button className="reg-load" onClick={onUploadNew} disabled={busy !== "" || isNew === 0} title="신규 타일 /api/upload (외부 동작)">
          {busy === "upload" ? "업로드중…" : `업로드(${isNew})`}
        </button>
        <button className="reg-load" onClick={() => setBrowseOpen(true)} disabled={busy !== ""} title="그룹 소유 리소스 스토리지에서 불러오기">
          스토리지
        </button>
        <span className="reg-count">
          <span className="reg">✓{registered}</span> · <span className="new">●{isNew}</span>
        </span>
      </div>}
      <div className="palette-body">
        {palette.length === 0 && <div className="palette-empty">PNG 타일을 추가하세요</div>}
        {groups.map(([cat, items]) => {
          const isCol = collapsed.has(cat);
          return (
            <div className="palette-section" key={cat}>
              <button className="palette-section-head" onClick={() => toggleCat(cat)}>
                <span className={"sec-chev" + (isCol ? " col" : "")}>▾</span>
                <span className="sec-name">{cat}</span>
                <span className="sec-count">{items.length}</span>
              </button>
              {!isCol && (
                <div className="palette-grid">
                  {items.map(({ t, i }) => (
                    <button
                      key={i}
                      className={
                        "ptile" +
                        // 활성 타일 하이라이트 — 브러시/배치(엔티티) 도구 모두. 커서·지우개 등은 제외.
                        (i === activeIdx && (activeTool === "brush" || isEntityKind(activeTool)) ? " sel" : "") +
                        (selected.has(i) ? " msel" : "")
                      }
                      title={tileTitle(t)}
                      onClick={(e) => onTileClick(e, i)}
                      onContextMenu={(e) => onTileContext(e, i)}
                    >
                      <span className="ptile-thumb">
                        {t.url ? (
                          <img src={t.url} alt={t.name} />
                        ) : (
                          <span className="ptile-swatch" style={{ background: fallbackColor(i) }} />
                        )}
                        {t.regStatus && (
                          <span className={"ptile-badge " + BADGE[t.regStatus].cls}>{BADGE[t.regStatus].sym}</span>
                        )}
                      </span>
                      <span className="ptile-name">{t.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!gameSync && browseOpen && <ResourceBrowser onClose={() => setBrowseOpen(false)} />}
      {!gameSync && menu && (
        <div
          className="palette-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className="pm-del" onClick={deleteSelected}>
            🗑 삭제{selected.size > 1 ? ` (${selected.size}개)` : ""}
          </button>
        </div>
      )}
    </div>
  );
}
