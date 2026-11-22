import { isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";

import { DOCUMENT_FORMAT_VERSION, SavedDocument, validateSavedDocument } from "@/io/documentValidation";
import { releaseImportedShapesForFeatures } from "@/kernel/importedShapes";
import { openFile, saveBlobAs, writeBinaryAtPath } from "@/io/files";
import { replaceCurrentShape } from "@/kernel/rebuild";
import type { CadDocument, DocumentKind } from "@/types/document";

import { createDocument, useDocumentStore } from "./documentStore";
import { useDrawingToolStore } from "./drawingToolStore";
import { useGeometryStore } from "./geometryStore";
import { useInspectStore } from "./inspectStore";
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

type DocumentContent = Pick<SavedDocument, "document" | "sketches" | "unitSystem">;

export interface DocumentSession extends DocumentContent {
  /** Tab identity — deliberately not `document.id`: a document's own id is assigned by a
   * counter that restarts every app launch, so two files saved in different sessions can
   * carry the same `document.id` and would collide as session/React keys if reused here. */
  id: string;
  kind: DocumentKind;
  /** Real filesystem path if this tab was opened from disk under Tauri, or has been saved to
   * one since. A plain Save can write directly after a native save dialog has approved it. */
  filePath: string | null;
  writable: boolean;
  savedContent: DocumentContent | null;
  past: CadDocument[];
  future: CadDocument[];
  hiddenFeatureIds: string[];
}

function sameProperties<T extends object>(left: T, right: T, ignored: keyof T): boolean {
  const leftKeys = (Object.keys(left) as (keyof T)[]).filter((key) => key !== ignored);
  const rightCount = Object.keys(right).filter((key) => key !== ignored).length;
  return leftKeys.length === rightCount && leftKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key],
  );
}

function documentChanged(document: CadDocument, saved: CadDocument): boolean {
  if (saved === document) return false;

  // Rebuild diagnostics are attached to feature rows and can change without a user edit.
  const features = document.features;
  return !sameProperties(document, saved, "features") ||
    features.length !== saved.features.length ||
    features.some((feature, index) => {
      const previous = saved.features[index]!;
      return feature !== previous && !sameProperties(feature, previous, "error");
    });
}

export function isSessionModified(session: DocumentSession): boolean {
  const saved = session.savedContent;
  return !saved || saved.sketches !== session.sketches || saved.unitSystem !== session.unitSystem ||
    documentChanged(session.document, saved.document);
}

function sameFilePath(left: string, right: string): boolean {
  const normalize = (path: string) => path.replace(/\\/g, "/").toLowerCase();
  return normalize(left) === normalize(right);
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
  const drawingTools = useDrawingToolStore.getState();
  drawingTools.closeModelViewPicker();
  drawingTools.resetPicking();
  useInspectStore.getState().closeInspect();
  useInspectStore.getState().resetMeshDerivedState();
  useViewportStore.getState().setEdgePickMode(null);
  useViewportStore.getState().setHolePlacementActive(false);
  // Cleared synchronously rather than left to show the outgoing tab's mesh until
  // `useRebuild`'s own debounce catches up — a document switch should read as instant.
  replaceCurrentShape(null);
  useGeometryStore.setState({ status: "empty", mesh: null, errors: {}, previewMesh: null, toast: null });

  useDocumentStore.getState().restoreSession(session.document, session.past, session.future, session.unitSystem);
  useSketchStore.getState().loadSketches(session.sketches);
  useViewportStore.setState({ hiddenFeatureIds: session.hiddenFeatureIds });
}

function freshSession(kind: DocumentKind, sessions: DocumentSession[]): DocumentSession {
  const document = createDocument(kind, nextDocumentName(sessions, kind));
  return createSession({ document, sketches: {}, unitSystem: "MMGS" });
}

function createSession(
  content: DocumentContent,
  filePath: string | null = null,
  id: string = crypto.randomUUID(),
  savedContent: DocumentContent | null = content,
): DocumentSession {
  return {
    document: content.document,
    sketches: content.sketches,
    unitSystem: content.unitSystem,
    id,
    kind: content.document.kind,
    filePath,
    writable: false,
    savedContent,
    past: [],
    future: [],
    hiddenFeatureIds: [],
  };
}

interface WorkspaceStore {
  /** Open tabs, in the order they should display. */
  sessions: DocumentSession[];
  activeId: string;
  savingSessionId: string | null;

