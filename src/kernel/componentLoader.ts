import { parseSavedPart } from "@/io/partFiles";

import { initKernel } from "./occ";
import { rebuildDocumentSync, type MeshData } from "./rebuild";
import { contentHash } from "./rebuildCache";

/**
 * Builds the display mesh of a saved Part file for an Assembly component.
 *
 * Uses `rebuildDocumentSync(..., persist = false)`: the rebuild reads the active document's
 * checkpoint chain but never writes it or `currentShape`, so loading components can't
 * disturb the part tab a user switches back to, or what Export/Measure read.
 *
 * Meshes are cached by the file's content hash, so several components of one part (or the
 * same part reopened, or a tab switch back to the assembly) rebuild only once, and an
 * edited-and-saved part — different bytes, different hash — rebuilds automatically.
 */

/** Enough for a realistic assembly's distinct parts without holding every mesh a long
 * session ever loaded. Oldest entry goes first. */
const MAX_CACHED_PARTS = 64;
const meshCache = new Map<string, MeshData>();

export interface LoadedPartMesh {
  contentHash: string;
  mesh: MeshData;
}

export async function loadPartMesh(text: string, label: string): Promise<LoadedPartMesh> {
  const hash = contentHash(text);
  const cached = meshCache.get(hash);
  if (cached) return { contentHash: hash, mesh: cached };

  const { document, sketches } = parseSavedPart(text, label);
  await initKernel();
  const result = rebuildDocumentSync(document.features.slice(0, document.rollbackIndex), sketches, false);
  if (!result.mesh) {
    const firstError = Object.values(result.errors)[0];
    throw new Error(firstError ? `${label}: ${firstError}` : `${label} has no solid geometry`);
  }

  meshCache.set(hash, result.mesh);
  while (meshCache.size > MAX_CACHED_PARTS) {
    meshCache.delete(meshCache.keys().next().value as string);
  }
  return { contentHash: hash, mesh: result.mesh };
}

/** Test-only: forget every cached mesh. Never called by the app. */
export function __clearComponentCacheForTesting(): void {
  meshCache.clear();
}

/** Test-only: how many distinct parts are cached. Never called by the app. */
export function __componentCacheSizeForTesting(): number {
  return meshCache.size;
}
