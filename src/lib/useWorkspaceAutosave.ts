import { useEffect } from "react";
import { useEditorStore } from "../store/editorStore";
import { saveManagedProject, useWorkspaceSession } from "./gameWorkspace";

export function useWorkspaceAutosave(): void {
  const gameSync = useEditorStore(s => s.gameSync);
  const dirty = useEditorStore(s => s.dirty);
  const groundVer = useEditorStore(s => s.groundVer);
  const blockedVer = useEditorStore(s => s.blockedVer);
  const gameObjectsVer = useEditorStore(s => s.gameObjectsVer);
  const palette = useEditorStore(s => s.palette);
  const session = useWorkspaceSession();
  useEffect(() => {
    if (!gameSync || !dirty || session.loading || session.baselineId !== gameSync.baselineId || session.status === "error" || session.status === "saving") return;
    const timer = setTimeout(() => { void saveManagedProject().catch(() => undefined); }, 1000);
    return () => clearTimeout(timer);
  }, [gameSync, dirty, groundVer, blockedVer, gameObjectsVer, palette, session.baselineId, session.loading, session.status]);
}