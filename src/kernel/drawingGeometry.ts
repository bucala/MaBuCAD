import type { DrawingViewData } from "@/types/document";

/**
 * Picking geometry for a Drawing sheet's already-placed views.
 *
 * A placed view stores only rendered SVG path `d` strings (`DrawingViewData.visiblePaths`/
 * `hiddenPaths`), not a structured point/segment list — reasonable for rendering, but a
 * drawing-level dimension/datum/GD&T tool needs to pick real vertices of that geometry, not
 * arbitrary sheet positions. This file is the one place that parses those path strings back
 * into points and maps them into sheet-mm coordinates, so `annotation.smart-dimension`,
 * `annotation.ordinate`, `annotation.datum` and `annotation.gdt` all snap to the same set of
 * points instead of each re-deriving this.
 */

interface Point {
  x: number;
  y: number;
}

/** Every path command replicad's `toSVGPathD()` emits is absolute, and each command's own
 * final two numbers are always that segment's endpoint (a line's own end, an arc/bezier's
 * own end, ignoring any earlier control-point/radius numbers) — see
 * `node_modules/replicad/dist/replicad.js`'s `adaptedCurveToPathElem`. Splitting on command
 * letters and taking the trailing pair therefore recovers every real vertex without needing
 * to actually interpret each curve type. */
function pathEndpoints(d: string): Point[] {
  const points: Point[] = [];
  const commandPattern = /([MLQCAZ])([^MLQCAZ]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = commandPattern.exec(d))) {
    const command = match[1].toUpperCase();
    if (command === "Z") continue;
    const numbers = match[2]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (numbers.length < 2) continue;
    const x = numbers[numbers.length - 2];
    const y = numbers[numbers.length - 1];
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }
  return points;
}

/**
 * Fits a circle to a projected path's own sampled endpoints, if it's circular enough —
 * every point roughly equidistant from their shared centroid — or `null` if it isn't.
 * Requires at least one arc (`A`) command in the path, the only way replicad ever actually
 * emits a circle; without that guard, a plain 2-point line segment would false-positive too
 * (its two endpoints are trivially "equidistant" from their own midpoint by definition).
 * Operates in whatever coordinate space `d` is already in — `kernel/drawingProjection.ts`'s
 * `threadOverlaysFor` calls this on a view's *raw* (pre-placement-scale) cached paths, so
 * the radius it returns is a real-world mm value comparable directly against a tap drill
 * table entry.
 */
export function fitCircle(d: string): { cx: number; cy: number; r: number } | null {
  if (!/[Aa]/.test(d)) return null;
  const points = pathEndpoints(d);
  const unique: Point[] = [];
  for (const point of points) {
    if (!unique.some((existing) => Math.hypot(existing.x - point.x, existing.y - point.y) < 1e-6)) unique.push(point);
  }
  if (unique.length < 2) return null;

  const cx = unique.reduce((sum, point) => sum + point.x, 0) / unique.length;
  const cy = unique.reduce((sum, point) => sum + point.y, 0) / unique.length;
  const radii = unique.map((point) => Math.hypot(point.x - cx, point.y - cy));
  const meanRadius = radii.reduce((sum, r) => sum + r, 0) / radii.length;
  if (meanRadius < 1e-6) return null;
  const maxDeviation = Math.max(...radii.map((r) => Math.abs(r - meanRadius)));
  if (maxDeviation > meanRadius * 0.02) return null;

  return { cx, cy, r: meanRadius };
}

/** A vertex of a placed view's own projected geometry, already converted into sheet-mm —
 * the unit every other placed element (views, notes) on the sheet is positioned in. */
export interface DrawingVertex extends Point {
  viewId: string;
}

/**
 * Converts one raw projected point (replicad's own SVG-mirrored range `[-height, 0]`) into
 * the sheet-mm space every placed annotation uses. This is the single source of truth for
 * the exact transform `DrawingSheet.tsx`'s `View` component renders with: shift Y by the
 * view height, scale, then translate into the view's own outer `<svg>` origin. Any drift
 * between this and that render transform would make picked points land visibly off the
 * geometry they're meant to snap to, so every picking helper goes through here.
 */
export function viewPointToSheet(view: DrawingViewData, point: Point): Point {
  const width = view.width * view.scale;
  const height = view.height * view.scale;
  return {
    x: view.x - width / 2 + point.x * view.scale,
    y: view.y - height / 2 + (point.y + view.height) * view.scale,
  };
}

/** `view`'s own projected path endpoints, in sheet-mm via `viewPointToSheet`. */
export function viewVertices(view: DrawingViewData): DrawingVertex[] {
  const toSheet = (point: Point): DrawingVertex => ({ ...viewPointToSheet(view, point), viewId: view.id });
  const paths = [...view.visiblePaths, ...view.hiddenPaths];
  return paths.flatMap((d) => pathEndpoints(d).map(toSheet));
}

/**
 * The closest vertex, across every view on the sheet, to `point` (sheet-mm) — `null` if
 * nothing is within `tolerance` mm. Dimensioning/datum/GD&T tools all pick against real
 * geometry rather than an arbitrary sheet position, the same "click has to land near
 * something real" convention the sketch tools already enforce for their own picks.
 */
export function nearestVertex(
  views: DrawingViewData[],
  point: Point,
  tolerance: number,
): DrawingVertex | null {
  let best: DrawingVertex | null = null;
  let bestDistance = tolerance;

  for (const view of views) {
    for (const vertex of viewVertices(view)) {
      const distance = Math.hypot(vertex.x - point.x, vertex.y - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = vertex;
      }
    }
  }

  return best;
}

/** The view a vertex belongs to's own `scale` — a dimension's real-world value is the
 * sheet-mm span between two of its own vertices divided by this, so a callout on a 2:1
 * detail view still reports the part's actual size, not the enlarged on-paper one. */
export function viewScaleFor(views: DrawingViewData[], viewId: string): number {
  return views.find((view) => view.id === viewId)?.scale ?? 1;
}
