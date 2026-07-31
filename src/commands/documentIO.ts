import type { Sketch } from "@/sketch/types";
import { releaseAllImportedShapes } from "@/kernel/importedShapes";
import { openFile, saveBlob } from "@/io/files";
import { useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useSketchStore } from "@/state/sketchStore";
import type { CadDocument } from "@/types/document";
import type { UnitSystemId } from "@/types/ui";

/**
 * Whole-document persistence: New, Open, Save.
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

const FORMAT_VERSION = 1;
const EXTENSION = "mabucad";

interface SavedDocument {
  formatVersion: number;
  document: CadDocument;
  sketches: Record<string, Sketch>;
  unitSystem: UnitSystemId;
}

function isSavedDocument(value: unknown): value is SavedDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    "formatVersion" in value &&
    "document" in value &&
    "sketches" in value
  );
}

/** Whether proceeding would discard edits, and if so, whether the user is fine with that. */
function confirmDiscard(message: string): boolean {
  const { past } = useDocumentStore.getState();
  if (past.length === 0) return true;
  // Settings > General > "Confirm before discarding unsaved changes" — off means the
  // prompt is skipped, not that anything is destroyed silently: New/Open were already
  // the explicit action that discards, this only controls whether it double-checks first.
  if (!useSettingsStore.getState().confirmBeforeDiscard) return true;
  return window.confirm(message);
}

export async function runSaveDocument(): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const { document, unitSystem } = useDocumentStore.getState();
  const { sketches } = useSketchStore.getState();

  const payload: SavedDocument = { formatVersion: FORMAT_VERSION, document, sketches, unitSystem };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });

  try {
    const saved = await saveBlob(blob, `${document.name}.${EXTENSION}`, [EXTENSION]);
    if (saved) showToast(`Saved ${document.name}.${EXTENSION}`);
  } catch (error) {
    showToast(`Save failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}

export async function runOpenDocument(): Promise<void> {
  const { showToast } = useGeometryStore.getState();

  if (!confirmDiscard("Discard unsaved changes and open a different document?")) return;

  try {
    const picked = await openFile([EXTENSION, "json"]);
    if (!picked) return;

    const parsed: unknown = JSON.parse(new TextDecoder().decode(picked.data));
    if (!isSavedDocument(parsed)) {
      throw new Error(`${picked.name} is not a MaBuCAD document`);
    }

    releaseAllImportedShapes();
    useDocumentStore.getState().loadDocument(parsed.document);
    useSketchStore.getState().loadSketches(parsed.sketches);
    useDocumentStore.getState().setUnitSystem(parsed.unitSystem ?? "MMGS");

    showToast(`Opened ${picked.name}`);
  } catch (error) {
    showToast(`Open failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}

export function runNewDocument(): void {
  if (!confirmDiscard("Discard unsaved changes and start a new document?")) return;

  releaseAllImportedShapes();
  useDocumentStore.getState().newDocument();
  useSketchStore.getState().loadSketches({});
}
