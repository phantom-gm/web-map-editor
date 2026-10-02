import { useEffect, useRef } from "react";
import { useEditorStore } from "../store/editorStore";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import { validPreviewAsset, type GamePreviewImages, type GamePreviewScene } from "./gamePreview";
import { fetchSpriteAssets } from "./apiClient";
function loadImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = () => signal.removeEventListener("abort", abort);
    const abort = () => { finish(); image.src = ""; reject(new DOMException("Aborted", "AbortError")); };
    image.onload = () => { finish(); resolve(image); };
    image.onerror = () => { finish(); reject(new Error("스프라이트 이미지 로딩 실패")); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    image.src = url;
  });
}

/** Scene resource metadata is authoritative. A missing pivot never becomes a guessed object placement. */
async function loadSceneImages(scene: GamePreviewScene, cache: GamePreviewImages, signal: AbortSignal) {
  // Deleted placements still remain available in the baseline-prototype library.
  const ruids = [...new Set([
    ...scene.sprites.map(sprite => sprite.ruid),
    ...(scene.objectPrototypes ?? []).map(object => object.ruid),
  ])];
  const missing = ruids.filter(ruid => !cache.has(ruid));
  const failures: string[] = [];
  for (let offset = 0; offset < missing.length; offset += 100) {
    const batch = missing.slice(offset, offset + 100);
    const data = await fetchSpriteAssets(batch, signal);
    await Promise.all(batch.map(async ruid => {
      const asset = data.sprites?.[ruid];
      const url = data.images?.[ruid];
      if (!url || !validPreviewAsset(asset)) { failures.push(ruid); return; }
      try {
        const image = await loadImage(url, signal);
        if (!signal.aborted) cache.set(ruid, { image, asset });
      } catch (error) {
        if (signal.aborted) throw error;
        failures.push(ruid);
      }
    }));
  }
  return {
    images: new Map(ruids.flatMap(ruid => {
      const image = cache.get(ruid);
      return image ? [[ruid, image] as const] : [];
    })),
    missingImages: failures.length,
  };
}

/** Debounced ground edits request the same candidate placements used by export, without writing a map. */
export function useGamePreview(): void {
  const gameSync = useEditorStore(state => state.gameSync);
  const groundVer = useEditorStore(state => state.groundVer);
  const blockedVer = useEditorStore(state => state.blockedVer);
  const entitiesVer = useEditorStore(state => state.entitiesVer);
  const gameObjectsVer = useEditorStore(state => state.gameObjectsVer);
  const palette = useEditorStore(state => state.palette);
  const size = useEditorStore(state => state.size);
  const mapName = useEditorStore(state => state.mapName);
  const refreshNonce = useGamePreviewStore(state => state.refreshNonce);
  const cacheRef = useRef<{ baselineId: string; refreshNonce: number; images: GamePreviewImages } | null>(null);

  useEffect(() => {
    const preview = useGamePreviewStore;
    if (!gameSync) {
      preview.setState({ status: "idle", baselineId: null, scene: null, images: new Map(), error: null, warnings: [], missingImages: 0 });
      return;
    }
    const baselineId = gameSync.baselineId;
    if (cacheRef.current?.baselineId !== baselineId || cacheRef.current.refreshNonce !== refreshNonce) {
      cacheRef.current = { baselineId, refreshNonce, images: new Map() };
    }
    const cache = cacheRef.current.images;
    const controller = new AbortController();
    let active = true;
    const previous = preview.getState();
    preview.setState({
      status: "loading", baselineId, error: null,
      ...(previous.baselineId !== baselineId ? { scene: null, images: new Map(), warnings: [], missingImages: 0 } : {}),
    });
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/game-sync", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "preview", project: useEditorStore.getState().exportProject() }),
            signal: controller.signal,
          });
          const result = await response.json() as { scene?: GamePreviewScene; error?: string };
          if (!response.ok) throw new Error(result.error || "게임 배치 미리보기를 불러오지 못했습니다.");
          const scene = result.scene;
          if (!scene || scene.version !== 1 || scene.baselineId !== baselineId || !Array.isArray(scene.sprites)) {
            throw new Error("현재 동기화 기준과 미리보기 응답이 일치하지 않습니다.");
          }
          const loaded = await loadSceneImages(scene, cache, controller.signal);
          if (!active) return;
          const warnings = [...scene.warnings];
          if (loaded.missingImages) warnings.push("이미지 또는 피벗 정보를 확인하지 못한 리소스 " + loaded.missingImages + "종은 표시하지 않았습니다.");
          preview.setState({ status: "ready", scene, ...loaded, error: null, warnings, baselineId });
        } catch (error) {
          if (!active || controller.signal.aborted) return;
          preview.setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
        }
      })();
    }, 250);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [gameSync, groundVer, blockedVer, entitiesVer, gameObjectsVer, palette, size, mapName, refreshNonce]);
}
