import { create } from "zustand";
import type { GamePreviewImages, GamePreviewScene } from "../lib/gamePreview";

export interface GamePreviewState {
  status: "idle" | "loading" | "ready" | "error";
  baselineId: string | null;
  scene: GamePreviewScene | null;
  images: GamePreviewImages;
  error: string | null;
  warnings: string[];
  missingImages: number;
  showScene: boolean;
  showOverlays: boolean;
  refreshNonce: number;
  setShowScene: (show: boolean) => void;
  setShowOverlays: (show: boolean) => void;
  refresh: () => void;
}
export const useGamePreviewStore = create<GamePreviewState>((set) => ({
  status: "idle", baselineId: null, scene: null, images: new Map(),
  error: null, warnings: [], missingImages: 0, showScene: true, showOverlays: false, refreshNonce: 0,
  setShowScene: (showScene) => set({ showScene }),
  setShowOverlays: (showOverlays) => set({ showOverlays }),
  refresh: () => set(state => ({ refreshNonce: state.refreshNonce + 1 })),
}));
