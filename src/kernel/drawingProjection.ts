import { drawProjection, makeBaseBox, ProjectionCamera } from "replicad";
import type { AnyShape, ProjectionPlane } from "replicad";

import type { Sketch } from "@/sketch/types";
import type { CadDocument, DrawingProjectionKind } from "@/types/document";

import { getCurrentShape, rebuildDocument } from "./rebuild";

/** One projected view's geometry, in the part's own millimetre space, shifted to land at
 * (0, 0) — see `projectOne`'s own doc comment for why — with `originX`/`originY`
 * preserving the shift so a view's own local coordinates can still be mapped back to the
 * part's real world space (`sectionAxisAndOffset` below is what that's for). */
export interface ProjectedGeometry {
  visiblePaths: string[];
  hiddenPaths: string[];
  width: number;
  height: number;
  originX: number;
  originY: number;
}

export type ProjectedViews = Record<DrawingProjectionKind, ProjectedGeometry>;

/** The three standard views a section cut can be taken from — unlike Front/Top/Right,
 * Isometric's projection axes aren't world-axis-aligned, so a horizontal/vertical cut
 * line drawn on it wouldn't correspond to a flat world-space cutting plane. */
export type OrthoProjection = "front" | "top" | "right";

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
 * `0 0 width height` viewBox rather than also having to carry that offset around; the
 * subtracted corner is returned as `originX`/`originY` for the one thing that does still
 * need it — mapping a click on the view back to the part's real world space.
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
    originX: minX,
    originY: minY,
  };
}

/**
 * Headlessly rebuilds a referenced part's document into its kernel shape — shared by
 * every projection flow below (the four standard views, and a section cut). Not a
 * live/continuously-synced background document: a Drawing's views are a cache
 * (`DrawingViewData`'s own doc comment) refreshed on demand by "Update View"/a section's
 * own recompute, the same "can go out of date" relationship a SolidWorks drawing has with
 * its referenced part. There is no worker-isolated second kernel instance here either; a
 * concurrent rebuild of the same part in its own open tab would race this one, an accepted
 * limitation of layering Drawing views on a kernel that was never built to run more than
 * one job at a time (see `rebuild.ts`'s own module-level `currentShape`).
 *
 * Returns `null` when the referenced document has no built geometry (an empty part, or
 * one that fails to build at all).
 */
async function rebuildPartShape(
  document: CadDocument,
  sketches: Record<string, Sketch>,
): Promise<{ shape: AnyShape; errors: Record<string, string> } | null> {
  const built = document.features.slice(0, document.rollbackIndex);
  const result = await rebuildDocument(built, sketches);
  const shape = getCurrentShape();
  if (!result.mesh || !shape) return null;
  return { shape: shape as unknown as AnyShape, errors: result.errors };
}

export async function rebuildAndProjectPart(
  document: CadDocument,
  sketches: Record<string, Sketch>,
): Promise<{ views: ProjectedViews; errors: Record<string, string> } | null> {
  const built = await rebuildPartShape(document, sketches);
  if (!built) return null;

  const iso = isometricCamera();
  return {
    views: {
      front: projectOne(built.shape, "front"),
      top: projectOne(built.shape, "top"),
      right: projectOne(built.shape, "right"),
      iso: projectOne(built.shape, iso),
    },
    errors: built.errors,
  };
}

/**
 * Which world axis a horizontal or vertical section cut line is perpendicular to, and the
 * world-space offset along it, given a click at `(u, v)` in a Front/Top/Right view's own
 * projected space (`projectOne`'s un-normalised (u, v) — i.e. the view's `originX/Y` plus
 * a local coordinate, *not* the sheet-rendered, Y-flipped-for-SVG one).
 *
 * Derived from replicad's own camera basis for each plane (`PROJECTION_PLANES` in its
 * source, `{dir, xAxis}` with `yAxis = dir × xAxis`): Front's (xAxis, yAxis) are
 * (world X, world Z); Top's are (world X, world −Y); Right's are (world −Y, world Z).
 * A *vertical* cut line holds the view's local `u` constant, so its plane's normal is the
 * axis `u` maps to; a *horizontal* line holds `v` constant the same way.
 */
