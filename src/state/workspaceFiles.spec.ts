import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, destroy } = vi.hoisted(() => ({ invoke: vi.fn(), destroy: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ destroy }) }));

import { requestDocumentClose, requestWorkspaceClose, resolveClose, useCloseConfirmation } from "@/commands/closeDocuments";
import { listAutosaveSnapshots, runRestoreAutosave, runSaveDocument, writeAutosaveSnapshots } from "@/commands/documentIO";
import { readSourcePart, runUpdateViews } from "@/commands/drawingCommands";
import { DOCUMENT_FORMAT_VERSION } from "@/io/documentValidation";
import { contentHash } from "@/kernel/rebuildCache";
import { createDocument, useDocumentStore } from "./documentStore";
import { useSettingsStore } from "./settingsStore";
import { useWorkspaceStore } from "./workspaceStore";

const openPath = "C:/models/existing.mabucad";

function partText() {
  return JSON.stringify({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    document: createDocument("part", "Existing part"),
    sketches: {},
    unitSystem: "MMGS",
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function encode(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      get length() { return entries.size; },
      key: (index: number) => [...entries.keys()][index] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    },
  });
  invoke.mockReset();
  destroy.mockReset().mockResolvedValue(undefined);
  useCloseConfirmation.setState(useCloseConfirmation.getInitialState());
  useSettingsStore.setState({ confirmBeforeDiscard: true });
  useWorkspaceStore.setState({ sessions: [], savingSessionId: null });
  useWorkspaceStore.getState().newDocument("part");
});

describe("document file workflow", () => {
  it("confirms the first save of an opened file and retains the destination on its original tab", async () => {
    const text = partText();
    invoke.mockResolvedValueOnce(openPath).mockResolvedValueOnce(encode(text));
    await useWorkspaceStore.getState().openFromDisk();
    const tabId = useWorkspaceStore.getState().activeId;
    const { promise, resolve } = deferred<string>();
    invoke.mockReturnValueOnce(promise).mockResolvedValueOnce(undefined);

    const save = useWorkspaceStore.getState().saveDocument(tabId);
    expect(invoke).toHaveBeenLastCalledWith("pick_save_path", expect.objectContaining({ initialPath: openPath }));

    useWorkspaceStore.getState().newDocument("drawing");
    const otherTab = useWorkspaceStore.getState().activeId;
    resolve(openPath);
    await expect(save).resolves.toEqual({ id: tabId, clean: true });

    expect(useWorkspaceStore.getState().sessions.find(({ id }) => id === otherTab)?.filePath).toBeNull();
    useWorkspaceStore.getState().switchTo(tabId);
    invoke.mockResolvedValueOnce(undefined);
    await useWorkspaceStore.getState().saveDocument(tabId);
    expect(invoke).toHaveBeenLastCalledWith("write_binary_file", expect.objectContaining({ path: openPath }));
    expect(invoke.mock.calls.filter(([command]) => command === "pick_save_path")).toHaveLength(1);
  });

  it("clears only the saved tab's recovery and restores other work into a separate tab", async () => {
    useDocumentStore.getState().renameDocument("Unsaved model");
    const firstId = useWorkspaceStore.getState().activeId;
    useWorkspaceStore.getState().newDocument("part");
    useDocumentStore.getState().renameDocument("Saved model");
    writeAutosaveSnapshots();
    expect(listAutosaveSnapshots()).toHaveLength(2);

    const otherPath = "C:/models/saved.mabucad";
    invoke.mockResolvedValueOnce(otherPath).mockResolvedValueOnce(undefined);
    await runSaveDocument();

    const snapshots = listAutosaveSnapshots();
    expect(snapshots.map(({ content }) => content.document.name)).toEqual(["Unsaved model"]);
    const secondId = useWorkspaceStore.getState().activeId;
    runRestoreAutosave(snapshots[0]!.key);

    const workspace = useWorkspaceStore.getState();
    expect(workspace.activeId).not.toBe(firstId);
    expect(workspace.sessions.find(({ id }) => id === secondId)?.filePath).toBe(otherPath);
    expect(workspace.sessions.find(({ id }) => id === workspace.activeId)?.filePath).toBeNull();
    expect(useDocumentStore.getState().document.name).toBe("Unsaved model");
  });
});

