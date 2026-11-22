import {
  EXPORT_EXTENSIONS,
  NoGeometryError,
  exportModel,
  importModel,
  type ExportFormat,
} from "@/kernel/io";
import { openFile, readFileAtPath, saveBlob, type PickedFile } from "@/io/files";
import { useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";
import { useSketchStore } from "@/state/sketchStore";
import { useWorkspaceStore } from "@/state/workspaceStore";

/**
 * Interchange commands.
 *
 * Outcomes are reported through the geometry store's toast, a transient notice separate
 * from the rebuild status. Import and export both mutate the document (a new feature, or
 * nothing at all), which can itself trigger a rebuild a moment later — if the outcome
 * shared the rebuild's own message field, "Model up to date" would overwrite "Imported
 * x.step" within a couple hundred milliseconds.
 */

export async function runExport(format: ExportFormat): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const { document } = useDocumentStore.getState();
  const { sketches } = useSketchStore.getState();
  const { name } = document;

  try {
    const blob = await exportModel(format, document, sketches);
    const extension = EXPORT_EXTENSIONS[format];

    const saved = await saveBlob(blob, `${name}.${extension}`, [extension]);
    if (saved) {
      showToast(`Exported ${name}.${extension}`);
    }
  } catch (error) {
    showToast(
      error instanceof NoGeometryError
        ? "Nothing to export yet — build a feature first"
        : `Export failed: ${error instanceof Error ? error.message : "unknown error"}`,
      6000,
    );
  }
}

/**
 * Commit the import only after conversion succeeds and the original tab is still active.
 */
async function importPicked(picked: PickedFile, sessionId: string): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const documentStore = useDocumentStore.getState();

  showToast(`Importing ${picked.name}…`);

  const importedBrep = await importModel(picked.name, picked.data);
  if (useWorkspaceStore.getState().activeId !== sessionId) {
    showToast("Import cancelled because the active document changed");
    return;
  }
  documentStore.addFeature("imported", { importedBrep }, [], picked.name.replace(/\.[^.]+$/, ""));
  showToast(`Imported ${picked.name}`);
}

export async function runImport(): Promise<void> {
  const { showToast } = useGeometryStore.getState();

  try {
    const sessionId = useWorkspaceStore.getState().activeId;
    const picked = await openFile(["step", "stp", "stl"]);
    if (!picked) return;
    await importPicked(picked, sessionId);
  } catch (error) {
    showToast(`Import failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}

/**
 * Import from a file dropped onto the window — the path arrives from the Rust window
 * event handler (see `src-tauri/src/lib.rs`), which is what blesses it against the read
 * command, so this is the same flow as `runImport` minus the dialog.
 */
export async function runImportPath(path: string, name: string): Promise<void> {
  const { showToast } = useGeometryStore.getState();

  try {
    const sessionId = useWorkspaceStore.getState().activeId;
    const data = await readFileAtPath(path);
    await importPicked({ name, data, path }, sessionId);
  } catch (error) {
    showToast(`Import failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}
