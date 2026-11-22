import { DOCUMENT_FORMAT_VERSION, type SavedDocument, validateSavedDocument } from "@/io/documentValidation";
import { useGeometryStore } from "@/state/geometryStore";
import { isSessionModified, snapshotSessions, useWorkspaceStore } from "@/state/workspaceStore";
import type { DocumentKind } from "@/types/document";

const AUTOSAVE_KEY = "mabucad-autosave";
const AUTOSAVE_PREFIX = `${AUTOSAVE_KEY}:`;

interface AutosaveSnapshot {
  key: string;
  savedAt: string;
  content: SavedDocument;
}

export async function saveDocumentById(id: string, saveAs = false): Promise<boolean> {
  const result = await useWorkspaceStore.getState().saveDocument(id, saveAs);
  if (!result?.clean) return false;
  clearAutosaveSnapshot(id);
  return true;
}

export async function runSaveDocument(): Promise<void> {
  await saveDocumentById(useWorkspaceStore.getState().activeId);
}

export async function runSaveDocumentAs(): Promise<void> {
  await saveDocumentById(useWorkspaceStore.getState().activeId, true);
}

export async function runOpenDocument(): Promise<void> {
  await useWorkspaceStore.getState().openFromDisk();
}

export function runNewDocument(kind: DocumentKind = "part"): void {
  useWorkspaceStore.getState().newDocument(kind);
}

export function writeAutosaveSnapshots(): void {
  const savedAt = new Date().toISOString();
  let failed = false;
  for (const session of snapshotSessions()) {
    if (!isSessionModified(session)) {
      clearAutosaveSnapshot(session.id);
      continue;
    }
    try {
      const { document, sketches, unitSystem } = session;
      window.localStorage.setItem(autosaveStorageKey(session.id), JSON.stringify({
        formatVersion: DOCUMENT_FORMAT_VERSION, document, sketches, unitSystem, savedAt,
      }));
    } catch {
      failed = true;
    }
  }
  if (failed) useGeometryStore.getState().showToast("Autosave storage is unavailable or full", 6000);
}

function readAutosaveSnapshot(key: string): AutosaveSnapshot | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as { savedAt?: unknown } | null;
    if (typeof value?.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) return null;
    const validated = validateSavedDocument(value);
    return validated.ok ? { key, savedAt: value.savedAt, content: validated.saved } : null;
  } catch {
    return null;
  }
}

export function listAutosaveSnapshots(): AutosaveSnapshot[] {
  try {
    const storage = window.localStorage;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    return keys
      .filter((key): key is string => key === AUTOSAVE_KEY || !!key?.startsWith(AUTOSAVE_PREFIX))
      .map(readAutosaveSnapshot)
      .filter((entry): entry is AutosaveSnapshot => entry !== null)
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  } catch {
    return [];
  }
}

function autosaveStorageKey(sessionId: string): string {
  return sessionId === AUTOSAVE_KEY ? AUTOSAVE_KEY : `${AUTOSAVE_PREFIX}${sessionId}`;
}

function clearAutosaveSnapshot(sessionId: string): void {
  try {
    window.localStorage.removeItem(autosaveStorageKey(sessionId));
  } catch {
    // Storage can be disabled. The explicit save is already on disk.
  }
}

export function runRestoreAutosave(key: string): void {
  const { showToast } = useGeometryStore.getState();
  const snapshot = readAutosaveSnapshot(key);
  if (!snapshot) {
    showToast("No autosave snapshot found");
    return;
  }
  const id = key === AUTOSAVE_KEY ? key : key.slice(AUTOSAVE_PREFIX.length);
  useWorkspaceStore.getState().restoreAsDocument(snapshot.content, id);
  showToast(`Opened recovered copy of ${snapshot.content.document.name}`);
}
