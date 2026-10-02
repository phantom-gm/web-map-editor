import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { beginProjectLoad, finishProjectLoad, loadEditorProject, clearWorkspaceSession, preserveCurrentWork, saveManagedProject, useWorkspaceSession } from "../lib/gameWorkspace";
import { isProjectFile } from "../lib/projectIO";
import { driftMessage, pendingDrift } from "../lib/exportDrift";
import { entityIssues } from "../lib/validate";
import { makeEntityImageLookup } from "../lib/entityImage";
import { fsaAvailable, saveProject, openProjectViaPicker, resetFileHandle, currentFileName } from "../lib/projectFile";

export function FileMenu() {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(currentFileName());
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const doSaveRef = useRef<((forceNew: boolean) => Promise<void>) | null>(null);
  const mapName = useEditorStore((s) => s.mapName);
  const linked = useEditorStore(s => !!s.gameSync);
  const loading = useWorkspaceSession(s => s.loading);
  const dirty = useEditorStore((s) => s.dirty);

  // 바깥 클릭 시 닫기.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Cmd/Ctrl+S → 저장 (브라우저 기본 저장 다이얼로그 차단).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // e.code(물리 S키) — 한글 IME 에서도 동작.
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyS") {
        e.preventDefault();
        void doSaveRef.current?.(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const suggestedName = () => useEditorStore.getState().gameSync ? mapName + ".synced.json" : `${(mapName || "project").replace(/[^\w.-]+/g, "_")}.json`;

  const applyProjectText = async (text: string, token: number, acceptFile?: () => void) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert("JSON 파싱 실패 — 올바른 프로젝트 파일이 아닙니다.");
      return;
    }
    if (!isProjectFile(parsed)) {
      alert("프로젝트 파일이 아닙니다 (web-map-editor-project). 게임 blueprint 는 상단 Import 를 쓰세요.");
      return;
    }
    try {
      if (await loadEditorProject(parsed, token, undefined, acceptFile)) setFileName(currentFileName());
    } catch (error) {
      alert("프로젝트 열기 실패: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const doNew = async () => {
    setOpen(false);
    if (!window.confirm("새 프로젝트로 시작할까요? 현재 맵(칠한 셀·이동불가)이 초기화됩니다. (팔레트는 유지)")) return;
    if (!await preserveCurrentWork()) return;
    clearWorkspaceSession();
    useEditorStore.getState().newProject();
    resetFileHandle();
    setFileName(null);
  };

  const doSave = async (forceNew: boolean) => {
    if (useWorkspaceSession.getState().loading) return;
    setOpen(false);
    // 저장 전 미완성 엔티티 경고(변환기 fail-closed 전에 잡기).
    // hasImage: 이미지 미해석 오브젝트는 export 가 scale 을 누락(게임서 거대 배치) — 사전 경고(D7).
    const st = useEditorStore.getState();
    if (st.gameSync && !forceNew) {
      try { await saveManagedProject(); }
      catch (error) { alert("작업 저장 실패: " + (error instanceof Error ? error.message : String(error))); }
      return;
    }
    const imageOf = makeEntityImageLookup(st.palette);
    const issues = entityIssues(st.entities, st.size, st.npcCatalog.byId, (e) => {
      const img = imageOf(e);
      return !!img && (img.naturalWidth || 0) > 0;
    });
    if (!st.gameSync && issues.length > 0) {
      const head = issues.slice(0, 8).map((s) => "• " + s).join("\n");
      const more = issues.length > 8 ? `\n…외 ${issues.length - 8}건` : "";
      if (!window.confirm(`저장 전 검증 ${issues.length}건 — 이대로 저장하면 게임 변환·빌드가 거부합니다:\n${head}${more}\n\n그대로 저장할까요?`)) return;
    }
    // 에디터 밖에서 고친 파생값(게임 쪽 json 손수정)이 이 저장으로 되돌아가는가 — 열 때 기억한 것 중 아직 바뀌게 될 것만.
    const drift = pendingDrift(st.loadDrift, st.entities, st.palette);
    if (!st.gameSync && drift.length > 0 && !window.confirm(`${driftMessage(drift)}\n\n그대로 저장할까요?`)) return;
    const savedSnapshot = JSON.stringify(useEditorStore.getState().exportProject());
    const json = JSON.stringify(JSON.parse(savedSnapshot), null, 2);
    try {
      const name = await saveProject(json, suggestedName(), forceNew);
      if (name) {
        setFileName(currentFileName() ?? name);
        if (!st.gameSync && JSON.stringify(useEditorStore.getState().exportProject()) === savedSnapshot) useEditorStore.getState().markSaved();
      }
    } catch (err) {
      alert("저장 실패: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // 단축키가 항상 최신 doSave 를 참조하도록 ref 동기화(렌더 중 변경 금지 → 이펙트).
  useEffect(() => {
    doSaveRef.current = doSave;
  });

  const doOpen = async () => {
    setOpen(false);
    try {
      if (!await preserveCurrentWork()) return;
      if (fsaAvailable) {
        const token = beginProjectLoad();
        try {
          const result = await openProjectViaPicker();
          if (result) await applyProjectText(result.text, token, result.accept);
        } finally { finishProjectLoad(token); }
      } else inputRef.current?.click();
    } catch (error) { alert("열기 실패: " + (error instanceof Error ? error.message : String(error))); }
  };

  const onInputFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let token: number | undefined;
    try {
      if (!await preserveCurrentWork()) return;
      token = beginProjectLoad();
      await applyProjectText(await file.text(), token);
    } catch (error) {
      alert("열기 실패: " + (error instanceof Error ? error.message : String(error)));
    } finally { if (token !== undefined) finishProjectLoad(token); }
  };
  return (
    <div className="filemenu" ref={rootRef}>
      <button
        className={open ? "fm-trigger open" : "fm-trigger"}
        disabled={loading}
        onClick={() => setOpen((v) => !v)}
        title={(dirty ? "● 미저장 변경 있음 — " : "") + (fileName ? `현재 파일: ${fileName}` : "프로젝트 파일 (.json)")}
      >
        파일{dirty && <span className="fm-dirty">●</span>} ▾
      </button>
      {open && (
        <div className="fm-menu">
          <button onClick={doNew}>새로 만들기</button>
          <button onClick={doOpen}>파일 사본 열기…</button>
          <button onClick={() => doSave(false)}>{linked ? "작업 저장" : "저장"} (⌘/Ctrl+S)</button>
          <button onClick={() => doSave(true)}>{linked ? "파일 사본 저장…" : "다른 이름으로 저장…"}</button>
          {fileName && <div className="fm-current" title={fileName}>📄 {fileName}</div>}
        </div>
      )}
      <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={onInputFile} />
    </div>
  );
}