  /** File ▸ New — opens a fresh document of the given kind in a new tab and activates it. */
  newDocument: (kind: DocumentKind) => void;
  /** File ▸ Open — picks a `.mabucad` file and opens it in a new tab, or focuses the
   * matching tab if that same file (matched by path) is already open. */
  openFromDisk: () => Promise<void>;
  switchTo: (id: string) => void;
  /** Removes a tab after its close has been resolved. Closing the last tab starts a blank Part. */
  closeDocument: (id: string) => void;
  /** Save the captured revision and report whether the tab is still clean afterward. */
  saveDocument: (id: string, saveAs?: boolean) => Promise<{ id: string; clean: boolean } | null>;
  /** Open recovery data independently so it never inherits the active file's path. */
  restoreAsDocument: (content: DocumentContent, recoveryId: string) => void;
}

const initialSession = createSession({
  document: useDocumentStore.getState().document,
  sketches: useSketchStore.getState().sketches,
  unitSystem: useDocumentStore.getState().unitSystem,
});

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  sessions: [initialSession],
  activeId: initialSession.id,
  savingSessionId: null,

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

      const pickedPath = picked.path;
      const alreadyOpen = pickedPath
        ? get().sessions.find((session) => session.filePath && sameFilePath(session.filePath, pickedPath))
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

      const session = createSession(saved, pickedPath);

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
    if (index === -1 || get().savingSessionId === id) return;

    const target = id === activeId ? snapshotActive(sessions[index]) : sessions[index];
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

  saveDocument: async (id, saveAs = false) => {
    const { sessions, activeId, savingSessionId } = get();
    const tab = sessions.find((session) => session.id === id);
    if (!tab || savingSessionId) return null;

    const { showToast } = useGeometryStore.getState();
    const { filePath, writable, document, sketches, unitSystem } = id === activeId ? snapshotActive(tab) : tab;
    const content = { document, sketches, unitSystem };
    const payload: SavedDocument = { formatVersion: DOCUMENT_FORMAT_VERSION, ...content };

    set({ savingSessionId: id });
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const directPath = filePath && writable && !saveAs && isTauri() ? filePath : null;

      let destination = directPath;
      if (directPath) {
        await writeBinaryAtPath(directPath, blob);
      } else {
        destination = await saveBlobAs(blob, `${document.name}.${EXTENSION}`, [EXTENSION], {
          initialPath: filePath ?? undefined,
          verifyPath: (path) => {
            const other = get().sessions.find((session) =>
              session.id !== id && session.filePath && sameFilePath(session.filePath, path),
            );
            if (other) throw new Error("The destination is already open in another tab");
          },
        });
        if (destination === null) return null;
      }

      set((state) => ({
        sessions: state.sessions.map((session) => session.id === id
          ? { ...session, filePath: destination || null, writable: Boolean(destination), savedContent: content }
          : session),
      }));
      const saved = snapshotSessions(get()).find((session) => session.id === id);
      showToast(`Saved ${destination?.split(/[\\/]/).pop() || `${document.name}.${EXTENSION}`}`);
      return { id, clean: !!saved && !isSessionModified(saved) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Save failed: ${message}`, 6000);
      return null;
    } finally {
      set({ savingSessionId: null });
    }
  },

  restoreAsDocument: (content, recoveryId) => {
    const state = get();
    const sessions = snapshotSessions(state);
    const existing = sessions.find((session) => session.id === recoveryId);
    if (existing && !existing.savedContent) {
      state.switchTo(existing.id);
      return;
    }
    const session = createSession(content, null, existing ? undefined : recoveryId, null);
    set({ sessions: [...sessions, session], activeId: session.id });
    applySession(session);
  },
}));

export function snapshotSessions(state: WorkspaceStore = useWorkspaceStore.getState()): DocumentSession[] {
  return state.sessions.map((session) => (session.id === state.activeId ? snapshotActive(session) : session));
}

export function useActiveDocumentModified(): boolean {
  const saved = useWorkspaceStore((state) => selectActiveSession(state)?.savedContent);
  const changed = useDocumentStore(({ document, unitSystem }) =>
    !saved || unitSystem !== saved.unitSystem || documentChanged(document, saved.document),
  );
  const sketchesChanged = useSketchStore((state) => state.sketches !== saved?.sketches);
  return changed || sketchesChanged;
}


export function selectActiveSession(state: WorkspaceStore): DocumentSession | undefined {
  return state.sessions.find((session) => session.id === state.activeId);
}
