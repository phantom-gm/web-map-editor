import { useEffect, useRef } from "react";
import { useEditorStore } from "../store/editorStore";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import { validPreviewAsset, type GamePreviewImages, type GamePreviewScene } from "./gamePreview";
import { validateComparisonPair, type GameBaselinePreview, type GameComparison } from "./gameComparison";
import { fetchSpriteAssets, fetchSpriteStamps } from "./apiClient";

// A RUID can be updated in place (Maker/MCP). Cached entries are revalidated with a cheap
// metadata-only request at most this often, and reloaded only when their identity changed.
const REVALIDATE_MS = 60_000;
const verified = new WeakMap<GamePreviewImages, Map<string, { stamp?: string; at: number }>>();

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

/** Include original floor sprites and deleted objects so both views use their real resource metadata. */
export async function loadSceneImages(scenes: GamePreviewScene[], cache: GamePreviewImages, signal: AbortSignal) {
  const ruids = [...new Set(scenes.flatMap(scene => [
    ...scene.sprites.map(sprite => sprite.ruid),
    ...(scene.objectPrototypes ?? []).map(object => object.ruid),
    ...(scene.npcCatalog ?? []).map(npc => npc.ruid).filter(Boolean),
    ...(scene.monsterCatalog ?? []).map(m => m.ruid).filter(Boolean),
  ]))];
  // Library thumbnails (including deleted originals) do not affect the current map.
  // A comparison also includes the original scene, so its missing sprites still warn.
  const requiredRuids = new Set(scenes.flatMap(scene => scene.sprites.map(sprite => sprite.ruid)));
  let checks = verified.get(cache);
  if (!checks) { checks = new Map(); verified.set(cache, checks); }
  const now = Date.now();
  const due = ruids.filter(ruid => cache.has(ruid) && now - (checks.get(ruid)?.at ?? 0) > REVALIDATE_MS);
  const changed = new Set<string>();
  if (due.length) {
    try {
      const stamps = await fetchSpriteStamps(due, signal);
      for (const ruid of due) {
        const known = checks.get(ruid)?.stamp;
        if (stamps[ruid] && known && stamps[ruid] !== known) changed.add(ruid);
        else checks.set(ruid, { stamp: known ?? stamps[ruid], at: now });
      }
    } catch (error) {
      if (signal.aborted) throw error; // Revalidation is best-effort; keep showing cached images.
    }
  }
  const missing = ruids.filter(ruid => !cache.has(ruid) || changed.has(ruid));
  const failures: string[] = [];
  for (let offset = 0; offset < missing.length; offset += 100) {
    const batch = missing.slice(offset, offset + 100);
    const data = await fetchSpriteAssets(batch, signal);
    await Promise.all(batch.map(async ruid => {
      const asset = data.sprites?.[ruid], url = data.images?.[ruid];
      if (!url || !validPreviewAsset(asset)) { if (!changed.has(ruid)) failures.push(ruid); return; }
      try {
        const image = await loadImage(url, signal);
        if (!signal.aborted) { cache.set(ruid, { image, asset }); checks.set(ruid, { stamp: data.stamps?.[ruid], at: Date.now() }); }
      } catch (error) {
        if (signal.aborted) throw error;
        if (!changed.has(ruid)) failures.push(ruid); // A failed refresh keeps the previous image.
      }
    }));
  }
  return {
    images: new Map(ruids.flatMap(ruid => {
      const image = cache.get(ruid);
      return image ? [[ruid, image] as const] : [];
    })),
    missingImages: failures.filter(ruid => requiredRuids.has(ruid)).length,
  };
}

async function requestPreview<T>(body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch("/api/game-sync", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "게임 배치 미리보기를 불러오지 못했습니다.");
  return result as T;
}

