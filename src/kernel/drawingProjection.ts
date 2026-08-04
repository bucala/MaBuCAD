import { drawProjection, ProjectionCamera } from "replicad";
import type { AnyShape, ProjectionPlane } from "replicad";

import type { Sketch } from "@/sketch/types";
import type { CadDocument, DrawingProjectionKind } from "@/types/document";

import { getCurrentShape, rebuildDocument } from "./rebuild";

/** One projected view's geometry, in the part's own millimetre space, already normalised
 * so its bounding box's minimum corner sits at the origin — see `projectOne`'s own doc
 * comment for why. */
export interface ProjectedGeometry {
  visiblePaths: string[];
  hiddenPaths: string[];
  width: number;
  height: number;
}

export type ProjectedViews = Record<DrawingProjectionKind, ProjectedGeometry>;

/** Guards against a degenerate view (an empty/near-planar projection) collapsing to a
 * zero-size bounding box, which would make an SVG `viewBox` invalid. */
const MIN_VIEW_SIZE = 1;

/** A conventional isometric camera — replicad has no named shortcut for one (its own
 * `ProjectionPlane` union only covers the axis-aligned faces), so this is built the same
 * way `lookFromPlane` builds any other: a position and a viewing direction, here both the
 * standard (1, -1, 1) corner. Built lazily (not at module scope) because `ProjectionCamera`
 * is WASM-backed and the kernel isn't loaded until the first `rebuildDocument` call below. */
function isometricCamera(): ProjectionCamera {
  return new ProjectionCamera([1, -1, 1], [1, -1, 1]);
}

/** `Drawing.toSVGPaths()` returns a flat `string[]` for a single blueprint but a nested
 * `string[][]` once a projection has more than one disjoint loop (e.g. a part with a
 * through-hole) — flattened here so `DrawingViewData` can stay a plain `string[]`. */
function flattenPaths(paths: string[] | string[][]): string[] {
  return paths.flatMap((path) => (Array.isArray(path) ? path : [path]));
}

/**
 * Projects one view and normalises it into the shape used by `types/document.ts`'s
 * `DrawingViewData`.
 *
 * `drawProjection` returns visible and hidden edges as separate `Drawing`s in whatever
 * coordinate space the projection camera happens to produce — not necessarily anywhere
 * near the origin. Translating both by their combined bounding box's own minimum corner
 * before extracting SVG paths means `DrawingSheet.tsx` can give every view a plain
 * `0 0 width height` viewBox rather than also having to carry that offset around.
 */
function projectOne(shape: AnyShape, camera: ProjectionPlane | ProjectionCamera): ProjectedGeometry {
  const { visible, hidden } = drawProjection(shape, camera);

  const box = visible.boundingBox;
  box.add(hidden.boundingBox);
  const [[minX, minY], [maxX, maxY]] = box.bounds;
  const width = Math.max(maxX - minX, MIN_VIEW_SIZE);
  const height = Math.max(maxY - minY, MIN_VIEW_SIZE);

  return {
    visiblePaths: flattenPaths(visible.translate(-minX, -minY).toSVGPaths()),
    hiddenPaths: flattenPaths(hidden.translate(-minX, -minY).toSVGPaths()),
    width,
    height,
  };
}

/**
 * Headlessly rebuilds a referenced part's document and projects its four standard views.
 *
 * This is a plain, one-off rebuild through the same `rebuildDocument` the active Part
 * editor uses — not a live/continuously-synced background document. A Drawing's views are
 * a cache (`DrawingViewData`'s own doc comment) refreshed on demand by "Update View", the
 * same "can go out of date" relationship a SolidWorks drawing has with its referenced
 * part; there is no worker-isolated second kernel instance here; a concurrent rebuild of
 * the same part in its own open tab would race this one, which is an accepted limitation
 * of layering Drawing views on a kernel that was never built to run more than one job at
 * a time (see `rebuild.ts`'s own module-level `currentShape`).
 *
 * Returns `null` when the referenced document has no built geometry to project (an empty
 * part, or one that fails to build at all).
 */
export async function rebuildAndProjectPart(
  document: CadDocument,
  sketches: Record<string, Sketch>,
): Promise<{ views: ProjectedViews; errors: Record<string, string> } | null> {
  const built = document.features.slice(0, document.rollbackIndex);
  const result = await rebuildDocument(built, sketches);
  const shape = getCurrentShape();
  if (!result.mesh || !shape) return null;

  const anyShape = shape as unknown as AnyShape;
  const iso = isometricCamera();

  return {
    views: {
      front: projectOne(anyShape, "front"),
      top: projectOne(anyShape, "top"),
      right: projectOne(anyShape, "right"),
      iso: projectOne(anyShape, iso),
    },
    errors: result.errors,
  };
}
