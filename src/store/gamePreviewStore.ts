import { create } from "zustand";
import type { GamePreviewImages, GamePreviewScene } from "../lib/gamePreview";

import type { GameBaselinePreview, GameComparison, GameComparisonFilters } from "../lib/gameComparison";

export interface GamePreviewState {
  comparisonEnabled: boolean;
  comparisonMode: "edited" | "original" | "changes";
  comparisonBaseline: GameBaselinePreview | null;
  comparison: GameComparison | null;
  comparisonFilters: GameComparisonFilters;
  setComparisonEnabled: (enabled: boolean) => void;
  setComparisonMode: (mode: "edited" | "original" | "changes") => void;
  setComparisonFilter: (key: keyof GameComparisonFilters, enabled: boolean) => void;

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
  showObjects: boolean;
  placementPrototypeId: string | null;
  selectionMode: "objects" | "blocked";
  multiSelect: boolean;
  setSelectionMode: (mode: "objects" | "blocked") => void;
  setMultiSelect: (enabled: boolean) => void;
  setShowObjects: (show: boolean) => void;
  setPlacementPrototype: (id: string | null) => void;
  setShowScene: (show: boolean) => void;
  setShowOverlays: (show: boolean) => void;
  refresh: () => void;
}
export const useGamePreviewStore = create<GamePreviewState>((set) => ({
  comparisonEnabled: false, comparisonMode: "changes", comparisonBaseline: null, comparison: null,
  comparisonFilters: { ground: true, objects: true, blocked: true },
  setComparisonEnabled: (comparisonEnabled) => set({ comparisonEnabled, showScene: true, placementPrototypeId: null }),
  setComparisonMode: (comparisonMode) => set({ comparisonMode }),
  setComparisonFilter: (key, enabled) => set(state => ({ comparisonFilters: { ...state.comparisonFilters, [key]: enabled } })),
  status: "idle", baselineId: null, scene: null, images: new Map(),
  error: null, warnings: [], missingImages: 0, showScene: true, showOverlays: false, refreshNonce: 0,
  showObjects: false, placementPrototypeId: null, selectionMode: "objects", multiSelect: false,
  setSelectionMode: (selectionMode) => set({ selectionMode, placementPrototypeId: null }),
  setMultiSelect: (multiSelect) => set({ multiSelect }),
  setShowObjects: (showObjects) => set({ showObjects }),
  setPlacementPrototype: (placementPrototypeId) => set({ placementPrototypeId }),
  setShowScene: (showScene) => set({ showScene }),
  setShowOverlays: (showOverlays) => set({ showOverlays }),
  refresh: () => set(state => ({ refreshNonce: state.refreshNonce + 1 })),
}));
