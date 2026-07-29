import { importSTEP, importSTL } from "replicad";

import { registerImportedShape } from "./importedShapes";
import { initKernel } from "./occ";
import { getCurrentShape, type Solid } from "./rebuild";

/**
 * Interchange formats.
 *
 * IGES is deliberately absent: the OpenCASCADE build this project ships contains no IGES
 * symbols at all, so supporting it means rebuilding the WebAssembly kernel with the IGES
 * modules enabled rather than writing more TypeScript. See the README.
 */
export type ExportFormat = "step" | "stl-binary" | "stl-ascii";

export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  step: "step",
  "stl-binary": "stl",
  "stl-ascii": "stl",
};

export class NoGeometryError extends Error {
  constructor() {
    super("There is no geometry to export yet");
    this.name = "NoGeometryError";
  }
}

/**
 * Serialises the current model.
 *
 * STEP is written from the kernel's own boundary representation, so exact surfaces
 * survive the round trip. STL is a triangulation and is lossy by definition — it is for
 * manufacturing hand-off, not for re-importing as an editable body.
 *
 * STEP export deliberately goes through `shape.blobSTEP()` rather than replicad's
 * module-level `exportSTEP()`. The two are not equivalent under the hood: `exportSTEP()`
 * builds a throwaway XCAF assembly document and cleans it up via a `FinalizationRegistry`,
 * which is not deterministic — the browser can run that finalizer arbitrarily long after
 * the call returns, and when it does, it double-frees an internal OpenCascade work-session
 * object shared between two of the finalized wrappers. Confirmed by forcing GC after a
 * single export in Node (`node --expose-gc`): the *next* kernel call throws
 * `RuntimeError: memory access out of bounds`, and the corruption is not scoped to
 * STEP export — it can take down unrelated kernel calls afterwards. `shape.blobSTEP()`
 * writes a single shape with the plain (non-CAF) `STEPControl_Writer` and deletes every
 * OpenCascade object it touches synchronously before returning, the same safe pattern
 * `importSTEP`/`importSTL`/`blobSTL` already use. That was verified stable under the same
 * repeated-export-then-forced-GC stress test that broke `exportSTEP()`.
 */
export async function exportModel(format: ExportFormat): Promise<Blob> {
  await initKernel();

  const shape = getCurrentShape();
  if (!shape) throw new NoGeometryError();

  const exportable = shape as unknown as {
    blobSTEP: () => Blob;
    blobSTL: (options?: { binary?: boolean; tolerance?: number; angularTolerance?: number }) => Blob;
  };

  if (format === "step") {
    return exportable.blobSTEP();
  }

  return exportable.blobSTL({
    binary: format === "stl-binary",
    tolerance: 0.01,
    angularTolerance: 15,
  });
}

export type ImportFormat = "step" | "stl";

export function importFormatFromName(fileName: string): ImportFormat | null {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "step" || extension === "stp") return "step";
  if (extension === "stl") return "stl";
  return null;
}

/**
 * Loads a file into a kernel body and registers it against a feature id.
 *
 * A STEP import keeps its exact surfaces and can take part in later boolean features. An
 * STL import is converted from triangles, so it arrives faceted — that is a property of
 * the format, not of the conversion.
 */
export async function importModel(
  featureId: string,
  fileName: string,
  data: ArrayBuffer,
): Promise<void> {
  await initKernel();

  const format = importFormatFromName(fileName);
  if (!format) {
    throw new Error(`Unsupported file type: ${fileName}`);
  }

  const blob = new Blob([data]);
  const shape = format === "step" ? await importSTEP(blob) : await importSTL(blob);

  registerImportedShape(featureId, shape as unknown as Solid);
}
