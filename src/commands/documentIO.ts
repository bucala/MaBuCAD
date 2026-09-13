import { DOCUMENT_FORMAT_VERSION, SavedDocument, validateSavedDocument } from "@/io/documentValidation";
import { useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";
import { useSketchStore } from "@/state/sketchStore";
import { confirmDiscard, useWorkspaceStore } from "@/state/workspaceStore";
import type { DocumentKind } from "@/types/document";

/**
 * Whole-document persistence: New, Open, Save.
 *
 * These are thin wrappers around `workspaceStore.ts`'s own tab-aware actions — New and
 * Open each open a new tab rather than replacing whatever was already open, so (unlike
 * before multi-document support existed) neither one can lose unsaved work; only closing
 * a tab or restoring an autosave over the active one still can, which is what
 * `confirmDiscard` below is for.
 *
 * Unlike STEP/STL interchange (`interchange.ts`), which round-trips a solid's B-Rep, this
 * saves the parametric history itself — every feature and every sketch, so a reopened
 * document is exactly as editable as it was before closing it, not just the same shape.
 *
 * An imported feature's own geometry is deliberately not part of the file: it is a
 * WebAssembly-backed kernel object (see `kernel/importedShapes.ts`), not serialisable
 * state. Reopening a document that had one produces the same "Imported geometry is no
 * longer loaded" error `rebuild.ts` already reports when an imported shape is missing for
 * any other reason — a real gap, but a graceful one rather than a crash, and re-importing
 * the original file is the fix either way.
 */

export async function runSaveDocument(): Promise<void> {
  const saved = await useWorkspaceStore.getState().saveActive();
  // A real save just wrote this exact state to disk, so the recovery snapshot has nothing
  // left to offer that Open wouldn't already give back.
  if (saved) clearAutosaveSnapshot();
}

export async function runSaveDocumentAs(): Promise<void> {
  const saved = await useWorkspaceStore.getState().saveActiveAs();
  if (saved) clearAutosaveSnapshot();
}

export async function runOpenDocument(): Promise<void> {
  await useWorkspaceStore.getState().openFromDisk();
}

export function runNewDocument(kind: DocumentKind = "part"): void {
  useWorkspaceStore.getState().newDocument(kind);
}

/**
 * Autosave: a `localStorage` recovery snapshot, not a file-system save.
 *
 * Every real Save needs a path the user picks (`io/files.ts`'s `saveBlob` opens a native
 * dialog inside Tauri, a download prompt in the browser) — a background timer popping
 * that dialog every few minutes would be worse than not autosaving at all. This instead
 * writes the same document shape `runSaveDocument` does straight to `localStorage` under
 * one fixed key, so it never needs a path and never interrupts anything; `useAutosave.ts`
 * is what actually calls `writeAutosaveSnapshot` on an interval when Settings ▸ Autosave
 * (`settingsStore.autosaveEnabled`) is on.
 *
 * Scoped to the active tab only — autosaving every open document on the same timer would
 * mean a slow kernel rebuild in a background tab stalling the one the user is actually
 * looking at, for a recovery feature whose whole point is to be unobtrusive.
 */
const AUTOSAVE_STORAGE_KEY = "mabucad-autosave";

interface AutosaveSnapshot extends SavedDocument {
  savedAt: string;
}

export function writeAutosaveSnapshot(): void {
  const { document, unitSystem } = useDocumentStore.getState();
  const { sketches } = useSketchStore.getState();

  const snapshot: AutosaveSnapshot = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    document,
    sketches,
    unitSystem,
    savedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // A full or unavailable localStorage (private browsing, quota) just means this tick's
    // snapshot is skipped — the next interval tries again, and nothing the user asked for
    // (the real Save/Export flows) depends on this succeeding.
  }
}

function readAutosaveSnapshot(): AutosaveSnapshot | null {
  try {
    const raw = window.localStorage.getItem(AUTOSAVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const validated = validateSavedDocument(parsed);
    return validated.ok && typeof (parsed as AutosaveSnapshot).savedAt === "string"
      ? (parsed as AutosaveSnapshot)
      : null;
  } catch {
    return null;
  }
}

export function hasAutosaveSnapshot(): boolean {
  return readAutosaveSnapshot() !== null;
}

function clearAutosaveSnapshot(): void {
  try {
    window.localStorage.removeItem(AUTOSAVE_STORAGE_KEY);
  } catch {
    // Same reasoning as writeAutosaveSnapshot's own catch — best-effort only.
  }
}

export function runRestoreAutosave(): void {
  const { showToast } = useGeometryStore.getState();
  const snapshot = readAutosaveSnapshot();
  if (!snapshot) {
    showToast("No autosave snapshot found");
    return;
  }

  const hasUnsavedChanges = useDocumentStore.getState().past.length > 0;
  if (!confirmDiscard("Discard unsaved changes and restore the autosaved version?", hasUnsavedChanges)) return;

  useWorkspaceStore
    .getState()
    .restoreIntoActive(snapshot.document, snapshot.sketches, snapshot.unitSystem ?? "MMGS");

  showToast(`Restored autosave from ${new Date(snapshot.savedAt).toLocaleString()}`);
}