export function sectionAxisAndOffset(
  projection: OrthoProjection,
  orientation: "horizontal" | "vertical",
  u: number,
  v: number,
): { axis: "x" | "y" | "z"; offset: number } {
  if (projection === "front") {
    return orientation === "vertical" ? { axis: "x", offset: u } : { axis: "z", offset: v };
  }
  if (projection === "top") {
    return orientation === "vertical" ? { axis: "x", offset: u } : { axis: "y", offset: -v };
  }
  // "right"
  return orientation === "vertical" ? { axis: "y", offset: -u } : { axis: "z", offset: v };
}

/** Bigger than any real part this app models — the "remove everything past here" half of
 * a section cut's cutting tool needs to extend well beyond the solid's own bounding box in
 * every direction, and there is no cheap way to know that box's real extent up front. */
const HALF_SPACE_SIZE = 1e5;

function asCuttable(shape: unknown) {
  return shape as unknown as {
    translate: (vector: [number, number, number]) => unknown;
    rotate: (angle: number, position: [number, number, number], direction: [number, number, number]) => unknown;
  };
}

/**
 * A solid cube big enough to swallow any real part, positioned so cutting it away removes
 * everything on one side of the world-space plane `axis = offset` — `makeBaseBox`'s own Z
 * extent runs from 0 to its length (not centred, unlike its X/Y), so a box already built
 * along Z only needs a translate to land its `z = 0` face exactly on the cutting plane;
 * for X or Y a 90° rotation first re-points that same asymmetric face along the axis
 * actually being cut.
 */
function halfSpaceBox(axis: "x" | "y" | "z", offset: number, keepPositiveSide: boolean) {
  const size = HALF_SPACE_SIZE;
  let box = asCuttable(makeBaseBox(size, size, size));
  if (axis === "x") box = asCuttable(box.rotate(90, [0, 0, 0], [0, 1, 0]));
  else if (axis === "y") box = asCuttable(box.rotate(-90, [0, 0, 0], [1, 0, 0]));

  // Removes the negative side by default (box covers [offset - size, offset]); removing
  // the positive side instead just starts that same box at the plane rather than ending
  // there (box covers [offset, offset + size]).
  const shift = keepPositiveSide ? offset - size : offset;
  const translation: [number, number, number] =
    axis === "x" ? [shift, 0, 0] : axis === "y" ? [0, shift, 0] : [0, 0, shift];

  return box.translate(translation);
}

/** Cuts `shape` with a world-space half-space and projects what remains from the same
 * camera a normal Front/Top/Right view would use — the section view itself. No hatching
 * of the newly exposed cut face(s) yet; the cut's own new boundary edges still render (the
 * projection is of the real, already-cut solid), which reads as a correct section even
 * without the fill convention. */
function cutAndProjectSection(
  shape: AnyShape,
  projection: OrthoProjection,
  axis: "x" | "y" | "z",
  offset: number,
  keepPositiveSide: boolean,
): ProjectedGeometry {
  const tool = halfSpaceBox(axis, offset, keepPositiveSide);
  const cutShape = (shape as unknown as { cut: (tool: unknown) => AnyShape }).cut(tool);
  return projectOne(cutShape, projection);
}

export async function rebuildAndProjectSection(
  document: CadDocument,
  sketches: Record<string, Sketch>,
  projection: OrthoProjection,
  axis: "x" | "y" | "z",
  offset: number,
  keepPositiveSide: boolean,
): Promise<ProjectedGeometry | null> {
  const built = await rebuildPartShape(document, sketches);
  if (!built) return null;
  return cutAndProjectSection(built.shape, projection, axis, offset, keepPositiveSide);
}
