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
    });
    return () => {
      cancelled = true;
      unsub();
    };
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
