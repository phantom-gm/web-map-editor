import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { tilesFromStored } from "../lib/palette";
import { isProjectFile } from "../lib/projectIO";
import { fsaAvailable, saveProject, openProjectViaPicker, resetFileHandle, currentFileName } from "../lib/projectFile";

export function FileMenu() {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(currentFileName());
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const doSaveRef = useRef<((forceNew: boolean) => Promise<void>) | null>(null);
  const mapName = useEditorStore((s) => s.mapName);
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
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        void doSaveRef.current?.(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const suggestedName = () => `${(mapName || "project").replace(/[^\w.-]+/g, "_")}.json`;

  const applyProjectText = async (text: string) => {
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
    const tiles = await tilesFromStored(parsed.palette ?? []);
    useEditorStore.getState().loadProject(parsed, tiles);
    setFileName(currentFileName());
  };

  const doNew = () => {
    setOpen(false);
    if (!window.confirm("새 프로젝트로 시작할까요? 현재 맵(칠한 셀·이동불가)이 초기화됩니다. (팔레트는 유지)")) return;
    useEditorStore.getState().newProject();
    resetFileHandle();
    setFileName(null);
  };

  const doSave = async (forceNew: boolean) => {
    setOpen(false);
    const json = JSON.stringify(useEditorStore.getState().exportProject(), null, 2);
    try {
      const name = await saveProject(json, suggestedName(), forceNew);
      if (name) {
        setFileName(currentFileName() ?? name);
        useEditorStore.getState().markSaved(); // 저장 완료 → dirty 해제
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
    if (fsaAvailable) {
      const r = await openProjectViaPicker();
      if (r) await applyProjectText(r.text);
    } else {
      inputRef.current?.click();
    }
  };

  const onInputFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) await applyProjectText(await f.text());
  };

  return (
    <div className="filemenu" ref={rootRef}>
      <button
        className={open ? "fm-trigger open" : "fm-trigger"}
        onClick={() => setOpen((v) => !v)}
        title={(dirty ? "● 미저장 변경 있음 — " : "") + (fileName ? `현재 파일: ${fileName}` : "프로젝트 파일 (.json)")}
      >
        파일{dirty && <span className="fm-dirty">●</span>} ▾
      </button>
      {open && (
        <div className="fm-menu">
          <button onClick={doNew}>새로 만들기</button>
          <button onClick={doOpen}>열기…</button>
          <button onClick={() => doSave(false)}>저장 (⌘/Ctrl+S)</button>
          <button onClick={() => doSave(true)}>다른 이름으로 저장…</button>
          {fileName && <div className="fm-current" title={fileName}>📄 {fileName}</div>}
        </div>
      )}
      <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={onInputFile} />
    </div>
  );
}
