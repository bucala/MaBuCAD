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

/** Closest point on the straight segment `[a, b]` to `point`, clamped to the segment
 * itself rather than the infinite line through it — a leader anchor snapped mid-edge should
 * land somewhere between the edge's own two endpoints, never past either one. */
function nearestPointOnSegment(a: Point, b: Point, point: Point): Point {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq < 1e-9) return a;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSq));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/**
 * The closest snappable point, across every view on the sheet, to `point` (sheet-mm) —
 * `null` if nothing is within `tolerance` mm. A leader-based annotation (datum/GD&T/surface
 * finish/weld) or a dimension/ordinate pick can land on three kinds of real geometry, not
 * just a path's own recovered endpoints (a corner, or a line/arc's own start/end): anywhere
 * along an edge's own straight run (`nearestPointOnSegment`, since each recovered path is
 * already a short polyline of its own sampled points — true for a straight edge's 2
 * endpoints and a curve's several), and a circular edge's own centre (`fitCircle`) — the
 * "os" (axis/centre) a hole's own leader most naturally attaches to. All three compete on
 * equal footing; whichever is genuinely closest to the click wins, so an anchor dragged
 * right onto a corner still prefers that corner over a mid-edge point one pixel further
 * away.
 */
export function nearestVertex(
  views: DrawingViewData[],
  point: Point,
  tolerance: number,
): DrawingVertex | null {
  let best: DrawingVertex | null = null;
  let bestDistance = tolerance;
  const consider = (candidate: Point, viewId: string) => {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { ...candidate, viewId };
    }
  };

  for (const view of views) {
    const width = view.width * view.scale;
    const height = view.height * view.scale;
    const originX = view.x - width / 2;
    const originY = view.y - height / 2;
    // Mirrors the exact transform `DrawingSheet.tsx`'s `View` component renders with — a
    // path's raw coordinate `(px, py)` (replicad's own SVG-mirrored range `[-height, 0]`,
    // see `View`'s own doc comment) is shifted to `(px, py + view.height)` by the view's own
    // `translate(0, height)`, then that viewBox-space point scales and translates into the
    // sheet the same way the view's outer `<svg x y width height>` does. Any drift between
    // this and that render transform would make picked points land visibly off the geometry
    // they're meant to snap to, so the two must be kept in lockstep.
    const toSheet = (raw: Point): Point => ({
      x: originX + raw.x * view.scale,
      y: originY + (raw.y + view.height) * view.scale,
    });

    for (const d of [...view.visiblePaths, ...view.hiddenPaths]) {
      const rawPoints = pathEndpoints(d);
      const sheetPoints = rawPoints.map(toSheet);
      for (const vertex of sheetPoints) consider(vertex, view.id);
      for (let i = 0; i < sheetPoints.length - 1; i++) {
        consider(nearestPointOnSegment(sheetPoints[i], sheetPoints[i + 1], point), view.id);
      }
      const circle = fitCircle(d);
      if (circle) consider(toSheet({ x: circle.cx, y: circle.cy }), view.id);
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
