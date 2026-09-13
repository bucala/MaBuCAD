import { CatmullRomCurve3, Vector3 } from "three";

import { entityPoints } from "@/sketch/sketchModel";
import type { SketchEntity, SketchPoint } from "@/sketch/types";

/**
 * Pure geometry for rendering one sketch entity: what each entity's polyline is and *when*
 * it needs rebuilding. Kept in this standalone module (rather than inlined in
 * `SketchGeometry.tsx`) so the memoisation contract below is unit-testable — the drag
 * performance of a large sketch depends on exactly which store updates change which
 * entity's geometry.
 */

export type PointReader = (id: string) => SketchPoint | undefined;

/**
 * A stable string key encoding everything an entity's polyline reads from the point pool.
 *
 * The solver mutates one point per drag frame (`dragPoint` in `sketchStore.ts` rewrites
 * the sketch immutably, so every entity re-renders with a fresh `sketch` object), but an
 * entity's polyline only *changes* when a point it actually references moves. Comparing
 * this key is the cheap test an `EntityView`'s `useMemo` runs: rebuild the (expensive)
 * circle/arc/spline tessellation only when this entity's own points moved, and reuse the
 * previous array otherwise. Without it, dragging a single point would re-tessellate every
 * circle, arc and spline in the sketch on every pointer-move — at 60Hz that dominates the
 * frame budget the moment a sketch has a few dozen curved entities.
 */
export function entityPointVersion(entity: SketchEntity, pointById: PointReader): string {
  let version = entity.id;
  for (const id of entityPoints(entity)) {
    const point = pointById(id);
    version += `|${id}:${point ? `${point.x},${point.y}` : "?"}`;
  }
  if (entity.kind === "circle" || entity.kind === "arc") {
    version += `|r:${entity.radius}`;
  }
  return version;
}

/**
 * The polyline that draws one entity, in the sketch plane's local 2D (z = 0 for every
 * point — the parent group applies the plane rotation).
 *
 * Behavioural twin of the geometry `SketchGeometry.tsx`'s `EntityView` used to compute
 * inline: lines as their two endpoints, circles/arcs tessellated into segments, a spline
 * interpolated through its own points as a smooth curve.
 */
export function resolveEntityPolyline(
  entity: SketchEntity,
  pointById: PointReader,
): [number, number, number][] {
  const resolved = entityPoints(entity)
    .map((id) => pointById(id))
    .filter((point): point is SketchPoint => Boolean(point));

  if (entity.kind === "line") {
    return resolved.map((point) => [point.x, point.y, 0] as [number, number, number]);
  }

  if (entity.kind === "circle") {
    const centre = resolved[0];
    if (!centre) return [];
    const segments = 72;
    return Array.from({ length: segments + 1 }, (_, index) => {
      const angle = (index / segments) * Math.PI * 2;
      return [
        centre.x + Math.cos(angle) * entity.radius,
        centre.y + Math.sin(angle) * entity.radius,
        0,
      ] as [number, number, number];
    });
  }

  if (entity.kind === "arc") {
    const [centre, start, end] = resolved;
    if (!centre || !start || !end) return [];

    // Always sweeps counter-clockwise from start to end — the same convention
    // `arcMidpoint` and the sketch canvas's own arc preview both use.
    const startAngle = Math.atan2(start.y - centre.y, start.x - centre.x);
    let endAngle = Math.atan2(end.y - centre.y, end.x - centre.x);
    if (endAngle <= startAngle) endAngle += Math.PI * 2;

    const segments = 48;
    return Array.from({ length: segments + 1 }, (_, index) => {
      const angle = startAngle + ((endAngle - startAngle) * index) / segments;
      return [
        centre.x + Math.cos(angle) * entity.radius,
        centre.y + Math.sin(angle) * entity.radius,
        0,
      ] as [number, number, number];
    });
  }

  // Spline: interpolate through its points so the curve reads as a smooth profile.
  if (resolved.length < 2) return [];
  const curve = new CatmullRomCurve3(resolved.map((point) => new Vector3(point.x, point.y, 0)));
  return curve.getPoints(Math.max(24, resolved.length * 12)).map(
    (point) => [point.x, point.y, 0] as [number, number, number],
  );
}
