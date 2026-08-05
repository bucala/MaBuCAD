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

/** A vertex of a placed view's own projected geometry, already converted into sheet-mm —
 * the unit every other placed element (views, notes) on the sheet is positioned in. */
export interface DrawingVertex extends Point {
  viewId: string;
}

/**
 * `view`'s own projected vertices, in sheet-mm.
 *
 * Mirrors the exact transform `DrawingSheet.tsx`'s `View` component renders with — a path's
 * raw coordinate `(px, py)` (replicad's own SVG-mirrored range `[-height, 0]`, see `View`'s
 * own doc comment) is shifted to `(px, py + view.height)` by the view's own
 * `translate(0, height)`, then that viewBox-space point scales and translates into the
 * sheet the same way the view's outer `<svg x y width height>` does. Any drift between this
 * and that render transform would make picked points land visibly off the geometry they're
 * meant to snap to, so the two must be kept in lockstep.
 */
export function viewVertices(view: DrawingViewData): DrawingVertex[] {
  const width = view.width * view.scale;
  const height = view.height * view.scale;
  const originX = view.x - width / 2;
  const originY = view.y - height / 2;

  const toSheet = (point: Point): DrawingVertex => ({
    x: originX + point.x * view.scale,
    y: originY + (point.y + view.height) * view.scale,
    viewId: view.id,
  });

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
