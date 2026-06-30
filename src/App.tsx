import { useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { Toolbar } from "./components/Toolbar";
import { PalettePanel } from "./components/PalettePanel";
import { CanvasGrid } from "./components/CanvasGrid";
import { StatusBar } from "./components/StatusBar";
import { useEditorStore } from "./store/editorStore";
import { tilesFromStored } from "./lib/palette";
import { loadStoredPalette, saveStoredPalette } from "./lib/palettePersist";

export default function App() {
  // 영속 팔레트: 마운트 시 IndexedDB 에서 복원, 이후 palette 변경 시에만 디바운스 저장.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadStoredPalette();
      if (cancelled || stored.length === 0) return;
      const tiles = await tilesFromStored(stored);
      if (!cancelled) useEditorStore.getState().hydratePalette(tiles);
    })();

    const unsub = useEditorStore.subscribe((s, prev) => {
      if (s.palette !== prev.palette) saveStoredPalette(s.palette);
      // dirty 추적: 저장/불러오기/새로만들기(resetNonce 변경)면 해제, 그 외 콘텐츠 변경이면 설정.
      if (s.resetNonce !== prev.resetNonce) {
        if (s.dirty) useEditorStore.setState({ dirty: false });
      } else {
        const contentChanged =
          s.groundVer !== prev.groundVer ||
          s.blockedVer !== prev.blockedVer ||
          s.entitiesVer !== prev.entitiesVer ||
          s.palette !== prev.palette ||
          s.mapName !== prev.mapName ||
          s.size !== prev.size;
        if (contentChanged && !s.dirty) useEditorStore.setState({ dirty: true });
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // 미저장 변경이 있으면 페이지 이탈/닫기 시 브라우저 경고.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditorStore.getState().dirty) {
        e.preventDefault();
        e.returnValue = ""; // 일부 브라우저는 returnValue 설정이 있어야 경고 표시
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <Toolbar />
      <div className="body">
        <PalettePanel />
        <CanvasGrid />
      </div>
      <StatusBar />
    </div>
  );
}
