import { validateSavedDocument, type SavedDocument } from "./documentValidation";

/** Extension of a saved MaBuCAD document — what Drawings and Assemblies pick their source
 * Part files by. */
export const PART_FILE_EXTENSION = "mabucad";

/** Parses and validates a saved file that must be a Part — a Drawing's source part and an
 * Assembly's components both reference Part files only. Throws with `label` in the message. */
export function parseSavedPart(text: string, label: string): SavedDocument {
  const result = validateSavedDocument(JSON.parse(text));
  if (!result.ok) throw new Error(`${label}: ${result.error}`);
  if (result.saved.document.kind !== "part") throw new Error(`${label} is not a saved Part document`);
  return result.saved;
}

/** "Bracket.mabucad" → "Bracket" — the base name an assembly component is labelled with. */
export function partBaseName(fileName: string): string {
  return fileName.replace(/\.(mabucad|json)$/i, "");
}
