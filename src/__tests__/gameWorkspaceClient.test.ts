import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLayer } from "../types/blueprint";
import { useEditorStore } from "../store/editorStore";
import { tilesFromStored, type PaletteTile } from "../lib/palette";
import { resetFileHandle } from "../lib/projectFile";
import { PROJECT_TYPE, PROJECT_VERSION, type ProjectFileInput } from "../lib/projectIO";
import {
  beginProjectLoad, clearWorkspaceSession, finishProjectLoad, isCurrentProjectLoad,
  loadEditorProject, preserveCurrentWork, saveManagedProject, useWorkspaceSession,
  type WorkspaceReceipt,
} from "../lib/gameWorkspace";

vi.mock("../lib/palette", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/palette")>(),
  tilesFromStored: vi.fn(),
}));
vi.mock("../lib/projectFile", () => ({ resetFileHandle: vi.fn() }));

const tiles = vi.mocked(tilesFromStored);
const fetchMock = vi.fn<typeof fetch>();
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(name = "a"): ProjectFileInput {
  return {
    type: PROJECT_TYPE, version: PROJECT_VERSION, map: name,
    gameSync: { version: 1, baselineId: "baseline-" + name, mapName: name },
    size: [4, 4], groundOrigin: [0, 0], ground: [], blocked: [], palette: [],
    staticLayer: emptyLayer(), attributeBase: emptyLayer(), entities: [],
  };
}
const receipt = (revision: string): WorkspaceReceipt => ({ revision, savedAt: "2026-10-03T00:00:00.000Z" });
const response = (revision: string) => Response.json(receipt(revision));
function requestBody(index: number) {
  return JSON.parse(String(fetchMock.mock.calls[index][1]?.body)) as {
    action: string; project: ProjectFileInput; expectedRevision: string | null;
  };
}
async function open(name = "a", revision = "r0") {
  const token = beginProjectLoad();
  expect(await loadEditorProject(fixture(name), token, receipt(revision))).toBe(true);
}
function edit(x: number) {
  // Ground is mutable by design; its version signals content edits to App's dirty tracking.
  const state = useEditorStore.getState();
  state.ground.set(x + ",0", 0);
  useEditorStore.setState({ groundVer: state.groundVer + 1, dirty: true });
}
let unsubscribe: () => void;
beforeEach(() => {
  clearWorkspaceSession();
  useEditorStore.getState().newProject();
  useEditorStore.setState({ palette: [], dirty: false });
  tiles.mockReset().mockResolvedValue([]);
  fetchMock.mockReset();
  vi.mocked(resetFileHandle).mockClear();
  vi.stubGlobal("fetch", fetchMock);
  // Mirror App's resetNonce subscription without mounting a DOM or persisting a palette.
  unsubscribe = useEditorStore.subscribe((state, previous) => {
    if (state.resetNonce !== previous.resetNonce && state.dirty) useEditorStore.setState({ dirty: false });
  });
});
afterEach(() => {
  unsubscribe();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("managed workspace client races", () => {
  it("late palette images from the previous open cannot replace the latest map or receipt", async () => {
    const oldImages = deferred<PaletteTile[]>();
    const newImages = deferred<PaletteTile[]>();
    tiles.mockReturnValueOnce(oldImages.promise).mockReturnValueOnce(newImages.promise);
    const firstToken = beginProjectLoad();
    const first = loadEditorProject(fixture("a"), firstToken, receipt("a0"));
    const secondToken = beginProjectLoad();
    const second = loadEditorProject(fixture("b"), secondToken, receipt("b0"));
    finishProjectLoad(firstToken);
    expect(useWorkspaceSession.getState().loading).toBe(true);
    newImages.resolve([]);
    expect(await second).toBe(true);
    oldImages.resolve([]);
    expect(await first).toBe(false);
    expect(isCurrentProjectLoad(secondToken)).toBe(true);
    expect(useEditorStore.getState().mapName).toBe("b");
    expect(useWorkspaceSession.getState()).toMatchObject({
      baselineId: "baseline-b", revision: "b0", loading: false,
    });
  });

  it("only the accepted file load can replace the file handle", async () => {
    const oldImages = deferred<PaletteTile[]>();
    tiles.mockReturnValueOnce(oldImages.promise).mockResolvedValueOnce([]);
    const acceptOld = vi.fn();
    const acceptNew = vi.fn(() => expect(resetFileHandle).toHaveBeenCalledTimes(1));
    const first = loadEditorProject(fixture("a"), beginProjectLoad(), undefined, acceptOld);
    const second = loadEditorProject(fixture("b"), beginProjectLoad(), undefined, acceptNew);
    expect(await second).toBe(true);
    oldImages.resolve([]);
    expect(await first).toBe(false);
    expect(acceptOld).not.toHaveBeenCalled();
    expect(acceptNew).toHaveBeenCalledOnce();
    expect(resetFileHandle).toHaveBeenCalledOnce();
  });

  it("clearing the workspace invalidates a pending image load", async () => {
    const images = deferred<PaletteTile[]>();
    tiles.mockReturnValueOnce(images.promise);
    const pending = loadEditorProject(fixture(), beginProjectLoad(), receipt("r0"));
    clearWorkspaceSession();
    useEditorStore.getState().newProject();
    images.resolve([]);
    expect(await pending).toBe(false);
    expect(useEditorStore.getState().gameSync).toBeUndefined();
    expect(useWorkspaceSession.getState().baselineId).toBeNull();
  });

  it("edits made while a save is in flight remain dirty; saving their exact content clears dirty", async () => {
    await open();
    edit(0);
    const firstResponse = deferred<Response>();
    fetchMock.mockReturnValueOnce(firstResponse.promise).mockResolvedValueOnce(response("r2"));
    const first = saveManagedProject();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    edit(1);
    firstResponse.resolve(response("r1"));
    await first;
    expect(useEditorStore.getState().dirty).toBe(true);
    expect(useWorkspaceSession.getState().revision).toBe("r1");
    expect(requestBody(0).project.ground).toEqual([[0, 0, 0]]);
    await saveManagedProject();
    expect(requestBody(1).project.ground).toEqual([[0, 0, 0], [1, 0, 0]]);
    expect(requestBody(1).expectedRevision).toBe("r1");
    expect(useEditorStore.getState().dirty).toBe(false);
  });

  it("queued saves are serialized and use the preceding response's latest revision", async () => {
    await open();
    edit(0);
    const firstResponse = deferred<Response>();
    fetchMock.mockReturnValueOnce(firstResponse.promise).mockResolvedValueOnce(response("r2"));
    const first = saveManagedProject();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    edit(1);
    const second = saveManagedProject();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    firstResponse.resolve(response("r1"));
    await Promise.all([first, second]);
    expect(requestBody(0).expectedRevision).toBe("r0");
    expect(requestBody(1).expectedRevision).toBe("r1");
    expect(requestBody(1).project.ground).toHaveLength(2);
    expect(useWorkspaceSession.getState().revision).toBe("r2");
    expect(useEditorStore.getState().dirty).toBe(false);
  });

  it("a later queued save cannot mark an undo result clean when it persisted different content", async () => {
    await open();
    edit(0); // X
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    fetchMock.mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise)
      .mockResolvedValueOnce(response("r3"));
    const first = saveManagedProject();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    useEditorStore.getState().fillRect(1, 0, 1, 0); // Y, with a real undo snapshot
    const second = saveManagedProject();
    useEditorStore.getState().undo(); // X again while S1(X) and S2(Y) are pending
    expect(useEditorStore.getState().exportProject().ground).toEqual([[0, 0, 0]]);

    firstResponse.resolve(response("r1"));
    await first;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(useEditorStore.getState().dirty).toBe(false); // S1 legitimately saved X
    expect(requestBody(1).project.ground).toEqual([[0, 0, 0], [1, 0, 0]]);
    expect(requestBody(1).expectedRevision).toBe("r1");

    secondResponse.resolve(response("r2"));
    await second;
    expect(useEditorStore.getState().dirty).toBe(true); // S2 persisted Y, so X must be saved again
    expect(useWorkspaceSession.getState()).toMatchObject({ revision: "r2", status: "saved" });

    await saveManagedProject();
    expect(requestBody(2).project.ground).toEqual([[0, 0, 0]]);
    expect(requestBody(2).expectedRevision).toBe("r2");
    expect(useEditorStore.getState().dirty).toBe(false);
  });

  it("failed saves preserve dirty and revision, and the queue permits a manual retry", async () => {
    await open();
    edit(0);
    fetchMock.mockResolvedValueOnce(Response.json({ error: "disk full" }, { status: 500 }))
      .mockResolvedValueOnce(response("r1"));
    await expect(saveManagedProject()).rejects.toThrow("disk full");
    expect(useEditorStore.getState().dirty).toBe(true);
    expect(useWorkspaceSession.getState()).toMatchObject({ status: "error", error: "disk full", revision: "r0" });
    await saveManagedProject();
    expect(requestBody(1).expectedRevision).toBe("r0");
    expect(useEditorStore.getState().dirty).toBe(false);
    expect(useWorkspaceSession.getState()).toMatchObject({ status: "saved", error: null, revision: "r1" });
  });

  it.each(["success", "error"])("a late %s save response cannot affect another map session", async (outcome) => {
    await open("a", "a0");
    edit(0);
    const pendingResponse = deferred<Response>();
    fetchMock.mockReturnValueOnce(pendingResponse.promise);
    const save = saveManagedProject().catch(error => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await open("b", "b0");
    edit(2);
    pendingResponse.resolve(outcome === "success" ? response("a1") : Response.json({ error: "old failure" }, { status: 500 }));
    await save;
    expect(useEditorStore.getState().mapName).toBe("b");
    expect(useEditorStore.getState().dirty).toBe(true);
    expect(useWorkspaceSession.getState()).toMatchObject({ baselineId: "baseline-b", revision: "b0", status: "saved", error: null });
  });

  it.each(["success", "error"])("a %s save response from before A -> B -> A cannot replace the newly opened A session", async (outcome) => {
    await open("a", "a0");
    edit(0);
    const pendingResponse = deferred<Response>();
    fetchMock.mockReturnValueOnce(pendingResponse.promise);
    const oldSave = saveManagedProject().catch(error => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await open("b", "b0");
    await open("a", "a-newer");
    edit(2);
    pendingResponse.resolve(outcome === "success" ? response("a-old") : Response.json({ error: "old failure" }, { status: 500 }));
    await oldSave;
    expect(useWorkspaceSession.getState()).toMatchObject({ baselineId: "baseline-a", revision: "a-newer", status: "saved" });
    expect(useEditorStore.getState().dirty).toBe(true);
  });

  it.each([false, true])("a queued save captured before a session change is cancelled before sending (reopen=%s)", async (reopen) => {
    await open("a", "a0");
    edit(0);
    const pendingResponse = deferred<Response>();
    fetchMock.mockReturnValueOnce(pendingResponse.promise);
    const first = saveManagedProject().catch(error => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    edit(1);
    const queued = saveManagedProject().catch(error => error);
    await open("b", "b0");
    if (reopen) await open("a", "a-newer");
    pendingResponse.resolve(response("a1"));
    await first;
    expect(await queued).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useWorkspaceSession.getState().revision).toBe(reopen ? "a-newer" : "b0");
  });

  it("preserveCurrentWork does not permit a map switch with edits made during its save still unsaved", async () => {
    await open();
    edit(0);
    const pendingResponse = deferred<Response>();
    fetchMock.mockReturnValueOnce(pendingResponse.promise).mockResolvedValue(response("r2"));
    const preserve = preserveCurrentWork();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    edit(1);
    pendingResponse.resolve(response("r1"));
    const canSwitch = await preserve;
    expect(canSwitch && useEditorStore.getState().dirty).toBe(false);
  });
});

describe("native object workspace client", () => {
  it("resumes the same sparse edits before enabling the loaded session", async () => {
    const p = fixture();
    p.gameObjectEdits = { version: 1, moved: [{ entityId: "native-a", position: [1.28, -0.64] }], removed: [], added: [] };
    const token = beginProjectLoad();
    expect(await loadEditorProject(p, token, receipt("object-r0"))).toBe(true);
    expect(useEditorStore.getState().exportProject().gameObjectEdits).toEqual(p.gameObjectEdits);
    expect(useEditorStore.getState().dirty).toBe(false);
    expect(useWorkspaceSession.getState()).toMatchObject({ baselineId: p.gameSync!.baselineId, revision: "object-r0", loading: false });
  });
  it("preserves object-only edits made while a save is in flight, then saves their stable IDs", async () => {
    await open();
    useEditorStore.getState().moveGameObjectTo("native-a", [1.28, -0.64]);
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response("objects-r2"));
    const first = saveManagedProject();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const copyId = useEditorStore.getState().addGameObject("native-a", [2.56, -1.28]);
    pending.resolve(response("objects-r1"));
    await first;
    expect(useEditorStore.getState().dirty).toBe(true);
    expect(requestBody(0).project.gameObjectEdits?.added).toEqual([]);
    await saveManagedProject();
    expect(requestBody(1).expectedRevision).toBe("objects-r1");
    expect(requestBody(1).project.gameObjectEdits?.added[0].entityId).toBe(copyId);
    expect(useEditorStore.getState().dirty).toBe(false);
  });
  it("saves native object undo results without relying on App subscriptions", async () => {
    await open();
    useEditorStore.getState().moveGameObjectTo("native-a", [1.28, -0.64]);
    fetchMock.mockResolvedValueOnce(response("objects-r1")).mockResolvedValueOnce(response("objects-r2"));
    await saveManagedProject();
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().dirty).toBe(true);
    await preserveCurrentWork();
    expect(requestBody(1).project).not.toHaveProperty("gameObjectEdits");
    expect(useEditorStore.getState().dirty).toBe(false);
  });
});
