import type { Solid } from "./rebuild";

/**
 * Bodies loaded from STEP or STL, keyed by the feature that owns them.
 *
 * These live outside the document store because they are WebAssembly-backed kernel
 * objects: they cannot be serialised, cloned into an undo snapshot, or reclaimed by the
 * JavaScript garbage collector. The store holds only the feature that refers to one.
 */
const importedShapes = new Map<string, Solid>();

export function registerImportedShape(featureId: string, shape: Solid): void {
  releaseImportedShape(featureId);
  importedShapes.set(featureId, shape);
}

export function getImportedShape(featureId: string): Solid | undefined {
  return importedShapes.get(featureId);
}

export function releaseImportedShape(featureId: string): void {
  const existing = importedShapes.get(featureId) as unknown as { delete?: () => void } | undefined;
  if (!existing) return;

  try {
    existing.delete?.();
  } catch {
    // Already released by the kernel; nothing to do.
  }
  importedShapes.delete(featureId);
}

/** Releases whichever of the given feature ids own an imported shape — `workspaceStore.ts`
 * calls this for a tab's document whenever that tab is closed or its content replaced
 * (Restore Autosave), scoped to that one document so other open tabs' own imported shapes
 * are left alone. */
export function releaseImportedShapesForFeatures(featureIds: Iterable<string>): void {
  for (const featureId of featureIds) {
    releaseImportedShape(featureId);
  }
}
