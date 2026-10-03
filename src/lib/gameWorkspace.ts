import { parseRuntimeProject } from "./gameRuntime";
import { create } from "zustand";
import { useEditorStore } from "../store/editorStore";
import { tilesFromStored } from "./palette";
import { parseGameNpcEdits, parseGameNpcSync } from "./gameNpc";
import { parseGameObjectEdits } from "./gameObjects";
import { parseGameSync, type ProjectFileInput } from "./projectIO";
import { resetFileHandle } from "./projectFile";

export interface WorkspaceReceipt { revision: string; savedAt: string }
interface WorkspaceSession {
  baselineId: string | null;
  revision: string | null;
  savedAt: string | null;
  status: "idle" | "saving" | "saved" | "error";
  error: string | null;
  loading: boolean;
}
export const useWorkspaceSession = create<WorkspaceSession>(() => ({
  baselineId: null, revision: null, savedAt: null, status: "idle", error: null, loading: false,
}));

let generation = 0;
/** One load generation is shared by disk files, game maps and blueprint import. */
export function beginProjectLoad(): number {
  generation += 1;
  useWorkspaceSession.setState({ loading: true });
  return generation;
}
export function isCurrentProjectLoad(token: number): boolean { return token === generation; }
export function finishProjectLoad(token: number): void {
  if (isCurrentProjectLoad(token)) useWorkspaceSession.setState({ loading: false });
}
export function clearWorkspaceSession(): void {
  generation += 1;
  useWorkspaceSession.setState({ baselineId: null, revision: null, savedAt: null, status: "idle", error: null, loading: false });
}
export async function loadEditorProject(project: ProjectFileInput, token: number, receipt?: WorkspaceReceipt, acceptFile?: () => void): Promise<boolean> {
  const link = parseGameSync(project.gameSync, project.map);
  if (parseGameObjectEdits(project.gameObjectEdits) && !link) throw new Error("게임 오브젝트 편집 정보에는 게임 원본 연결이 필요합니다.");
  if ((parseGameNpcEdits(project.gameNpcEdits) || parseGameNpcSync(project.gameNpcSync)) && !link) throw new Error("NPC 편집 정보에는 게임 원본 연결이 필요합니다.");
  if (Object.values(parseRuntimeProject(project)).some(Boolean) && !link) throw new Error("런타임 배치 편집에는 게임 원본 연결이 필요합니다.");
  const tiles = await tilesFromStored(project.palette ?? []);
  if (!isCurrentProjectLoad(token)) return false;
  resetFileHandle();
  acceptFile?.();
  useEditorStore.getState().loadProject(project, tiles);
  useWorkspaceSession.setState({
    baselineId: receipt ? project.gameSync?.baselineId ?? null : null,
    revision: receipt?.revision ?? null, savedAt: receipt?.savedAt ?? null,
    status: receipt ? "saved" : "idle", error: null,
  });
  finishProjectLoad(token);
  return true;
}
export async function gameRequest<T>(body: unknown): Promise<T> {
  const response = await fetch("/api/game-sync", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "로컬 맵 작업에 실패했습니다.");
  return result as T;
}
let saveQueue: Promise<unknown> = Promise.resolve();
/** Serial saves carry the latest revision; only the exact saved content clears dirty. */
export function saveManagedProject(): Promise<WorkspaceReceipt> {
  const saveGeneration = generation;
  const snapshot = JSON.stringify(useEditorStore.getState().exportProject());
  const project = JSON.parse(snapshot) as ProjectFileInput;
  const baselineId = project.gameSync?.baselineId;
  if (!baselineId) return Promise.reject(new Error("게임 맵을 먼저 열어 주세요."));
  const operation = saveQueue.catch(() => undefined).then(async () => {
    const session = useWorkspaceSession.getState();
    if (generation !== saveGeneration || useEditorStore.getState().gameSync?.baselineId !== baselineId) throw new Error("다른 맵으로 전환되어 이전 저장 요청을 취소했습니다.");
    useWorkspaceSession.setState({ status: "saving", error: null });
    try {
      const receipt = await gameRequest<WorkspaceReceipt>({
        action: "save", project, expectedRevision: session.baselineId === baselineId ? session.revision : null,
      });
      if (generation === saveGeneration && useEditorStore.getState().gameSync?.baselineId === baselineId) {
        useWorkspaceSession.setState({ baselineId, revision: receipt.revision, savedAt: receipt.savedAt, status: "saved", error: null });
        if (JSON.stringify(useEditorStore.getState().exportProject()) === snapshot) {
          useEditorStore.getState().markSaved();
        } else {
          // A preceding queued save may already have cleared dirty after an undo.
          // This receipt persisted different content, so the current draft still needs saving.
          useEditorStore.setState({ dirty: true });
        }
      }
      return receipt;
    } catch (error) {
      if (generation === saveGeneration && useEditorStore.getState().gameSync?.baselineId === baselineId) {
        useWorkspaceSession.setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  });
  saveQueue = operation;
  return operation;
}
/** A normal map switch preserves the current linked work before loading the next map. */
export async function preserveCurrentWork(): Promise<boolean> {
  const current = useEditorStore.getState();
  if (!current.dirty) return true;
  if (current.gameSync) {
    const saveGeneration = generation;
    do {
      await saveManagedProject();
      if (generation !== saveGeneration) return false;
    } while (useEditorStore.getState().dirty);
    return true;
  }
  return window.confirm("저장하지 않은 일반 프로젝트가 있습니다. 닫고 다른 맵을 열까요?");
}