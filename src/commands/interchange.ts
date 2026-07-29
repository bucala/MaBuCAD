import {
  EXPORT_EXTENSIONS,
  NoGeometryError,
  exportModel,
  importModel,
  type ExportFormat,
} from "@/kernel/io";
import { releaseImportedShape } from "@/kernel/importedShapes";
import { openFile, saveBlob } from "@/io/files";
import { useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";

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
  const { name } = useDocumentStore.getState().document;

  try {
    const blob = await exportModel(format);
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

export async function runImport(): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const documentStore = useDocumentStore.getState();

  try {
    const picked = await openFile(["step", "stp", "stl"]);
    if (!picked) return;

    showToast(`Importing ${picked.name}…`);

    // The feature is created first so the imported body has an owner to be keyed against,
    // and is removed again if the kernel rejects the file — a tree row pointing at
    // geometry that failed to load would be worse than no row at all.
    const featureId = documentStore.addFeature("imported");

    try {
      await importModel(featureId, picked.name, picked.data);
      documentStore.renameFeature(featureId, picked.name.replace(/\.[^.]+$/, ""));
      showToast(`Imported ${picked.name}`);
    } catch (error) {
      releaseImportedShape(featureId);
      documentStore.deleteFeature(featureId);
      throw error;
    }
  } catch (error) {
    showToast(`Import failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}
