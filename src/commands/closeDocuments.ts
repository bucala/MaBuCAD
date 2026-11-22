import { getCurrentWindow } from "@tauri-apps/api/window";
import { create } from "zustand";

import { saveDocumentById } from "@/commands/documentIO";
import { translateFor } from "@/i18n/useTranslation";
import { useGeometryStore } from "@/state/geometryStore";
import { useSettingsStore } from "@/state/settingsStore";
import { isSessionModified, snapshotSessions, useWorkspaceStore } from "@/state/workspaceStore";

type CloseTarget = { kind: "tab"; id: string } | { kind: "window" };
type CloseChoice = "save" | "discard" | "cancel";
type CloseError = "save" | "close";

interface CloseConfirmation {
  target: CloseTarget | null;
  documents: { id: string; name: string }[];
  busy: Exclude<CloseChoice, "cancel"> | null;
  error: CloseError | null;
}

export const useCloseConfirmation = create<CloseConfirmation>(() => ({
  target: null,
  documents: [],
  busy: null,
  error: null,
}));

function modifiedDocuments(target: CloseTarget) {
  return snapshotSessions()
    .filter((session) => (target.kind === "window" || target.id === session.id) && isSessionModified(session))
    .map((session) => ({ id: session.id, name: session.document.name }));
}

function requestConfirmation(target: CloseTarget): boolean {
  if (useCloseConfirmation.getState().target) return true;

  const { language, confirmBeforeDiscard } = useSettingsStore.getState();
  if (useWorkspaceStore.getState().savingSessionId) {
    const message = translateFor(language)("close.saving-in-progress", "A save is in progress. Try closing again when it finishes.");
    useGeometryStore.getState().showToast(message);
    return true;
  }
  if (!confirmBeforeDiscard) return false;

  const documents = modifiedDocuments(target);
  if (documents.length === 0) return false;
  useCloseConfirmation.setState({ target, documents, error: null });
  return true;
}

export function requestDocumentClose(id: string): void {
  if (!requestConfirmation({ kind: "tab", id })) useWorkspaceStore.getState().closeDocument(id);
}

/** True when the native close event needs to wait for a decision. */
export function requestWorkspaceClose(): boolean {
  return requestConfirmation({ kind: "window" });
}

export function shouldWarnBeforeUnload(): boolean {
  return !!useWorkspaceStore.getState().savingSessionId ||
    (useSettingsStore.getState().confirmBeforeDiscard && snapshotSessions().some(isSessionModified));
}

export async function resolveClose(choice: CloseChoice): Promise<void> {
  const { target, busy } = useCloseConfirmation.getState();
  if (!target || busy) return;
  if (choice === "cancel") {
    useCloseConfirmation.setState({ target: null, documents: [], error: null });
    return;
  }

  useCloseConfirmation.setState({ busy: choice, error: null });
  try {
    if (choice === "save") {
      for (const { id } of modifiedDocuments(target)) {
        if (!(await saveDocumentById(id))) {
          useCloseConfirmation.setState({ documents: modifiedDocuments(target), error: "save" });
          return;
        }
      }
      const remaining = modifiedDocuments(target);
      if (remaining.length > 0) {
        // An asynchronous edit may have landed during a native Save As dialog.
        useCloseConfirmation.setState({ documents: remaining, error: "save" });
        return;
      }
    }

    if (target.kind === "window") await getCurrentWindow().destroy();
    else useWorkspaceStore.getState().closeDocument(target.id);
    useCloseConfirmation.setState({ target: null, documents: [] });
  } catch {
    useCloseConfirmation.setState({ documents: modifiedDocuments(target), error: "close" });
  } finally {
    useCloseConfirmation.setState({ busy: null });
  }
}
