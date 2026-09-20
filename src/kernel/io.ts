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

/** One ISO 10303-21 string literal's contents (without the surrounding apostrophes).
 *
 * STEP's exchange-file alphabet is ASCII: apostrophes and reverse solidi are doubled,
 * while every other non-printable/non-ASCII code point is emitted through the standard
 * `\X2\` (BMP) or `\X4\` (full Unicode) directive. Keeping ordinary ASCII readable makes
 * a file header still useful in a text editor, while names such as `Príruba č. 2` remain
 * lossless when another CAD system reads them.
 */
function stepString(value: string): string {
  const name = value.trim() || "Untitled";
  let encoded = "";

  for (const character of name) {
    const codePoint = character.codePointAt(0)!;
    if (character === "'") {
      encoded += "''";
    } else if (character === "\\") {
      encoded += "\\\\";
    } else if (codePoint >= 0x20 && codePoint <= 0x7e) {
      encoded += character;
    } else if (codePoint <= 0xffff) {
      encoded += `\\X2\\${codePoint.toString(16).toUpperCase().padStart(4, "0")}\\X0\\`;
    } else {
      encoded += `\\X4\\${codePoint.toString(16).toUpperCase().padStart(8, "0")}\\X0\\`;
    }
  }

  return encoded;
}

const STEP_LITERAL = "'(?:''|[^'])*'";

/**
 * Replaces the plain `STEPControl_Writer`'s generic OpenCASCADE labels with the active
 * MaBuCAD document name.
 *
 * `Shape.blobSTEP()` intentionally remains the writer (see `exportModel` below): unlike
 * replicad's XCAF-based module helper it releases every OCCT object deterministically and
 * survives repeated exports. That safe API exposes no product-name option, so naming is a
 * narrow Part-21 metadata pass over its text result instead:
 *
 * - HEADER `FILE_NAME` — what file inspectors and PDM systems show;
 * - DATA `PRODUCT` id/name — what importing CAD systems use for the part/component name;
 * - representation and solid names — useful when a downstream system exposes the B-Rep
 *   representation rather than the product record.
 *
 * No entity ids, references, topology or numeric geometry are touched. Throwing when the
 * two required records disappear is deliberate: an upstream writer-format change must
 * fail visibly rather than silently regress to the generic translator name again.
 */
export function nameStepModel(step: string, modelName: string): string {
  const literal = `'${stepString(modelName)}'`;
  let foundFileName = false;
  let foundProduct = false;
  // One scan and one output string even for a multi-megabyte STEP file. The alternatives
  // keep PRODUCT's two string fields together while every other record changes only its
  // first field.
  const metadataPattern = new RegExp(
    [
      `(\\bFILE_NAME\\s*\\(\\s*)${STEP_LITERAL}`,
      `(\\bPRODUCT\\s*\\(\\s*)${STEP_LITERAL}(\\s*,\\s*)${STEP_LITERAL}`,
      `(\\b(?:ADVANCED_BREP_SHAPE_REPRESENTATION|MANIFOLD_SOLID_BREP)\\s*\\(\\s*)${STEP_LITERAL}`,
    ].join("|"),
    "g",
  );

  const named = step.replace(
    metadataPattern,
    (
      _match,
      fileNamePrefix: string | undefined,
      productPrefix: string | undefined,
      productSeparator: string | undefined,
      shapePrefix: string | undefined,
    ) => {
      if (fileNamePrefix) {
        foundFileName = true;
        return `${fileNamePrefix}${literal}`;
      }
      if (productPrefix) {
        foundProduct = true;
        return `${productPrefix}${literal}${productSeparator}${literal}`;
      }
      return `${shapePrefix}${literal}`;
    },
  );

  if (!foundFileName) {
    throw new Error("STEP writer output has no FILE_NAME metadata record");
  }
  if (!foundProduct) {
    throw new Error("STEP writer output has no PRODUCT metadata record");
  }

  return named;
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
export async function exportModel(format: ExportFormat, modelName?: string): Promise<Blob> {
  await initKernel();

  const shape = getCurrentShape();
  if (!shape) throw new NoGeometryError();

  const exportable = shape as unknown as {
    blobSTEP: () => Blob;
    blobSTL: (options?: { binary?: boolean; tolerance?: number; angularTolerance?: number }) => Blob;
  };

  if (format === "step") {
    const blob = exportable.blobSTEP();
    if (!modelName) return blob;
    return new Blob([nameStepModel(await blob.text(), modelName)], {
      type: blob.type || "application/step",
    });
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
