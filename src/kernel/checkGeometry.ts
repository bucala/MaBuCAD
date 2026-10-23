import { measureArea, measureLength } from "replicad";

import { getCurrentShape } from "./rebuild";

export interface GeometryCheckResult {
  faceCount: number;
  edgeCount: number;
  /** One entry per problem found — empty means the check passed. */
  issues: string[];
}

/**
 * Inspect > Check Geometry: a lightweight self-check of the current body's B-Rep.
 *
 * This is deliberately not a full topology validator — the compiled OpenCascade build
 * this app ships exposes no `BRepCheck_Analyzer` (or equivalent) through replicad, so
 * there is no real "is this B-Rep topologically valid" call available to make (confirmed
 * by an exhaustive check of `replicad.d.ts` for anything like it). What this *can* check
 * honestly, using the same measurement functions Inspect > Measure already relies on: every
 * face has a non-zero area and every edge a non-zero length. A face or edge slipping
 * through with (numerically) zero measure is the one class of degenerate geometry that
 * would otherwise render fine and fail silently later, in a boolean operation or an
 * export — everything else a real analyzer catches (self-intersections, non-manifold
 * edges, ...) is out of reach without extending the WASM build itself.
 */
export function computeGeometryCheck(): GeometryCheckResult | null {
  const shape = getCurrentShape();
  if (!shape) return null;

  // Also covers the OCCT measurement calls below throwing — see `kernel/measure.ts`'s
  // `computeMassProperties` doc comment for why an uncaught throw here, inside the
  // section's own `useMemo` with no error boundary above it, would freeze the whole
  // Inspect panel rather than just showing its "nothing to check" state.
  try {
    const issues: string[] = [];

    shape.faces.forEach((face, index) => {
      const area = measureArea(face);
      if (!Number.isFinite(area) || area <= 1e-9) {
        issues.push(`Face ${index + 1} has zero area`);
      }
    });

    shape.edges.forEach((edge, index) => {
      const length = measureLength(edge);
      if (!Number.isFinite(length) || length <= 1e-9) {
        issues.push(`Edge ${index + 1} has zero length`);
      }
    });

    return { faceCount: shape.faces.length, edgeCount: shape.edges.length, issues };
  } catch (error) {
    console.error("computeGeometryCheck failed", error);
    return null;
  }
}
