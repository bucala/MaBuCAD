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
