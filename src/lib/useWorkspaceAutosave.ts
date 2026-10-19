import { useEffect } from "react";
import { useEditorStore } from "../store/editorStore";
import { saveManagedProject, useWorkspaceSession } from "./gameWorkspace";

const AUTOSAVE_DELAY_MS = 1000;
const RETRY_MAX_MS = 60_000;
/** After a failed save, retry with exponential backoff instead of stopping for good. A revision
 *  conflict (409) means another window saved first, so it waits for the user to resolve it. */
export function autosaveDelay(status: string, errorStatus: number | null | undefined, failures: number | undefined): number | null {
  if (status === "saving") return null;
  if (status !== "error") return AUTOSAVE_DELAY_MS;
  if (errorStatus === 409) return null;
  return Math.min(RETRY_MAX_MS, 2000 * 2 ** Math.max(0, (failures ?? 1) - 1));
}

export function useWorkspaceAutosave(): void {
  const gameSync = useEditorStore(s => s.gameSync);
  const dirty = useEditorStore(s => s.dirty);
  const groundVer = useEditorStore(s => s.groundVer);
  const blockedVer = useEditorStore(s => s.blockedVer);
  const gameRuntimeVer = useEditorStore(s => s.gameRuntimeVer);
  const gameNpcsVer = useEditorStore(s => s.gameNpcsVer);
  const gameObjectsVer = useEditorStore(s => s.gameObjectsVer);
  const palette = useEditorStore(s => s.palette);
  const session = useWorkspaceSession();
  useEffect(() => {
    const delay = autosaveDelay(session.status, session.errorStatus, session.failures);
    if (!gameSync || !dirty || session.loading || session.baselineId !== gameSync.baselineId || delay === null) return;
    const timer = setTimeout(() => { void saveManagedProject().catch(() => undefined); }, delay);
    return () => clearTimeout(timer);
  }, [gameSync, dirty, groundVer, blockedVer, gameObjectsVer, gameNpcsVer, gameRuntimeVer, palette, session.baselineId, session.loading, session.status, session.errorStatus, session.failures]);
}