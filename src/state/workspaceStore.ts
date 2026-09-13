import { isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";

import { DOCUMENT_FORMAT_VERSION, SavedDocument, validateSavedDocument } from "@/io/documentValidation";
import { releaseImportedShapesForFeatures } from "@/kernel/importedShapes";
import { openFile, saveBlobAs, writeBinaryAtPath } from "@/io/files";
import type { Sketch } from "@/sketch/types";
import type { CadDocument, DocumentKind } from "@/types/document";
import type { UnitSystemId } from "@/types/ui";

import { createDocument, useDocumentStore } from "./documentStore";
import { useGeometryStore } from "./geometryStore";
import { useInspectStore } from "./inspectStore";
import { useSettingsStore } from "./settingsStore";
import { useSketchStore } from "./sketchStore";
import { useViewportStore } from "./viewportStore";

/**
 * Multi-document workspace: every currently open document (a tab), with the active one's
 * live editing state mirrored out into `documentStore`/`sketchStore`/`viewportStore` — the
 * same stores every other part of the app already reads from directly.
 *
 * Rather than making every consumer of those stores multi-instance-aware (there are
 * several dozen, most reached only through `.getState()` from outside React — see
 * `commandRegistry.ts`), this instead keeps them as the single source of truth for
 * whichever document is active, and treats `sessions` as cold storage for the rest: a
 * `switchTo` snapshots the outgoing document's live state into its session entry, then
 * writes the incoming session's state back into the live stores. This is what makes a
 * Drawing able to reference a separately open Part (see `types/document.ts`'s
 * `DrawingSheetData`) without a much larger rewrite.
 */

const EXTENSION = "mabucad";

export interface DocumentSession {
  /** Tab identity — deliberately not `document.id`: a document's own id is assigned by a
   * counter that restarts every app launch, so two files saved in different sessions can
   * carry the same `document.id` and would collide as session/React keys if reused here. */
  id: string;
  kind: DocumentKind;
  /** Real filesystem path if this tab was opened from disk under Tauri, or has been saved to
   * one since — see `PickedFile.path`'s own doc comment in `io/files.ts`. Once set, a plain
   * Save writes straight back to it instead of prompting; Save As always prompts and updates
   * this to whatever new path the user picks. */
  filePath: string | null;
  document: CadDocument;
  sketches: Record<string, Sketch>;
  unitSystem: UnitSystemId;
  past: CadDocument[];
  future: CadDocument[];
  hiddenFeatureIds: string[];
}

let sessionIdCounter = 0;
function nextSessionId(): string {
  sessionIdCounter += 1;
  return `session-${sessionIdCounter}`;
}

/** Whether proceeding would discard edits the user hasn't saved, and if so, whether
 * they're fine with that — shared by closing a dirty tab and restoring an autosave over
 * the active one, the only two actions left that can actually lose work now that New/Open
 * each get their own tab instead of replacing anything. */
export function confirmDiscard(message: string, hasUnsavedChanges: boolean): boolean {
  if (!hasUnsavedChanges) return true;
  if (!useSettingsStore.getState().confirmBeforeDiscard) return true;
  return window.confirm(message);
}

function nextDocumentName(sessions: DocumentSession[], kind: DocumentKind): string {
  const prefix = kind === "drawing" ? "Drawing" : kind === "assembly" ? "Assembly" : "Part";
  const taken = new Set(sessions.map((session) => session.document.name));
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function releaseImportedShapesOf(document: CadDocument): void {
  releaseImportedShapesForFeatures(
    document.features.filter((feature) => feature.kind === "imported").map((feature) => feature.id),
  );
}

/** Reads the live stores back into `session`'s shape — called on the outgoing tab of a switch. */
function snapshotActive(session: DocumentSession): DocumentSession {
  const { document, past, future, unitSystem } = useDocumentStore.getState();
  const { sketches } = useSketchStore.getState();
  const { hiddenFeatureIds } = useViewportStore.getState();
  return { ...session, document, past, future, unitSystem, sketches, hiddenFeatureIds };
}

/** Writes `session`'s state into the live stores — called on the incoming tab of a switch. */
function applySession(session: DocumentSession): void {
  useInspectStore.getState().closeInspect();
  useInspectStore.getState().resetMeshDerivedState();
  useViewportStore.getState().setEdgePickMode(null);
  useViewportStore.getState().setHolePlacementActive(false);
  // Cleared synchronously rather than left to show the outgoing tab's mesh until
  // `useRebuild`'s own debounce catches up — a document switch should read as instant.
  useGeometryStore.setState({ status: "empty", mesh: null, errors: {}, previewMesh: null, toast: null });

  useDocumentStore.getState().restoreSession(session.document, session.past, session.future, session.unitSystem);
  useSketchStore.getState().loadSketches(session.sketches);
  useViewportStore.setState({ hiddenFeatureIds: session.hiddenFeatureIds });
}

function freshSession(kind: DocumentKind, sessions: DocumentSession[]): DocumentSession {
  const document = createDocument(kind, nextDocumentName(sessions, kind));
  return {
    id: nextSessionId(),
    kind,
    filePath: null,
    document,
    sketches: {},
    unitSystem: "MMGS",
    past: [],
    future: [],
    hiddenFeatureIds: [],
  };
}

interface WorkspaceStore {
  /** Open tabs, in the order they should display. */
  sessions: DocumentSession[];
  activeId: string;

  /** File ▸ New — opens a fresh document of the given kind in a new tab and activates it. */
  newDocument: (kind: DocumentKind) => void;
  /** File ▸ Open — picks a `.mabucad` file and opens it in a new tab, or focuses the
   * matching tab if that same file (matched by path) is already open. */
  openFromDisk: () => Promise<void>;
  switchTo: (id: string) => void;
  /** Closes a tab, prompting first if it has unsaved changes. Closing the last remaining
   * tab replaces it with a fresh blank Part rather than leaving nothing open. */
  closeDocument: (id: string) => void;
  /** File ▸ Save — writes the active tab's document to disk. Silently overwrites the tab's
   * known `filePath` if it has one; otherwise falls back to the same picker as Save As (a
   * brand-new, never-saved document has nowhere else to write to). Returns whether it
   * actually saved (false if the user cancelled the dialog or it failed), so
   * `documentIO.ts` knows whether the autosave recovery snapshot is now redundant. */
  saveActive: () => Promise<boolean>;
  /** File ▸ Save As — always prompts for a location, even if the tab already has one, and
   * makes the picked path the tab's new `filePath` for subsequent plain Saves. */
  saveActiveAs: () => Promise<boolean>;
  /** Restore Autosave: overwrites the active tab's content in place (fresh undo history,
   * same as Open), used only by `commands/documentIO.ts`'s `runRestoreAutosave`. */
  restoreIntoActive: (document: CadDocument, sketches: Record<string, Sketch>, unitSystem: UnitSystemId) => void;
}

const initialSession: DocumentSession = {
  id: nextSessionId(),
  kind: useDocumentStore.getState().document.kind,
  filePath: null,
  document: useDocumentStore.getState().document,
  sketches: useSketchStore.getState().sketches,
  unitSystem: useDocumentStore.getState().unitSystem,
  past: [],
  future: [],
  hiddenFeatureIds: [],
};

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  sessions: [initialSession],
  activeId: initialSession.id,

  newDocument: (kind) => {
    const { sessions, activeId } = get();
    const withSnapshot = sessions.map((session) => (session.id === activeId ? snapshotActive(session) : session));
    const session = freshSession(kind, withSnapshot);

    set({ sessions: [...withSnapshot, session], activeId: session.id });
    applySession(session);
  },

  openFromDisk: async () => {
    const { showToast } = useGeometryStore.getState();

    try {
      const picked = await openFile([EXTENSION, "json"]);
      if (!picked) return;

      const alreadyOpen = picked.path
        ? get().sessions.find((session) => session.filePath === picked.path)
        : undefined;
      if (alreadyOpen) {
        get().switchTo(alreadyOpen.id);
        showToast(`${picked.name} is already open`);
        return;
      }

      const parsed: unknown = JSON.parse(new TextDecoder().decode(picked.data));
      const validated = validateSavedDocument(parsed);
      if (!validated.ok) {
        throw new Error(`${picked.name} is not a valid MaBuCAD document: ${validated.error}`);
      }
      const saved = validated.saved;

      const { sessions, activeId } = get();
      const withSnapshot = sessions.map((session) => (session.id === activeId ? snapshotActive(session) : session));

      const session: DocumentSession = {
        id: nextSessionId(),
        kind: saved.document.kind,
        filePath: picked.path,
        document: saved.document,
        sketches: saved.sketches,
        unitSystem: saved.unitSystem ?? "MMGS",
        past: [],
        future: [],
        hiddenFeatureIds: [],
      };

      set({ sessions: [...withSnapshot, session], activeId: session.id });
      applySession(session);
      showToast(`Opened ${picked.name}`);
    } catch (error) {
      showToast(`Open failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
    }
  },

  switchTo: (id) => {
    const { sessions, activeId } = get();
    if (id === activeId) return;

    const target = sessions.find((session) => session.id === id);
    if (!target) return;

    const withSnapshot = sessions.map((session) => (session.id === activeId ? snapshotActive(session) : session));
    set({ sessions: withSnapshot, activeId: id });
    applySession(target);
  },

  closeDocument: (id) => {
    const { sessions, activeId } = get();
    const index = sessions.findIndex((session) => session.id === id);
    if (index === -1) return;

    const target = id === activeId ? snapshotActive(sessions[index]) : sessions[index];
    if (!confirmDiscard("Discard unsaved changes and close this document?", target.past.length > 0)) return;

    releaseImportedShapesOf(target.document);
    const remaining = sessions.filter((session) => session.id !== id);

    if (remaining.length === 0) {
      const session = freshSession("part", []);
      set({ sessions: [session], activeId: session.id });
      applySession(session);
      return;
    }

    if (id !== activeId) {
      set({ sessions: remaining });
      return;
    }

    const next = remaining[Math.min(index, remaining.length - 1)];
    set({ sessions: remaining, activeId: next.id });
    applySession(next);
  },

  saveActive: async () => {
    const { showToast } = useGeometryStore.getState();
    const { document, unitSystem } = useDocumentStore.getState();
    const { sketches } = useSketchStore.getState();
    const knownPath = get().sessions.find((session) => session.id === get().activeId)?.filePath ?? null;

    const payload: SavedDocument = { formatVersion: DOCUMENT_FORMAT_VERSION, document, sketches, unitSystem };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });

    try {
      if (knownPath && isTauri()) {
        await writeBinaryAtPath(knownPath, blob);
        showToast(`Saved ${document.name}.${EXTENSION}`);
        return true;
      }

      const path = await saveBlobAs(blob, `${document.name}.${EXTENSION}`, [EXTENSION]);
      if (path === null) return false;
      if (path) {
        const { activeId } = get();
        set((state) => ({
          sessions: state.sessions.map((session) => (session.id === activeId ? { ...session, filePath: path } : session)),
        }));
      }
      showToast(`Saved ${document.name}.${EXTENSION}`);
      return true;
    } catch (error) {
      showToast(`Save failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
      return false;
    }
  },

  saveActiveAs: async () => {
    const { showToast } = useGeometryStore.getState();
    const { document, unitSystem } = useDocumentStore.getState();
    const { sketches } = useSketchStore.getState();

    const payload: SavedDocument = { formatVersion: DOCUMENT_FORMAT_VERSION, document, sketches, unitSystem };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });

    try {
      const path = await saveBlobAs(blob, `${document.name}.${EXTENSION}`, [EXTENSION]);
      if (path === null) return false;
      if (path) {
        const { activeId } = get();
        set((state) => ({
          sessions: state.sessions.map((session) => (session.id === activeId ? { ...session, filePath: path } : session)),
        }));
      }
      showToast(`Saved ${document.name}.${EXTENSION}`);
      return true;
    } catch (error) {
      showToast(`Save failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
      return false;
    }
  },

  restoreIntoActive: (document, sketches, unitSystem) => {
    const { activeId } = get();
    releaseImportedShapesOf(useDocumentStore.getState().document);

    const session: DocumentSession = {
      id: activeId,
      kind: document.kind,
      filePath: get().sessions.find((s) => s.id === activeId)?.filePath ?? null,
      document,
      sketches,
      unitSystem,
      past: [],
      future: [],
      hiddenFeatureIds: [],
    };

    set((state) => ({
      sessions: state.sessions.map((existing) => (existing.id === activeId ? session : existing)),
    }));
    applySession(session);
  },
}));

/* ------------------------------------------------------------------ selectors */

export function selectActiveSession(state: WorkspaceStore): DocumentSession | undefined {
  return state.sessions.find((session) => session.id === state.activeId);
}
