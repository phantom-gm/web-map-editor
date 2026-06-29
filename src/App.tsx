import { TopBar } from "./components/TopBar";
import { Toolbar } from "./components/Toolbar";
import { PalettePanel } from "./components/PalettePanel";
import { CanvasGrid } from "./components/CanvasGrid";
import { StatusBar } from "./components/StatusBar";

export default function App() {
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