describe("close protection", () => {
  it("keeps the workspace open when a Save All dialog is cancelled and retries only unsaved tabs", async () => {
    useDocumentStore.getState().renameDocument("First model");
    const first = useWorkspaceStore.getState().activeId;
    useWorkspaceStore.getState().newDocument("part");
    useDocumentStore.getState().renameDocument("Second model");
    const second = useWorkspaceStore.getState().activeId;

    expect(requestWorkspaceClose()).toBe(true);
    expect(useCloseConfirmation.getState().documents.map(({ id }) => id)).toEqual([first, second]);
    invoke.mockResolvedValueOnce("C:/models/first.mabucad").mockResolvedValueOnce(undefined).mockResolvedValueOnce(null);
    await resolveClose("save");

    expect(destroy).not.toHaveBeenCalled();
    expect(useCloseConfirmation.getState().error).toBe("save");
    expect(useCloseConfirmation.getState().documents).toEqual([{ id: second, name: "Second model" }]);
    expect(useWorkspaceStore.getState().activeId).toBe(second);
    const saved = invoke.mock.calls.find(([command]) => command === "write_binary_file")?.[1];
    expect(JSON.parse(new TextDecoder().decode(Uint8Array.from(saved.contents))).document.name).toBe("First model");

    invoke.mockClear().mockResolvedValueOnce("C:/models/second.mabucad").mockResolvedValueOnce(undefined);
    await resolveClose("save");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith("write_binary_file", expect.objectContaining({ path: "C:/models/second.mabucad" }));
    expect(destroy).toHaveBeenCalledOnce();
    expect(useCloseConfirmation.getState().target).toBeNull();
  });

  it("protects a dirty background tab and closes a clean tab immediately", async () => {
    useDocumentStore.getState().renameDocument("Unsaved");
    const unsaved = useWorkspaceStore.getState().activeId;
    useWorkspaceStore.getState().newDocument("part");
    const clean = useWorkspaceStore.getState().activeId;

    requestDocumentClose(unsaved);
    await resolveClose("cancel");
    expect(useWorkspaceStore.getState().sessions.map(({ id }) => id)).toEqual([unsaved, clean]);

    requestDocumentClose(unsaved);
    await resolveClose("discard");
    expect(useWorkspaceStore.getState().sessions.map(({ id }) => id)).toEqual([clean]);

    requestDocumentClose(clean);
    expect(useCloseConfirmation.getState().target).toBeNull();
    expect(useWorkspaceStore.getState().activeId).not.toBe(clean);
  });
});

describe("drawing source workflow", () => {
  it("prompts for a source whose file permission has expired", async () => {
    const replacement = "C:/new-folder/existing.mabucad";
    invoke.mockRejectedValueOnce("Read approval expired").mockResolvedValueOnce(replacement)
      .mockResolvedValueOnce(encode(partText()));

    await expect(readSourcePart({ path: openPath, fileName: "existing.mabucad" }, "Pick the source")).resolves
      .toMatchObject({ label: "existing.mabucad", path: replacement });
    expect(invoke).toHaveBeenNthCalledWith(2, "pick_open_path", { extensions: ["mabucad", "json"] });
  });

  it("leaves another tab untouched if the user switches during a drawing update", async () => {
    const text = partText();
    useWorkspaceStore.getState().newDocument("drawing");
    const sheet = useDocumentStore.getState().document.drawing!;
    const views = [{ kind: "standard", id: "standard-view" }] as typeof sheet.views;
    useDocumentStore.getState().setDrawingSheet({
      ...sheet,
      sourcePart: { fileName: "existing.mabucad", path: openPath },
      sourceContentHash: contentHash(text),
      views,
    });

    const { promise: waiting, resolve: started } = deferred<void>();
    const { promise: stamp, resolve } = deferred<{ modifiedMs: number; size: number }>();
    invoke.mockResolvedValueOnce(encode(text)).mockImplementationOnce(() => {
      started();
      return stamp;
    });
    const update = runUpdateViews();
    await waiting;

    useWorkspaceStore.getState().newDocument("part");
    resolve({ modifiedMs: 100, size: text.length });
    await update;
    expect(useDocumentStore.getState().document.drawing).toBeUndefined();
  });
});