/** Candidate and comparison views share the same compiler. Changing the view never changes the project. */
export function useGamePreview(): void {
  const gameSync = useEditorStore(state => state.gameSync);
  const groundVer = useEditorStore(state => state.groundVer);
  const blockedVer = useEditorStore(state => state.blockedVer);
  const entitiesVer = useEditorStore(state => state.entitiesVer);
  const gameRuntimeSync = useEditorStore(state => state.gameRuntimeSync);
  const gameRuntimeVer = useEditorStore(state => state.gameRuntimeVer);
  const gameNpcSync = useEditorStore(state => state.gameNpcSync);
  const gameNpcsVer = useEditorStore(state => state.gameNpcsVer);
  const gameObjectsVer = useEditorStore(state => state.gameObjectsVer);
  const palette = useEditorStore(state => state.palette);
  const size = useEditorStore(state => state.size);
  const mapName = useEditorStore(state => state.mapName);
  const refreshNonce = useGamePreviewStore(state => state.refreshNonce);
  const comparisonEnabled = useGamePreviewStore(state => state.comparisonEnabled);
  const cacheRef = useRef<{
    baselineId: string; refreshNonce: number; npcSourceId: string | null; runtimeSourceId: string | null; images: GamePreviewImages; baseline?: GameBaselinePreview;
  } | null>(null);

  useEffect(() => {
    const preview = useGamePreviewStore;
    if (!gameSync) {
      preview.setState({ status: "idle", baselineId: null, scene: null, images: new Map(),
        error: null, warnings: [], missingImages: 0, comparisonEnabled: false,
        comparison: null, comparisonBaseline: null, comparisonMode: "changes" });
      return;
    }
    const baselineId = gameSync.baselineId;
    if (cacheRef.current?.baselineId !== baselineId || cacheRef.current.refreshNonce !== refreshNonce) {
      cacheRef.current = { baselineId, refreshNonce, npcSourceId: gameNpcSync?.sourceId ?? null, runtimeSourceId: gameRuntimeSync?.sourceId ?? null, images: new Map() };
    }
    const cache = cacheRef.current;
    if (cache.npcSourceId !== (gameNpcSync?.sourceId ?? null)) { cache.npcSourceId = gameNpcSync?.sourceId ?? null; cache.baseline = undefined; }
    if (cache.runtimeSourceId !== (gameRuntimeSync?.sourceId ?? null)) { cache.runtimeSourceId = gameRuntimeSync?.sourceId ?? null; cache.baseline = undefined; }
    const controller = new AbortController();
    let active = true;
    const previous = preview.getState();
    // Opening another map exits comparison; a late request can never install its baseline into the new map.
    const changedBaseline = previous.baselineId !== baselineId;
    const comparing = comparisonEnabled && !changedBaseline;
    preview.setState({
      status: "loading", baselineId, error: null, comparison: null,
      ...(changedBaseline ? { scene: null, images: new Map(), warnings: [], missingImages: 0, placementNpcClassId: null, runtimePanel: null, runtimePlacement: null,
        comparisonEnabled: false, comparisonBaseline: null, comparisonMode: "changes" as const } : {}),
    });
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const project = useEditorStore.getState().exportProject();
          if (project.gameSync?.baselineId !== baselineId) return;
          const baselineRequest = comparing
            ? cache.baseline ? Promise.resolve(cache.baseline) : requestPreview<{ baseline: GameBaselinePreview }>({
              action: "baseline-preview", mapName: gameSync.mapName, baselineId, npcSourceId: gameNpcSync?.sourceId, runtimeSourceId: gameRuntimeSync?.sourceId,
            }, controller.signal).then(result => result.baseline)
            : Promise.resolve(null);
          const [result, baseline] = await Promise.all([
            requestPreview<{ scene: GamePreviewScene; comparison?: GameComparison }>({
              action: comparing ? "compare" : "preview", project,
            }, controller.signal),
            baselineRequest,
          ]);
          const scene = result.scene;
          if (!scene || scene.version !== 1 || scene.baselineId !== baselineId || !Array.isArray(scene.sprites)) {
            throw new Error("현재 동기화 기준과 미리보기 응답이 일치하지 않습니다.");
          }
          if (comparing && (!baseline || !result.comparison || !validateComparisonPair(baseline, scene, result.comparison))) {
            throw new Error("원본과 수정본의 비교 기준이 일치하지 않습니다. 이미지를 다시 읽어 주세요.");
          }
          const scenes = baseline ? [scene, baseline.scene] : [scene];
          const loaded = await loadSceneImages(scenes, cache.images, controller.signal);
          if (!active) return;
          if (baseline) cache.baseline = baseline;
          const warnings = [...new Set(scenes.flatMap(item => item.warnings))];
          if (loaded.missingImages) warnings.push("이미지 또는 피벗 정보를 확인하지 못한 리소스 " + loaded.missingImages + "종은 표시하지 않았습니다.");
          preview.setState({ status: "ready", scene, ...loaded, error: null, warnings, baselineId,
            comparison: comparing ? result.comparison! : null,
            comparisonBaseline: baseline ?? cache.baseline ?? null });
        } catch (error) {
          if (!active || controller.signal.aborted) return;
          preview.setState({ status: "error", comparison: null, error: error instanceof Error ? error.message : String(error) });
        }
      })();
    }, 250);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [gameSync, groundVer, blockedVer, entitiesVer, gameObjectsVer, gameNpcsVer, gameNpcSync, gameRuntimeVer, gameRuntimeSync, palette, size, mapName, refreshNonce, comparisonEnabled]);
}
