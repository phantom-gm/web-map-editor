import { useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { loadTiles, fallbackColor, type PaletteTile } from "../lib/palette";
import type { RegStatus } from "../lib/registry";
import { resolveTiles, uploadTiles } from "../lib/apiClient";

// 공유 시크릿 — 세션 보관. 없으면 1회 프롬프트.
function getSecret(): string {
  let s = sessionStorage.getItem("editorSecret") ?? "";
  if (!s) {
    s = window.prompt("백엔드 공유 시크릿 입력 (x-editor-secret)") ?? "";
    if (s) sessionStorage.setItem("editorSecret", s);
  }
  return s;
}

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
  const fileRef = useRef<HTMLInputElement>(null);
  const regRef = useRef<HTMLInputElement>(null);
  const palette = useEditorStore((s) => s.palette);
  const activeIdx = useEditorStore((s) => s.activeIdx);
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveIdx = useEditorStore((s) => s.setActiveIdx);
  const addTiles = useEditorStore((s) => s.addTiles);
  const loadRegistry = useEditorStore((s) => s.loadRegistry);
  const applyResolutions = useEditorStore((s) => s.applyResolutions);
  const [busy, setBusy] = useState<"" | "resolve" | "upload">("");

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const tiles = await loadTiles(Array.from(files));
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

  // 서버 레지스트리로 등록/신규 판정 (오프라인 파일 로드의 온라인 버전)
  const onResolveOnline = async () => {
    const secret = getSecret();
    if (!secret || palette.length === 0) return;
    setBusy("resolve");
    try {
      const results = await resolveTiles(palette.map((t) => ({ name: t.name, hash: t.hash })), secret);
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

  return (
    <div className="palette">
      <div className="palette-head">
        <span>팔레트 ({palette.length})</span>
        <button onClick={() => fileRef.current?.click()}>+ PNG</button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
      </div>
      <div className="palette-subhead">
        <button className="reg-load" onClick={() => regRef.current?.click()} title="오프라인: tile_registry.json / palette_ruids.json">
          파일
        </button>
        <input ref={regRef} type="file" accept="application/json,.json" hidden onChange={onRegistry} />
        <button className="reg-load" onClick={onResolveOnline} disabled={busy !== "" || palette.length === 0} title="서버 /api/resolve 로 등록여부 조회">
          {busy === "resolve" ? "조회중…" : "서버 조회"}
        </button>
        <button className="reg-load" onClick={onUploadNew} disabled={busy !== "" || isNew === 0} title="신규 타일 /api/upload (외부 동작)">
          {busy === "upload" ? "업로드중…" : `업로드(${isNew})`}
        </button>
        <span className="reg-count">
          <span className="reg">✓{registered}</span> · <span className="new">●{isNew}</span>
        </span>
      </div>
      <div className="palette-grid">
        {palette.length === 0 && <div className="palette-empty">PNG 타일을 추가하세요</div>}
        {palette.map((t, i) => (
          <button
            key={i}
            className={"ptile" + (i === activeIdx && activeTool === "brush" ? " sel" : "")}
            title={tileTitle(t)}
            onClick={() => setActiveIdx(i)}
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
    </div>
  );
}
