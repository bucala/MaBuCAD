import type {
  Dimension,
  DimensionKind,
  GeometricConstraint,
  GeometricConstraintKind,
  Sketch,
  SketchEntity,
  SketchPoint,
} from "./types";

let counter = 0;
const uid = (prefix: string) => `${prefix}-${(counter += 1)}`;

/** Every sketch owns a fixed origin, which is what ordinate dimensions measure from. */
export const ORIGIN_SUFFIX = "origin";

export function originPointId(sketchId: string): string {
  return `${sketchId}-${ORIGIN_SUFFIX}`;
}

export function createSketch(id: string, planeId: string): Sketch {
  const origin: SketchPoint = { id: originPointId(id), x: 0, y: 0 };

  return {
    id,
    planeId,
    points: [origin],
    entities: [],
    constraints: [
      { id: uid("con"), kind: "fix", entities: [], points: [origin.id] },
    ],
    dimensions: [],
  };
}

export const isOriginPoint = (sketch: Sketch, pointId: string) =>
  pointId === originPointId(sketch.id);

/* ------------------------------------------------------------------ geometry */

/**
 * Finds an existing point within `tolerance` of a position.
 *
 * This is what makes profiles close: clicking near the first point of a chain reuses that
 * point rather than creating a coincident duplicate, so the loop is genuinely connected.
 */
export function findPointNear(
  sketch: Sketch,
  x: number,
  y: number,
  tolerance: number,
): SketchPoint | null {
  let best: SketchPoint | null = null;
  let bestDistance = tolerance;

  for (const point of sketch.points) {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }

  return best;
}

/** Adds a point, or returns the existing one when the position snaps to it. */
export function ensurePoint(
  sketch: Sketch,
  x: number,
  y: number,
  tolerance: number,
): { sketch: Sketch; pointId: string; reused: boolean } {
  const existing = findPointNear(sketch, x, y, tolerance);
  if (existing) {
    return { sketch, pointId: existing.id, reused: true };
  }

  const point: SketchPoint = { id: uid("pt"), x, y };
  return { sketch: { ...sketch, points: [...sketch.points, point] }, pointId: point.id, reused: false };
}

export function addLine(
  sketch: Sketch,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { construction?: boolean; isAxis?: boolean; tolerance?: number } = {},
): { sketch: Sketch; entityId: string; startId: string; endId: string } {
  const tolerance = options.tolerance ?? 0;

  const start = ensurePoint(sketch, from.x, from.y, tolerance);
  const end = ensurePoint(start.sketch, to.x, to.y, tolerance);

  // An axis line is always also a construction line — see LineEntity's own doc comment on
  // `isAxis` — so callers only need to pass `isAxis: true` and the profile-exclusion side
  // of it comes along for free through the existing `!entity.construction` filters.
  const entity: SketchEntity = {
    id: uid("line"),
    kind: "line",
    start: start.pointId,
    end: end.pointId,
    construction: (options.construction ?? false) || (options.isAxis ?? false),
    isAxis: options.isAxis ?? false,
  };

  return {
    sketch: { ...end.sketch, entities: [...end.sketch.entities, entity] },
    entityId: entity.id,
    startId: start.pointId,
    endId: end.pointId,
  };
}

/**
 * Adds a rectangle as four lines sharing corner points, plus the horizontal and vertical
 * constraints that keep it rectangular.
 *
 * Building it from constrained lines rather than a dedicated entity means the solver, the
 * dimensioning tools and the eventual extrude all treat it as ordinary profile geometry.
 */
export function addRectangle(
  sketch: Sketch,
  corner: { x: number; y: number },
  opposite: { x: number; y: number },
  options: { construction?: boolean; tolerance?: number } = {},
): { sketch: Sketch; entityIds: string[] } {
  const tolerance = options.tolerance ?? 0;
  const construction = options.construction ?? false;

  const corners = [
    { x: corner.x, y: corner.y },
    { x: opposite.x, y: corner.y },
    { x: opposite.x, y: opposite.y },
    { x: corner.x, y: opposite.y },
  ];

  let working = sketch;
  const pointIds: string[] = [];
  for (const position of corners) {
    const result = ensurePoint(working, position.x, position.y, tolerance);
    working = result.sketch;
    pointIds.push(result.pointId);
  }

  const entities: SketchEntity[] = pointIds.map((pointId, index) => ({
    id: uid("line"),
    kind: "line" as const,
    start: pointId,
    end: pointIds[(index + 1) % pointIds.length],
    construction,
  }));

  const constraints: GeometricConstraint[] = [
    { id: uid("con"), kind: "horizontal", entities: [entities[0].id], points: [] },
    { id: uid("con"), kind: "vertical", entities: [entities[1].id], points: [] },
    { id: uid("con"), kind: "horizontal", entities: [entities[2].id], points: [] },
    { id: uid("con"), kind: "vertical", entities: [entities[3].id], points: [] },
  ];

  return {
    sketch: {
      ...working,
      entities: [...working.entities, ...entities],
      constraints: [...working.constraints, ...constraints],
    },
    entityIds: entities.map((entity) => entity.id),
  };
}

export function addCircle(
  sketch: Sketch,
  centre: { x: number; y: number },
  radius: number,
  options: { construction?: boolean; tolerance?: number } = {},
): { sketch: Sketch; entityId: string } {
  const centrePoint = ensurePoint(sketch, centre.x, centre.y, options.tolerance ?? 0);

  const entity: SketchEntity = {
    id: uid("circle"),
    kind: "circle",
    center: centrePoint.pointId,
    radius: Math.max(radius, 1e-3),
    construction: options.construction ?? false,
  };

  return {
    sketch: { ...centrePoint.sketch, entities: [...centrePoint.sketch.entities, entity] },
    entityId: entity.id,
  };
}

export function addSpline(
  sketch: Sketch,
  positions: { x: number; y: number }[],
  options: { construction?: boolean; tolerance?: number } = {},
): { sketch: Sketch; entityId: string } {
  let working = sketch;
  const pointIds: string[] = [];

  for (const position of positions) {
    const result = ensurePoint(working, position.x, position.y, options.tolerance ?? 0);
    working = result.sketch;
    pointIds.push(result.pointId);
  }

  const entity: SketchEntity = {
    id: uid("spline"),
    kind: "spline",
    points: pointIds,
    construction: options.construction ?? false,
  };

  return {
    sketch: { ...working, entities: [...working.entities, entity] },
    entityId: entity.id,
  };
}

/**
 * Adds a standalone reference point.
 *
 * Wrapping the point in its own entity (rather than leaving it a bare pool point) is what
 * makes it durable: `deleteSelection` recomputes surviving points from `entityPoints()` of
 * the entities that survive a delete, so an unwrapped point would vanish the next time
 * anything else in the sketch was deleted, whether or not the point itself was selected.
 */
export function addPoint(
  sketch: Sketch,
  position: { x: number; y: number },
  options: { tolerance?: number } = {},
): { sketch: Sketch; entityId: string } {
  const anchor = ensurePoint(sketch, position.x, position.y, options.tolerance ?? 0);

  const entity: SketchEntity = { id: uid("point"), kind: "point", at: anchor.pointId, construction: false };

  return {
    sketch: { ...anchor.sketch, entities: [...anchor.sketch.entities, entity] },
    entityId: entity.id,
  };
}

/* --------------------------------------------------------------- constraints */

/** Whether two id lists name the same members, regardless of order — a relation between
 * "line A, line B" is the same relation as "line B, line A". */
function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = [...b].sort();
  return [...a].sort().every((id, index) => id === sorted[index]);
}

/**
 * Adds a relation, unless an identical one (same kind, same entities, same points) already
 * exists, in which case the sketch is returned unchanged. Without this, "Constraints
 * smart" (`commitDragSnap` in `sketchStore.ts`) added a fresh duplicate constraint every
 * time a drag ended near a suggestion it had already been snapped to — nudging the same
 * point back onto the same target a few times left several redundant coincident/tangent
 * constraints behind, all pinning the same two things, that a Delete Selection had to be
 * used to notice and clean up one at a time. The explicit "Add Relation" panel buttons
 * share this same guard, so a repeated click there is equally a no-op instead of a stacked
 * duplicate.
 */
export function addConstraint(
  sketch: Sketch,
  kind: GeometricConstraintKind,
  entities: string[],
  points: string[],
): Sketch {
  const isDuplicate = sketch.constraints.some(
    (constraint) =>
      constraint.kind === kind &&
      sameMembers(constraint.entities, entities) &&
      sameMembers(constraint.points, points),
  );
  if (isDuplicate) return sketch;

  return {
    ...sketch,
    constraints: [...sketch.constraints, { id: uid("con"), kind, entities, points }],
  };
}

/** Which point-on-curve constraint kind pins a point onto this entity's curve — the shared
 * dispatch behind both the "Coincident" button (`sketchStore.ts`'s `applyConstraint`, one
 * point plus one curve selected) and trim's own split-point constraints below. `undefined`
 * for entity kinds a point can't be pinned onto this way (a standalone `point` entity, or
 * another `point`-anchored thing). */
export function curveConstraintKind(
  entity: SketchEntity,
): Extract<GeometricConstraintKind, "point-on-line" | "point-on-circle" | "point-on-spline"> | undefined {
  switch (entity.kind) {
    case "line":
      return "point-on-line";
    case "circle":
    case "arc":
      return "point-on-circle";
    case "spline":
      return "point-on-spline";
    default:
      return undefined;
  }
}

export function addDimension(
  sketch: Sketch,
  kind: DimensionKind,
  value: number,
  points: string[],
  entities: string[],
  labelOffset: { x: number; y: number } = { x: 0, y: 0 },
): { sketch: Sketch; dimensionId: string } {
  const dimension: Dimension = {
    id: uid("dim"),
    kind,
    value,
    points,
    entities,
    labelOffset,
  };

  return {
    sketch: { ...sketch, dimensions: [...sketch.dimensions, dimension] },
    dimensionId: dimension.id,
  };
}

/* ------------------------------------------------------------------ measuring */

export const pointById = (sketch: Sketch, id: string) =>
  sketch.points.find((point) => point.id === id);

export const entityById = (sketch: Sketch, id: string) =>
  sketch.entities.find((entity) => entity.id === id);

/**
 * Rounds a freshly measured value to display precision.
 *
 * A dimension seeded straight from floating-point geometry reads as 32.10000000000001,
 * and since the value is a driving equation the noise would be solved back into the
 * geometry. Rounding to 0.01 mm gives the clean number a drawing would carry.
 */
export function roundDimensionValue(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Current measured value for a dimension, used to seed a newly created one. */
export function measure(sketch: Sketch, kind: DimensionKind, points: string[], entities: string[]): number {
  const first = points[0] ? pointById(sketch, points[0]) : undefined;
  const second = points[1] ? pointById(sketch, points[1]) : undefined;

  switch (kind) {
    case "distance":
      return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0;
    case "point-line-distance": {
      const line = entities[0] ? entityById(sketch, entities[0]) : undefined;
      if (line?.kind !== "line" || !first) return 0;
      const start = pointById(sketch, line.start);
      const end = pointById(sketch, line.end);
      if (!start || !end) return 0;
      const ux = end.x - start.x;
      const uy = end.y - start.y;
      const scale = Math.hypot(ux, uy) || 1;
      return Math.abs(ux * (first.y - start.y) - uy * (first.x - start.x)) / scale;
    }
    case "horizontal-distance":
    case "ordinate-x":
      return first && second ? second.x - first.x : 0;
    case "vertical-distance":
    case "ordinate-y":
      return first && second ? second.y - first.y : 0;
    case "radius": {
      const entity = entities[0] ? entityById(sketch, entities[0]) : undefined;
      return entity?.kind === "circle" || entity?.kind === "arc" ? entity.radius : 0;
    }
    case "diameter": {
      const entity = entities[0] ? entityById(sketch, entities[0]) : undefined;
      return entity?.kind === "circle" || entity?.kind === "arc" ? entity.radius * 2 : 0;
    }
    case "angle": {
      const [firstId, secondId] = entities;
      const a = entityById(sketch, firstId);
      const b = entityById(sketch, secondId);
      if (a?.kind !== "line" || b?.kind !== "line") return 0;

      const ends = (line: typeof a) => {
        const start = pointById(sketch, line.start);
        const end = pointById(sketch, line.end);
        return start && end ? { x: end.x - start.x, y: end.y - start.y } : { x: 0, y: 0 };
      };

      const u = ends(a);
      const v = ends(b);
      // A degenerate (zero-length) line has no angle to anything — `atan2(0, 0)` is 0 and
      // would silently report a confident-looking 0° for a line with no direction. The
      // solver's own angle residual skips the same case (see `residuals.ts`).
      const scaleU = Math.hypot(u.x, u.y);
      const scaleV = Math.hypot(v.x, v.y);
      if (scaleU < 1e-9 || scaleV < 1e-9) return 0;
      const angle = Math.atan2(Math.abs(u.x * v.y - u.y * v.x), u.x * v.x + u.y * v.y);
      return (angle * 180) / Math.PI;
    }
    default:
      return 0;
  }
}

/**
 * Where a dimension's label sits before any drag offset is applied — mirrors
 * `SketchDimensions.tsx`'s own per-kind anchor logic (a circle/arc's rim point, an
 * angle's shared-vertex-ish centroid, a distance's midpoint) closely enough to seed a
 * sensible `labelOffset` when the Inventor-style Smart Dimension flow commits a pending
 * proposal at wherever the user's final click landed (`sketchStore.ts`'s
 * `commitPendingDimension`) — not pixel-identical to the render-time anchor (that one
 * also nudges perpendicular to a distance's line, which this skips), just close enough
 * that the committed label ends up under the cursor rather than at a visible offset.
 */
export function defaultDimensionAnchor(
  sketch: Sketch,
  kind: DimensionKind,
  points: string[],
  entities: string[],
): { x: number; y: number } | null {
  if (kind === "radius" || kind === "diameter") {
    const entity = entities[0] ? entityById(sketch, entities[0]) : undefined;
    if (entity?.kind !== "circle" && entity?.kind !== "arc") return null;
    const centre = pointById(sketch, entity.center);
    if (!centre) return null;
    return {
      x: centre.x + entity.radius * Math.SQRT1_2,
      y: centre.y + entity.radius * Math.SQRT1_2,
    };
  }

  if (kind === "point-line-distance") {
    const line = entities[0] ? entityById(sketch, entities[0]) : undefined;
    const point = points[0] ? pointById(sketch, points[0]) : undefined;
    if (line?.kind !== "line" || !point) return null;
    const start = pointById(sketch, line.start);
    const end = pointById(sketch, line.end);
    if (!start || !end) return null;
    // The point's own perpendicular foot on the line — the natural anchor for a
    // point-to-line dimension, the same way a plain point-to-point distance anchors at
    // its own midpoint.
    const ux = end.x - start.x;
    const uy = end.y - start.y;
    const lengthSquared = ux * ux + uy * uy || 1e-12;
    const t = ((point.x - start.x) * ux + (point.y - start.y) * uy) / lengthSquared;
    const footX = start.x + t * ux;
    const footY = start.y + t * uy;
    return { x: (point.x + footX) / 2, y: (point.y + footY) / 2 };
  }

  if (kind === "angle") {
    const [firstId, secondId] = entities;
    const a = firstId ? entityById(sketch, firstId) : undefined;
    const b = secondId ? entityById(sketch, secondId) : undefined;
    const endpoints = [a, b]
      .filter((line): line is Extract<typeof line, { kind: "line" }> => line?.kind === "line")
      .flatMap((line) => [pointById(sketch, line.start), pointById(sketch, line.end)])
      .filter((point): point is NonNullable<typeof point> => Boolean(point));
    if (endpoints.length === 0) return null;
    return {
      x: endpoints.reduce((sum, point) => sum + point.x, 0) / endpoints.length,
      y: endpoints.reduce((sum, point) => sum + point.y, 0) / endpoints.length,
    };
  }

  const first = points[0] ? pointById(sketch, points[0]) : undefined;
  const second = points[1] ? pointById(sketch, points[1]) : undefined;
  if (!first || !second) return null;
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

/**
 * A relation a point drag is close enough to suggest — inferred live as the drag moves
 * (`sketchStore.ts`'s `dragPoint`), rendered as a highlight (`DragSnapIndicator.tsx`),
 * and only actually applied on release (`commitDragSnap`), so a suggestion never fights
 * the drag itself, only what happens when the user lets go near one.
 *
 * `"midpoint"` adds a real, persisted `"midpoint"` constraint on release (`commitDragSnap`),
 * so the point keeps tracking the line's midpoint as the line's endpoints move afterward,
 * rather than a one-time positional snap that quietly stops holding the moment anything else
 * moves the line. `"coincident"` also covers "drag a point onto a circle's centre", since a
 * circle's centre is a plain point in this model, and `"tangent"` reuses the same line-circle
 * residual `applyConstraint`'s own Tangent button already drives.
 */
export type DragSnapSuggestion =
  | { kind: "coincident"; targetPointId: string; position: { x: number; y: number } }
  | { kind: "midpoint"; lineEntityId: string; position: { x: number; y: number } }
  | { kind: "tangent"; lineEntityId: string; circleEntityId: string; position: { x: number; y: number } };

/**
 * What a point at `position` (mid-drag) is close enough to for `pickForSmartDimension`'s
 * sibling flow — "constrains smart" — to suggest. Checked in priority order (coincident,
 * then midpoint, then tangent) and returns the first match rather than the closest one
 * across categories; only one category is realistically in tolerance at once in practice,
 * since they're spatially distinct (a vertex, a line's middle, a circle's rim).
 */
export function inferDragSnap(
  sketch: Sketch,
  draggedPointId: string,
  position: { x: number; y: number },
  tolerance: number,
): DragSnapSuggestion | null {
  for (const point of sketch.points) {
    if (point.id === draggedPointId) continue;
    if (Math.hypot(point.x - position.x, point.y - position.y) <= tolerance) {
      return { kind: "coincident", targetPointId: point.id, position: { x: point.x, y: point.y } };
    }
  }

  // The line the dragged point is itself an endpoint of is excluded — its own midpoint
  // trivially follows the drag and would otherwise always "win".
  const ownLineId = sketch.entities.find(
    (entity) => entity.kind === "line" && (entity.start === draggedPointId || entity.end === draggedPointId),
  )?.id;

  for (const entity of sketch.entities) {
    if (entity.kind !== "line" || entity.id === ownLineId) continue;
    const start = pointById(sketch, entity.start);
    const end = pointById(sketch, entity.end);
    if (!start || !end) continue;

    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    if (Math.hypot(midpoint.x - position.x, midpoint.y - position.y) <= tolerance) {
      return { kind: "midpoint", lineEntityId: entity.id, position: midpoint };
    }
  }

  if (ownLineId) {
    const line = sketch.entities.find((entity) => entity.id === ownLineId);
    const otherEndId = line?.kind === "line" ? (line.start === draggedPointId ? line.end : line.start) : undefined;
    const otherEnd = otherEndId ? pointById(sketch, otherEndId) : undefined;

    if (otherEnd) {
      for (const entity of sketch.entities) {
        if (entity.kind !== "circle") continue;
        const centre = pointById(sketch, entity.center);
        if (!centre) continue;

        const u = { x: position.x - otherEnd.x, y: position.y - otherEnd.y };
        const denominator = Math.max(Math.hypot(u.x, u.y), 1e-9);
        const toCentre = { x: centre.x - otherEnd.x, y: centre.y - otherEnd.y };
        const distance = Math.abs(u.x * toCentre.y - u.y * toCentre.x) / denominator;

        if (Math.abs(distance - entity.radius) <= tolerance) {
          return { kind: "tangent", lineEntityId: ownLineId, circleEntityId: entity.id, position };
        }
      }
    }
  }

  return null;
}

/**
 * Chooses the dimension a Smart Dimension click should create from what is selected,
 * mirroring how SolidWorks infers intent rather than asking.
 */
export function inferSmartDimension(
  sketch: Sketch,
  selectedEntities: string[],
  selectedPoints: string[],
): {
  kind: DimensionKind;
  points: string[];
  entities: string[];
  /** Set only for the parallel-lines case below: the pair a "parallel" constraint should
   * also be added between when this proposal commits, so the two stay a rigid parallel
   * pair under dragging rather than just the one pinned point holding its distance. */
  alsoConstrainParallel?: [string, string];
} | null {
  if (selectedPoints.length === 2) {
    return { kind: "distance", points: selectedPoints, entities: [] };
  }

  if (selectedEntities.length === 1 && selectedPoints.length === 1) {
    const entity = entityById(sketch, selectedEntities[0]);
    // Excludes the line's own endpoints — picking a line plus one of its own ends means
    // "dimension this line's length" (the plain single-line-selected case below already
    // covers that), not a point-to-line span, which only makes sense for a point that
    // isn't already on the line by construction.
    if (entity?.kind === "line" && !entityPoints(entity).includes(selectedPoints[0])) {
      return { kind: "point-line-distance", points: selectedPoints, entities: selectedEntities };
    }
  }

  if (selectedEntities.length === 1) {
    const entity = entityById(sketch, selectedEntities[0]);
    if (entity?.kind === "circle" || entity?.kind === "arc") {
      // A circle plus its own centre point (the two are only ever selected together
      // deliberately — a click on the rim selects the entity, the centre needs its own
      // click) asks for the diameter instead of the radius, the same distinction
      // SolidWorks draws by whether the drag that creates the dimension crosses the
      // centre. Arcs stay radius-only: a partial sweep is conventionally always
      // radius-dimensioned, never diameter, so this only applies to a full circle.
      const wantsDiameter = entity.kind === "circle" && selectedPoints.includes(entity.center);
      return { kind: wantsDiameter ? "diameter" : "radius", points: [], entities: [entity.id] };
    }
    if (entity?.kind === "line") {
      return { kind: "distance", points: [entity.start, entity.end], entities: [] };
    }
    if (entity?.kind === "spline" && entity.points.length >= 2) {
      // The chord between the spline's own endpoints — there's no dedicated "arc length"
      // dimension kind (or a way to solve toward one: a target length has no unique
      // relationship back to a spline's several control points), so this reuses the same
      // point-to-point `distance` a line's own length already is. Documented as an
      // approximation, not the true integrated curve length.
      return {
        kind: "distance",
        points: [entity.points[0], entity.points[entity.points.length - 1]],
        entities: [],
      };
    }
  }

  if (selectedEntities.length === 2) {
    const first = entityById(sketch, selectedEntities[0]);
    const second = entityById(sketch, selectedEntities[1]);
    if (first?.kind === "line" && second?.kind === "line") {
      const firstStart = pointById(sketch, first.start);
      const firstEnd = pointById(sketch, first.end);
      const secondStart = pointById(sketch, second.start);
      const secondEnd = pointById(sketch, second.end);
      if (firstStart && firstEnd && secondStart && secondEnd) {
        const ux = firstEnd.x - firstStart.x;
        const uy = firstEnd.y - firstStart.y;
        const vx = secondEnd.x - secondStart.x;
        const vy = secondEnd.y - secondStart.y;
        const scale = Math.max(Math.hypot(ux, uy) * Math.hypot(vx, vy), 1e-9);
        // Same "cross product of the two directions, normalised" the `parallel` geometric
        // constraint's own residual already uses to mean "these are parallel" — reusing
        // it here means "already parallel enough that an angle dimension would just be a
        // degenerate 0°/180°" is judged by exactly the same yardstick a real Parallel
        // relation would be, not a separately-tuned threshold.
        const sinAngle = Math.abs(ux * vy - uy * vx) / scale;
        if (sinAngle < 0.02) {
          // An angle dimension between two already-parallel lines has nothing real to
          // measure (it can only ever read 0° or 180°) and sits right at the solver's own
          // singular point for that residual — what's actually useful here is the gap
          // between them, so this reads as a point-line-distance instead: one line's own
          // start point, measured against the other line. `alsoConstrainParallel` is what
          // keeps them a rigid pair afterward rather than only pinning that one point.
          return {
            kind: "point-line-distance",
            points: [first.start],
            entities: [second.id],
            alsoConstrainParallel: [first.id, second.id],
          };
        }
      }
      return { kind: "angle", points: [], entities: selectedEntities };
    }
  }

  return null;
}

/** Points that belong to an entity, for selection and constraint application. */
export function entityPoints(entity: SketchEntity): string[] {
  switch (entity.kind) {
    case "line":
      return [entity.start, entity.end];
    case "circle":
      return [entity.center];
    case "spline":
      return entity.points;
    case "point":
      return [entity.at];
    case "arc":
      return [entity.center, entity.start, entity.end];
  }
}

/**
 * The point on an arc's rim halfway around its counter-clockwise sweep from `start` to
 * `end`, in sketch coordinates.
 *
 * Shared by the kernel's exact draw path (`kernel/profile.ts`, via `threePointsArcTo`,
 * which needs a real point on the curve rather than a radius/angle pair) and the
 * viewport's rendering — both must agree on which of the two arcs a `start`/`end` pair
 * denotes, so this is the one place that decides it.
 */
export function arcMidpoint(
  centre: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
  radius: number,
): { x: number; y: number } {
  const startAngle = Math.atan2(start.y - centre.y, start.x - centre.x);
  let endAngle = Math.atan2(end.y - centre.y, end.x - centre.x);
  if (endAngle <= startAngle) endAngle += Math.PI * 2;

  const midAngle = (startAngle + endAngle) / 2;
  return { x: centre.x + radius * Math.cos(midAngle), y: centre.y + radius * Math.sin(midAngle) };
}

/**
 * Clamps `angle` (radians) to an arc's own swept range, snapping to whichever endpoint is
 * nearer when it falls outside — used to keep a radius/diameter dimension's leader
 * anchored on the arc's actual visible curve. A full circle has no sweep to clamp to
 * (every direction is on it), so this is only meaningful for a genuine partial arc: the
 * "point toward wherever the label currently is" direction the dimension leader otherwise
 * uses is unconstrained and can easily land in the wedge the arc doesn't cover, which
 * reads as the arrow pointing at nothing — the same bug a full circle's radius dimension
 * doesn't have, since every direction there really is on the rim.
 */
export function clampAngleToArcSweep(
  centre: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
  angle: number,
): number {
  const startAngle = Math.atan2(start.y - centre.y, start.x - centre.x);
  let endAngle = Math.atan2(end.y - centre.y, end.x - centre.x);
  if (endAngle <= startAngle) endAngle += Math.PI * 2;

  let normalized = angle;
  while (normalized < startAngle) normalized += Math.PI * 2;
  while (normalized > startAngle + Math.PI * 2) normalized -= Math.PI * 2;
  if (normalized >= startAngle && normalized <= endAngle) return normalized;

  // Outside the sweep: snap to whichever end is angularly closer.
  const distanceToStart = Math.min(Math.abs(normalized - startAngle), Math.abs(normalized - startAngle - Math.PI * 2));
  const distanceToEnd = Math.min(Math.abs(normalized - endAngle), Math.abs(normalized - endAngle - Math.PI * 2));
  return distanceToStart <= distanceToEnd ? startAngle : endAngle;
}

/** The resolved geometry an angle dimension needs to draw itself: which point is the
 * vertex, which way along each line the measured sector opens, and how far each drawn
 * line segment reaches along its own ray (so the renderer only adds witness lines where
 * the geometry itself doesn't already cross the arc — matching the drafting convention
 * that the measured lines serve as their own extension lines when they reach it). */
export interface AngleDimensionGeometry {
  vertex: { x: number; y: number };
  /** Unit rays from the vertex along each measured line. `rayB` is flipped away from the
   * drawn line's own direction when the stored `value` is the supplement (the dimension's
   * own Flip), so the arc always sweeps exactly `value` degrees. */
  rayA: { x: number; y: number };
  rayB: { x: number; y: number };
  /** Radians: direction of `rayA`, and the signed sweep from it to `rayB`
   * (`|sweep|` == value in radians, sign picks the shorter CCW/CW arc). */
  startAngle: number;
  sweep: number;
  /** Projections of each line's two endpoints onto its own ray, relative to the vertex —
   * `near` is negative when the vertex lies inside or past that end of the segment. */
  spanA: { near: number; far: number };
  spanB: { near: number; far: number };
}

/**
 * Resolves an angle dimension's two line entities into a drawable sector. The vertex is
 * the lines' shared endpoint when they touch, else their (infinite) line intersection;
 * parallel lines have no angle vertex and return `null`, matching the renderer's previous
 * label-only fallback for a case it can't meaningfully draw.
 */
export function angleDimensionGeometry(sketch: Sketch, dimension: Dimension): AngleDimensionGeometry | null {
  const [firstId, secondId] = dimension.entities;
  const lineA = firstId ? entityById(sketch, firstId) : undefined;
  const lineB = secondId ? entityById(sketch, secondId) : undefined;
  if (lineA?.kind !== "line" || lineB?.kind !== "line") return null;
  const a1 = pointById(sketch, lineA.start);
  const a2 = pointById(sketch, lineA.end);
  const b1 = pointById(sketch, lineB.start);
  const b2 = pointById(sketch, lineB.end);
  if (!a1 || !a2 || !b1 || !b2) return null;

  const samePoint = (p: SketchPoint, q: SketchPoint) =>
    p.id === q.id || Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
  let vertex = [a1, a2].flatMap((p) => [b1, b2].map((q) => ({ p, q }))).find(({ p, q }) => samePoint(p, q))?.p;
  if (!vertex) {
    const ux = a2.x - a1.x;
    const uy = a2.y - a1.y;
    const vx = b2.x - b1.x;
    const vy = b2.y - b1.y;
    const cross = ux * vy - uy * vx;
    if (Math.abs(cross) < 1e-9) return null;
    const t = ((b1.x - a1.x) * vy - (b1.y - a1.y) * vx) / cross;
    vertex = { id: "", x: a1.x + t * ux, y: a1.y + t * uy };
  }

  // Each ray points from the vertex toward the line's farther endpoint — the direction
  // the drawn segment actually extends in.
  const rayAndSpan = (p1: SketchPoint, p2: SketchPoint) => {
    const d1 = Math.hypot(p1.x - vertex.x, p1.y - vertex.y);
    const d2 = Math.hypot(p2.x - vertex.x, p2.y - vertex.y);
    const far = d1 >= d2 ? p1 : p2;
    const length = Math.hypot(far.x - vertex.x, far.y - vertex.y);
    if (length < 1e-9) return null;
    const ray = { x: (far.x - vertex.x) / length, y: (far.y - vertex.y) / length };
    const t1 = (p1.x - vertex.x) * ray.x + (p1.y - vertex.y) * ray.y;
    const t2 = (p2.x - vertex.x) * ray.x + (p2.y - vertex.y) * ray.y;
    return { ray, span: { near: Math.min(t1, t2), far: Math.max(t1, t2) } };
  };
  const resolvedA = rayAndSpan(a1, a2);
  const resolvedB = rayAndSpan(b1, b2);
  if (!resolvedA || !resolvedB) return null;

  let { ray: rayB, span: spanB } = resolvedB;
  // θ between the two rays is in [0, 180]; the stored value is either θ or its supplement
  // (Flip swaps them). The supplement is drawn by flipping ray B's direction.
  const dot = Math.max(-1, Math.min(1, resolvedA.ray.x * rayB.x + resolvedA.ray.y * rayB.y));
  const theta = (Math.acos(dot) * 180) / Math.PI;
  if (Math.abs(dimension.value - (180 - theta)) < Math.abs(dimension.value - theta)) {
    rayB = { x: -rayB.x, y: -rayB.y };
    spanB = { near: -spanB.far, far: -spanB.near };
  }

  const startAngle = Math.atan2(resolvedA.ray.y, resolvedA.ray.x);
  const endRaw = Math.atan2(rayB.y, rayB.x);
  const ccw = ((endRaw - startAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const sweep = ccw <= Math.PI ? ccw : ccw - Math.PI * 2;

  return { vertex, rayA: resolvedA.ray, rayB, startAngle, sweep, spanA: resolvedA.span, spanB };
}

/**
 * Adds a centrepoint arc: a centre and two rim points, plus the two `arc-radius`
 * constraints that keep both rim points on the circle as the sketch is dragged.
 *
 * The two rim points are reused-or-created exactly like any other point, so radius is
 * fixed from the centre-to-start distance at creation time — `end` need not already lie
 * on that circle; the very next solve pulls it there.
 */
export function addArc(
  sketch: Sketch,
  centre: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
  options: { construction?: boolean; tolerance?: number } = {},
): { sketch: Sketch; entityId: string } {
  const tolerance = options.tolerance ?? 0;

  const centrePoint = ensurePoint(sketch, centre.x, centre.y, tolerance);
  const startPoint = ensurePoint(centrePoint.sketch, start.x, start.y, tolerance);
  const endPoint = ensurePoint(startPoint.sketch, end.x, end.y, tolerance);

  const entity: SketchEntity = {
    id: uid("arc"),
    kind: "arc",
    center: centrePoint.pointId,
    start: startPoint.pointId,
    end: endPoint.pointId,
    radius: Math.max(Math.hypot(start.x - centre.x, start.y - centre.y), 1e-3),
    construction: options.construction ?? false,
  };

  const constraints: GeometricConstraint[] = [
    { id: uid("con"), kind: "arc-radius", entities: [entity.id], points: [entity.start] },
    { id: uid("con"), kind: "arc-radius", entities: [entity.id], points: [entity.end] },
  ];

  return {
    sketch: {
      ...endPoint.sketch,
      entities: [...endPoint.sketch.entities, entity],
      constraints: [...endPoint.sketch.constraints, ...constraints],
    },
    entityId: entity.id,
  };
}

/**
 * Rounds the shared corner between two lines into a tangent arc of the given radius,
 * trimming each line back to its tangent point — the sketch-level analogue of the
 * PartDesign Fillet feature, done directly on 2D profile geometry before it's ever
 * extruded.
 *
 * The two lines must already share an endpoint (the ordinary case right after drawing a
 * polyline or rectangle corner) — there's no line-line intersection search here the way
 * `trimLineAt` needs one, since the shared point already pins down exactly where the two
 * lines meet.
 *
 * Deliberately does *not* add a `tangent` relation between the new arc and each line on
 * top of the two `arc-radius` ones below — the geometry is already exactly tangent by
 * construction, and adding it anyway makes the solver's constraint Jacobian rank-deficient
 * at this exact configuration (the tangent residual's gradient is a linear combination of
 * the existing ones here), which the diagnostics correctly read as "redundant" and shows
 * as a false Over Defined status the instant the fillet is created. `residuals.ts`'s own
 * `tangent` case was still extended to accept an arc as well as a circle — a real,
 * independent fix for picking a line + arc and clicking Tangent by hand — this function
 * just doesn't add one of its own. A line dragged later won't pull the arc back into
 * tangency with it; only the arc's own radius/position stays fixed, the same one-shot
 * relationship `mirrorEntities`/`offsetEntities`/`patternEntities` already have.
 *
 * Returns `sketch` unchanged (a no-op the caller can detect via entity count) if the two
 * lines don't share a point, are colinear (no corner to round), or `radius` doesn't fit
 * within both segments.
 */
export function filletCorner(sketch: Sketch, lineIdA: string, lineIdB: string, radius: number): Sketch {
  if (!(radius > 0) || lineIdA === lineIdB) return sketch;

  const lineA = entityById(sketch, lineIdA);
  const lineB = entityById(sketch, lineIdB);
  if (!lineA || !lineB || lineA.kind !== "line" || lineB.kind !== "line") return sketch;

  const endsA: [string, string] = [lineA.start, lineA.end];
  const endsB: [string, string] = [lineB.start, lineB.end];
  const cornerId = endsA.find((id) => endsB.includes(id));
  if (!cornerId) return sketch;

  const otherAId = endsA.find((id) => id !== cornerId);
  const otherBId = endsB.find((id) => id !== cornerId);
  const corner = pointById(sketch, cornerId);
  const otherA = otherAId ? pointById(sketch, otherAId) : undefined;
  const otherB = otherBId ? pointById(sketch, otherBId) : undefined;
  if (!corner || !otherA || !otherB) return sketch;

  const lengthA = Math.hypot(otherA.x - corner.x, otherA.y - corner.y);
  const lengthB = Math.hypot(otherB.x - corner.x, otherB.y - corner.y);
  if (lengthA < 1e-6 || lengthB < 1e-6) return sketch;

  const dirA = { x: (otherA.x - corner.x) / lengthA, y: (otherA.y - corner.y) / lengthA };
  const dirB = { x: (otherB.x - corner.x) / lengthB, y: (otherB.y - corner.y) / lengthB };

  const cosTheta = Math.min(1, Math.max(-1, dirA.x * dirB.x + dirA.y * dirB.y));
  const theta = Math.acos(cosTheta);
  // Nearly straight (no real corner) or the lines double back on each other — either way
  // there's no well-defined fillet.
  if (theta < 1e-3 || theta > Math.PI - 1e-3) return sketch;

  const tangentDistance = radius / Math.tan(theta / 2);
  if (!(tangentDistance < lengthA) || !(tangentDistance < lengthB)) return sketch;

  const bisector = { x: dirA.x + dirB.x, y: dirA.y + dirB.y };
  const bisectorLength = Math.hypot(bisector.x, bisector.y);
  if (bisectorLength < 1e-9) return sketch;

  const centreDistance = radius / Math.sin(theta / 2);
  const centre = {
    x: corner.x + (bisector.x / bisectorLength) * centreDistance,
    y: corner.y + (bisector.y / bisectorLength) * centreDistance,
  };

  const tangentA = { x: corner.x + dirA.x * tangentDistance, y: corner.y + dirA.y * tangentDistance };
  const tangentB = { x: corner.x + dirB.x * tangentDistance, y: corner.y + dirB.y * tangentDistance };

  const tangentAPoint: SketchPoint = { id: uid("pt"), x: tangentA.x, y: tangentA.y };
  const tangentBPoint: SketchPoint = { id: uid("pt"), x: tangentB.x, y: tangentB.y };
  const centrePoint: SketchPoint = { id: uid("pt"), x: centre.x, y: centre.y };

  const updatedLineA: SketchEntity =
    lineA.start === cornerId ? { ...lineA, start: tangentAPoint.id } : { ...lineA, end: tangentAPoint.id };
  const updatedLineB: SketchEntity =
    lineB.start === cornerId ? { ...lineB, start: tangentBPoint.id } : { ...lineB, end: tangentBPoint.id };

  // Sweep direction follows the same "always counter-clockwise from start to end"
  // convention every other arc in the sketch relies on (see `EntityView`'s own comment in
  // `SketchGeometry.tsx`) — start/end are picked by which tangent point actually is
  // counter-clockwise from the other around the new centre, not by which line the caller
  // happened to pass first.
  const startAngle = angleAround(centre, tangentA);
  const endAngleRaw = angleAround(centre, tangentB);
  const sweepsForward = ((endAngleRaw - startAngle + Math.PI * 2) % (Math.PI * 2)) <= Math.PI;
  const [arcStartPoint, arcEndPoint] = sweepsForward
    ? [tangentAPoint, tangentBPoint]
    : [tangentBPoint, tangentAPoint];

  const arc: SketchEntity = {
    id: uid("arc"),
    kind: "arc",
    center: centrePoint.id,
    start: arcStartPoint.id,
    end: arcEndPoint.id,
    radius,
    construction: false,
  };

  const constraints: GeometricConstraint[] = [
    { id: uid("con"), kind: "arc-radius", entities: [arc.id], points: [arc.start] },
    { id: uid("con"), kind: "arc-radius", entities: [arc.id], points: [arc.end] },
  ];

  // The old corner point is dropped unless some third entity still relies on it (e.g. a
  // third line also meeting at that same point) — exactly `dropEntities`'s own rule,
  // applied here by hand since this isn't a removal of lineA/lineB themselves.
  const cornerSurvives = sketch.entities.some(
    (entity) => entity.id !== lineA.id && entity.id !== lineB.id && entityPoints(entity).includes(cornerId),
  );

  return {
    ...sketch,
    points: [
      ...(cornerSurvives ? sketch.points : sketch.points.filter((point) => point.id !== cornerId)),
      tangentAPoint,
      tangentBPoint,
      centrePoint,
    ],
    entities: [
      ...sketch.entities.map((entity) =>
        entity.id === lineA.id ? updatedLineA : entity.id === lineB.id ? updatedLineB : entity,
      ),
      arc,
    ],
    constraints: [
      ...sketch.constraints.filter((constraint) => cornerSurvives || !constraint.points.includes(cornerId)),
      ...constraints,
    ],
  };
}

/**
 * Whether the non-construction geometry forms at least one closed loop.
 *
 * Reported in the sketch panel because a profile must close before it can be extruded.
 */
export function hasClosedProfile(sketch: Sketch): boolean {
  // Lines and arcs both have a start/end and can form a loop's boundary; a circle is
  // already closed on its own and never needs another edge to complete it.
  const edges = sketch.entities.filter(
    (entity): entity is Extract<SketchEntity, { kind: "line" | "arc" }> =>
      (entity.kind === "line" || entity.kind === "arc") && !entity.construction,
  );
  // A lines-only loop needs at least 3 (two straight segments can't enclose an area), but
  // an arc can close a loop on its own with just one more edge — a single line, or even a
  // second arc — so the floor here is 2, not 3, once arcs are in the mix.
  if (edges.length < 2) {
    return sketch.entities.some((entity) => entity.kind === "circle" && !entity.construction);
  }

  // Every endpoint of a closed loop is shared by at least two edges.
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.start, (degree.get(edge.start) ?? 0) + 1);
    degree.set(edge.end, (degree.get(edge.end) ?? 0) + 1);
  }

  const endpoints = [...degree.values()];
  return endpoints.length > 0 && endpoints.every((count) => count >= 2);
}

/* --------------------------------------------------------------------- mirror */

/** Reflects `p` about the infinite line through `a` and `b`. */
function reflectPoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy || 1e-12;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  const projectionX = a.x + t * dx;
  const projectionY = a.y + t * dy;
  return { x: 2 * projectionX - p.x, y: 2 * projectionY - p.y };
}

/**
 * Mirrors the given entities about `axisId` (a construction line), adding a new mirrored
 * copy of each — not linking it back to the original the way SolidWorks's live symmetric
 * constraint would, which needs a new residual kind of its own; a one-shot copy covers the
 * common case (finishing a symmetric profile by hand) without that machinery.
 *
 * Mirroring reverses orientation, so an arc's start and end are swapped on its copy — the
 * sketch's fixed "always sweeps counter-clockwise from start to end" convention would
 * otherwise draw the far side of the circle instead of the true mirror image.
 */
export function mirrorEntities(sketch: Sketch, entityIds: string[], axisId: string): Sketch {
  const axis = entityById(sketch, axisId);
  if (!axis || axis.kind !== "line") return sketch;

  const axisStart = pointById(sketch, axis.start);
  const axisEnd = pointById(sketch, axis.end);
  if (!axisStart || !axisEnd) return sketch;

  let working = sketch;
  const mirroredPoint = (id: string): string => {
    const point = pointById(working, id);
    if (!point) return id;
    const reflected = reflectPoint(axisStart, axisEnd, point);
    const result = ensurePoint(working, reflected.x, reflected.y, 0);
    working = result.sketch;
    return result.pointId;
  };

  for (const id of entityIds) {
    if (id === axisId) continue;
    const entity = entityById(working, id);
    if (!entity) continue;

    switch (entity.kind) {
      case "line": {
        const mirrored: SketchEntity = {
          id: uid("line"),
          kind: "line",
          start: mirroredPoint(entity.start),
          end: mirroredPoint(entity.end),
          construction: entity.construction,
        };
        working = { ...working, entities: [...working.entities, mirrored] };
        break;
      }
      case "circle": {
        const mirrored: SketchEntity = {
          id: uid("circle"),
          kind: "circle",
          center: mirroredPoint(entity.center),
          radius: entity.radius,
          construction: entity.construction,
        };
        working = { ...working, entities: [...working.entities, mirrored] };
        break;
      }
      case "arc": {
        const mirrored: SketchEntity = {
          id: uid("arc"),
          kind: "arc",
          center: mirroredPoint(entity.center),
          // Swapped: see the note above on orientation.
          start: mirroredPoint(entity.end),
          end: mirroredPoint(entity.start),
          radius: entity.radius,
          construction: entity.construction,
        };
        const constraints: GeometricConstraint[] = [
          { id: uid("con"), kind: "arc-radius", entities: [mirrored.id], points: [mirrored.start] },
          { id: uid("con"), kind: "arc-radius", entities: [mirrored.id], points: [mirrored.end] },
        ];
        working = {
          ...working,
          entities: [...working.entities, mirrored],
          constraints: [...working.constraints, ...constraints],
        };
        break;
      }
      case "spline": {
        const mirrored: SketchEntity = {
          id: uid("spline"),
          kind: "spline",
          points: entity.points.map(mirroredPoint),
          construction: entity.construction,
        };
        working = { ...working, entities: [...working.entities, mirrored] };
        break;
      }
      case "point": {
        const mirrored: SketchEntity = {
          id: uid("point"),
          kind: "point",
          at: mirroredPoint(entity.at),
          construction: entity.construction,
        };
        working = { ...working, entities: [...working.entities, mirrored] };
        break;
      }
    }
  }

  return working;
}

/* --------------------------------------------------------------------- offset */

/**
 * Offsets the given entities by `distance` (perpendicular to a line, radial for a circle
 * or arc), adding a new copy of each — a one-shot copy like `mirrorEntities`, not a live
 * parametric link back to the source. A negative distance flips which side a line offsets
 * to and shrinks rather than grows a circle or arc.
 *
 * Splines and standalone points have no single well-defined offset direction and are
 * silently skipped, the same way `hasClosedProfile`/`extractLoops` silently skip entity
 * kinds that don't apply to what they're computing.
 */
export function offsetEntities(sketch: Sketch, entityIds: string[], distance: number): Sketch {
  let working = sketch;

  for (const id of entityIds) {
    const entity = entityById(working, id);
    if (!entity) continue;

    if (entity.kind === "line") {
      const start = pointById(working, entity.start);
      const end = pointById(working, entity.end);
      if (!start || !end) continue;

      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy) || 1e-9;
      // The direction rotated 90° counter-clockwise: a positive distance offsets to the
      // left of the line's own start->end direction, negative to the right.
      const nx = (-dy / length) * distance;
      const ny = (dx / length) * distance;

      const newStart = ensurePoint(working, start.x + nx, start.y + ny, 0);
      const newEnd = ensurePoint(newStart.sketch, end.x + nx, end.y + ny, 0);

      const offset: SketchEntity = {
        id: uid("line"),
        kind: "line",
        start: newStart.pointId,
        end: newEnd.pointId,
        construction: entity.construction,
      };
      working = { ...newEnd.sketch, entities: [...newEnd.sketch.entities, offset] };
    } else if (entity.kind === "circle") {
      const offset: SketchEntity = {
        id: uid("circle"),
        kind: "circle",
        center: entity.center,
        radius: Math.max(entity.radius + distance, 1e-3),
        construction: entity.construction,
      };
      working = { ...working, entities: [...working.entities, offset] };
    } else if (entity.kind === "arc") {
      const centre = pointById(working, entity.center);
      const start = pointById(working, entity.start);
      const end = pointById(working, entity.end);
      if (!centre || !start || !end) continue;

      const newRadius = Math.max(entity.radius + distance, 1e-3);
      const angleOf = (p: { x: number; y: number }) => Math.atan2(p.y - centre.y, p.x - centre.x);
      const startAngle = angleOf(start);
      const endAngle = angleOf(end);

      const newStart = ensurePoint(
        working,
        centre.x + newRadius * Math.cos(startAngle),
        centre.y + newRadius * Math.sin(startAngle),
        0,
      );
      const newEnd = ensurePoint(
        newStart.sketch,
        centre.x + newRadius * Math.cos(endAngle),
        centre.y + newRadius * Math.sin(endAngle),
        0,
      );

      const offset: SketchEntity = {
        id: uid("arc"),
        kind: "arc",
        center: entity.center,
        start: newStart.pointId,
        end: newEnd.pointId,
        radius: newRadius,
        construction: entity.construction,
      };
      const constraints: GeometricConstraint[] = [
        { id: uid("con"), kind: "arc-radius", entities: [offset.id], points: [offset.start] },
        { id: uid("con"), kind: "arc-radius", entities: [offset.id], points: [offset.end] },
      ];
      working = {
        ...newEnd.sketch,
        entities: [...newEnd.sketch.entities, offset],
        constraints: [...newEnd.sketch.constraints, ...constraints],
      };
    }
  }

  return working;
}

/* -------------------------------------------------------------------- pattern */

export type PatternOptions =
  | { mode: "linear"; count: number; dx: number; dy: number }
  | { mode: "circular"; count: number; angleDegrees: number };

/**
 * Repeats the given entities in a linear or circular array, adding `count - 1` further
 * copies — `count` includes the original, the same convention `buildLinearPatternSolid`/
 * `buildCircularPatternSolid` in `kernel/rebuild.ts` already use for the feature-level
 * pattern. Copies are one-shot, not live, for the same reason `mirrorEntities`/
 * `offsetEntities` don't track their source: editing the original afterward does not move
 * them. A true parametric pattern relation is a larger feature nothing here forecloses
 * adding later.
 *
 * A circular pattern has no picked centre yet — the app has no reference-point picking UI,
 * the same gap `FeatureParameters.axis`'s doc comment notes for the feature-level pattern —
 * so it always rotates about the sketch origin.
 *
 * Unlike a mirror, a rotation or translation preserves orientation, so an arc's start/end
 * are copied in place rather than swapped.
 */
export function patternEntities(sketch: Sketch, entityIds: string[], options: PatternOptions): Sketch {
  const instances = Math.max(1, Math.round(options.count));
  if (instances < 2) return sketch;

  let working = sketch;

  const transform = (p: { x: number; y: number }, index: number): { x: number; y: number } => {
    if (options.mode === "linear") {
      return { x: p.x + options.dx * index, y: p.y + options.dy * index };
    }
    const stepRad = ((options.angleDegrees / instances) * index * Math.PI) / 180;
    const cos = Math.cos(stepRad);
    const sin = Math.sin(stepRad);
    return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
  };

  for (let index = 1; index < instances; index += 1) {
    const copiedPoint = (id: string): string => {
      const point = pointById(working, id);
      if (!point) return id;
      const moved = transform(point, index);
      const result = ensurePoint(working, moved.x, moved.y, 0);
      working = result.sketch;
      return result.pointId;
    };

    for (const id of entityIds) {
      const entity = entityById(working, id);
      if (!entity) continue;

      switch (entity.kind) {
        case "line": {
          const copy: SketchEntity = {
            id: uid("line"),
            kind: "line",
            start: copiedPoint(entity.start),
            end: copiedPoint(entity.end),
            construction: entity.construction,
          };
          working = { ...working, entities: [...working.entities, copy] };
          break;
        }
        case "circle": {
          const copy: SketchEntity = {
            id: uid("circle"),
            kind: "circle",
            center: copiedPoint(entity.center),
            radius: entity.radius,
            construction: entity.construction,
          };
          working = { ...working, entities: [...working.entities, copy] };
          break;
        }
        case "arc": {
          const copy: SketchEntity = {
            id: uid("arc"),
            kind: "arc",
            center: copiedPoint(entity.center),
            start: copiedPoint(entity.start),
            end: copiedPoint(entity.end),
            radius: entity.radius,
            construction: entity.construction,
          };
          const constraints: GeometricConstraint[] = [
            { id: uid("con"), kind: "arc-radius", entities: [copy.id], points: [copy.start] },
            { id: uid("con"), kind: "arc-radius", entities: [copy.id], points: [copy.end] },
          ];
          working = {
            ...working,
            entities: [...working.entities, copy],
            constraints: [...working.constraints, ...constraints],
          };
          break;
        }
        case "spline": {
          const copy: SketchEntity = {
            id: uid("spline"),
            kind: "spline",
            points: entity.points.map(copiedPoint),
            construction: entity.construction,
          };
          working = { ...working, entities: [...working.entities, copy] };
          break;
        }
        case "point": {
          const copy: SketchEntity = {
            id: uid("point"),
            kind: "point",
            at: copiedPoint(entity.at),
            construction: entity.construction,
          };
          working = { ...working, entities: [...working.entities, copy] };
          break;
        }
      }
    }
  }

  return working;
}

/* ------------------------------------------------------------------------ trim */

/** Whether `(x, y)` falls within an arc's counter-clockwise sweep from start to end. */
function isWithinArcSweep(
  sketch: Sketch,
  arc: Extract<SketchEntity, { kind: "arc" }>,
  x: number,
  y: number,
): boolean {
  const centre = pointById(sketch, arc.center);
  const start = pointById(sketch, arc.start);
  const end = pointById(sketch, arc.end);
  if (!centre || !start || !end) return false;

  const startAngle = Math.atan2(start.y - centre.y, start.x - centre.x);
  let endAngle = Math.atan2(end.y - centre.y, end.x - centre.x);
  if (endAngle <= startAngle) endAngle += Math.PI * 2;

  let angle = Math.atan2(y - centre.y, x - centre.x);
  if (angle < startAngle) angle += Math.PI * 2;
  return angle >= startAngle - 1e-6 && angle <= endAngle + 1e-6;
}

/**
 * Parameters `t` (in `[0, 1]`) where the segment from `start` to `end` crosses `other`,
 * used by `trimLineAt` to find the boundaries a trim can cut back to. Only intersections
 * that land within `other`'s own extent count — a circle's full boundary, or an arc's
 * swept range — the same as any CAD trim tool only cutting back to geometry that's
 * actually there, not an entity's infinite extension.
 */
function lineIntersectionParams(
  start: { x: number; y: number },
  end: { x: number; y: number },
  other: SketchEntity,
  sketch: Sketch,
): number[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (other.kind === "line") {
    const os = pointById(sketch, other.start);
    const oe = pointById(sketch, other.end);
    if (!os || !oe) return [];
    const odx = oe.x - os.x;
    const ody = oe.y - os.y;
    const denom = dx * ody - dy * odx;
    if (Math.abs(denom) < 1e-9) return [];
    const t = ((os.x - start.x) * ody - (os.y - start.y) * odx) / denom;
    const u = ((os.x - start.x) * dy - (os.y - start.y) * dx) / denom;
    if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return [];
    return [Math.min(Math.max(t, 0), 1)];
  }

  if (other.kind === "circle" || other.kind === "arc") {
    const centre = pointById(sketch, other.center);
    if (!centre) return [];

    // |start + t*d - centre|^2 = radius^2, solved for t.
    const fx = start.x - centre.x;
    const fy = start.y - centre.y;
    const a = dx * dx + dy * dy;
    if (a < 1e-12) return [];
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - other.radius * other.radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return [];

    const sqrtDisc = Math.sqrt(discriminant);
    const results: number[] = [];
    for (const t of [(-b - sqrtDisc) / (2 * a), (-b + sqrtDisc) / (2 * a)]) {
      if (t < -1e-6 || t > 1 + 1e-6) continue;
      const clamped = Math.min(Math.max(t, 0), 1);
      if (other.kind === "circle") {
        results.push(clamped);
        continue;
      }
      const px = start.x + clamped * dx;
      const py = start.y + clamped * dy;
      if (isWithinArcSweep(sketch, other, px, py)) results.push(clamped);
    }
    return results;
  }

  return [];
}

/**
 * How close two *independently computed* split-point coordinates have to be to count as
 * the same corner — trimming line A back to its crossing with line B computes that
 * crossing point once; trimming line B back to the same visual corner (a separate call,
 * possibly much later) recomputes it again from B's own intersection maths. The two
 * results agree to within floating-point noise, not bit-for-bit, so `ensurePoint`'s own
 * spatial search needs a tolerance — tight enough that it only ever merges truly-the-same
 * corner (never a user's own two separate, deliberately close points), but well above
 * double-precision noise. This is what makes two lines trimmed back to a shared corner,
 * in either order, end up sharing one literal point (and therefore staying pinned
 * together automatically) instead of leaving two coincident-looking but unconnected ones.
 */
const TRIM_SPLIT_POINT_TOLERANCE = 1e-4;

/**
 * Trims a line back to its nearest intersections: `(x, y)` (the click position, in sketch
 * space) picks which stretch of the line to remove, and every other entity that actually
 * crosses this line contributes a cut point. A line with no crossings has nowhere to trim
 * back to, so a click anywhere on it removes the whole entity — the same as trimming an
 * overshooting stray segment down to nothing in any CAD sketcher.
 *
 * Arcs and standalone points are not trimmable themselves yet — only lines, circles
 * (`trimCircleAt`) and splines (`trimSplineAt`) are, though an arc can still be trimmed
 * *back to* by any of those, same as a line always could. `trimEntityAt` below is the
 * shared dispatcher every caller should use instead of this function directly.
 */
export function trimLineAt(sketch: Sketch, entityId: string, x: number, y: number): Sketch {
  const entity = entityById(sketch, entityId);
  if (!entity || entity.kind !== "line") return sketch;

  const start = pointById(sketch, entity.start);
  const end = pointById(sketch, entity.end);
  if (!start || !end) return sketch;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy || 1e-12;

  // Which other entity produced each cut, so a newly-created interior split point can be
  // pinned back onto whatever crossed the line there (task: trim should add a coincident-
  // style relation at a split point, not just leave a bare unconstrained point behind).
  const cutSet = new Set<number>([0, 1]);
  const cutSource = new Map<number, SketchEntity>();
  for (const other of sketch.entities) {
    if (other.id === entityId) continue;
    for (const t of lineIntersectionParams(start, end, other, sketch)) {
      cutSet.add(t);
      if (!cutSource.has(t)) cutSource.set(t, other);
    }
  }
  const cuts = [...cutSet].sort((a, b) => a - b);

  const clickT = Math.min(1, Math.max(0, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared));

  let clickedIndex = -1;
  for (let i = 0; i < cuts.length - 1; i += 1) {
    if (clickT >= cuts[i] - 1e-6 && clickT <= cuts[i + 1] + 1e-6) {
      clickedIndex = i;
      break;
    }
  }
  if (clickedIndex === -1) return sketch;

  let working = sketch;
  // Split points pinned back onto whatever crossing entity created them, applied once the
  // survivors (and thus the final point set) are known.
  const splitPins: { pointId: string; source: SketchEntity }[] = [];
  const pointAt = (t: number): string => {
    if (t <= 1e-9) return entity.start;
    if (t >= 1 - 1e-9) return entity.end;
    const result = ensurePoint(working, start.x + t * dx, start.y + t * dy, TRIM_SPLIT_POINT_TOLERANCE);
    working = result.sketch;
    const source = cutSource.get(t);
    if (source) splitPins.push({ pointId: result.pointId, source });
    return result.pointId;
  };

  const survivors: SketchEntity[] = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    if (i === clickedIndex || cuts[i + 1] - cuts[i] < 1e-6) continue;
    survivors.push({
      id: uid("line"),
      kind: "line",
      start: pointAt(cuts[i]),
      end: pointAt(cuts[i + 1]),
      construction: entity.construction,
    });
  }

  // Horizontal/vertical are the line's own single-entity relations — trimming into several
  // segments should not silently drop the fact that the original line was, say, horizontal;
  // every surviving segment inherits it, the same as SolidWorks/Inventor keep a trimmed
  // line's own orientation constraints on each remaining piece.
  const carriedKinds = sketch.constraints
    .filter(
      (constraint) =>
        (constraint.kind === "horizontal" || constraint.kind === "vertical") &&
        constraint.entities.length === 1 &&
        constraint.entities[0] === entityId,
    )
    .map((constraint) => constraint.kind);

  const removed = new Set([entityId]);
  const entities = [...working.entities.filter((candidate) => !removed.has(candidate.id)), ...survivors];
  const survivingPoints = new Set(entities.flatMap(entityPoints));
  survivingPoints.add(originPointId(working.id));

  let result: Sketch = {
    ...working,
    entities,
    points: working.points.filter((point) => survivingPoints.has(point.id)),
    constraints: working.constraints.filter(
      (constraint) =>
        !constraint.entities.some((id) => removed.has(id)) &&
        constraint.points.every((id) => survivingPoints.has(id)),
    ),
    dimensions: working.dimensions.filter(
      (dimension) =>
        !dimension.entities.some((id) => removed.has(id)) &&
        dimension.points.every((id) => survivingPoints.has(id)),
    ),
  };

  for (const survivor of survivors) {
    for (const kind of carriedKinds) result = addConstraint(result, kind, [survivor.id], []);
  }
  for (const pin of splitPins) {
    if (!survivingPoints.has(pin.pointId)) continue;
    // `TRIM_SPLIT_POINT_TOLERANCE` can land this pin's own point exactly on the source
    // entity's *own* endpoint (both lines trimmed back to one shared corner now share one
    // literal point) — pinning a point-on-line/-circle onto an entity it's already a
    // defining point of is a trivially-satisfied, redundant equation that only pads the
    // solver's row count without removing a real degree of freedom, which is what was
    // showing up as a spurious "Over Defined" after trimming two lines to a shared corner.
    const currentSource = entityById(result, pin.source.id);
    if (currentSource && entityPoints(currentSource).includes(pin.pointId)) continue;
    const kind = curveConstraintKind(pin.source);
    if (kind) result = addConstraint(result, kind, [pin.source.id], [pin.pointId]);
  }

  return result;
}

/** Drops `removed` entities and every point/constraint/dimension left orphaned by that —
 * the trailing cleanup step every trim/window-select operation below ends on. */
function dropEntities(sketch: Sketch, removed: Set<string>, extraEntities: SketchEntity[] = []): Sketch {
  const entities = [...sketch.entities.filter((candidate) => !removed.has(candidate.id)), ...extraEntities];
  const survivingPoints = new Set(entities.flatMap(entityPoints));
  survivingPoints.add(originPointId(sketch.id));

  return {
    ...sketch,
    entities,
    points: sketch.points.filter((point) => survivingPoints.has(point.id)),
    constraints: sketch.constraints.filter(
      (constraint) =>
        !constraint.entities.some((id) => removed.has(id)) &&
        constraint.points.every((id) => survivingPoints.has(id)),
    ),
    dimensions: sketch.dimensions.filter(
      (dimension) =>
        !dimension.entities.some((id) => removed.has(id)) &&
        dimension.points.every((id) => survivingPoints.has(id)),
    ),
  };
}

/** Angle (radians, unwrapped to `[0, 2π)`) of `point` around `centre`. */
function angleAround(centre: { x: number; y: number }, point: { x: number; y: number }): number {
  const angle = Math.atan2(point.y - centre.y, point.x - centre.x);
  return angle < 0 ? angle + Math.PI * 2 : angle;
}

/**
 * Angles (around `circle`'s own centre) where `other` crosses it — the circle-trim
 * counterpart of `lineIntersectionParams`, which instead returns a parameter along a moving
 * line. A crossing line or spline segment is resolved via that same function (run with the
 * *other* entity's own segment as the moving line and this circle as the fixed shape, then
 * converted from a line parameter to an angle); a second circle or an arc's underlying
 * circle needs the dedicated circle-circle intersection formula below instead.
 */
function circleCrossingAngles(
  sketch: Sketch,
  circle: Extract<SketchEntity, { kind: "circle" }>,
  centre: { x: number; y: number },
  other: SketchEntity,
): number[] {
  if (other.kind === "line") {
    const os = pointById(sketch, other.start);
    const oe = pointById(sketch, other.end);
    if (!os || !oe) return [];
    return lineIntersectionParams(os, oe, circle, sketch).map((t) =>
      angleAround(centre, { x: os.x + t * (oe.x - os.x), y: os.y + t * (oe.y - os.y) }),
    );
  }

  if (other.kind === "spline") {
    const angles: number[] = [];
    for (let i = 0; i < other.points.length - 1; i += 1) {
      const os = pointById(sketch, other.points[i]);
      const oe = pointById(sketch, other.points[i + 1]);
      if (!os || !oe) continue;
      for (const t of lineIntersectionParams(os, oe, circle, sketch)) {
        angles.push(angleAround(centre, { x: os.x + t * (oe.x - os.x), y: os.y + t * (oe.y - os.y) }));
      }
    }
    return angles;
  }

  if (other.kind === "circle" || other.kind === "arc") {
    const otherCentre = pointById(sketch, other.center);
    if (!otherCentre) return [];
    const dx = otherCentre.x - centre.x;
    const dy = otherCentre.y - centre.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-9 || d > circle.radius + other.radius + 1e-6 || d < Math.abs(circle.radius - other.radius) - 1e-6) {
      return [];
    }
    // Standard circle-circle intersection: `a` is the distance from this circle's centre
    // to the radical line the two circles cross on, `h` the half-chord length along it.
    const a = (circle.radius * circle.radius - other.radius * other.radius + d * d) / (2 * d);
    const hSquared = circle.radius * circle.radius - a * a;
    if (hSquared < 0) return [];
    const h = Math.sqrt(Math.max(hSquared, 0));
    const midX = centre.x + (a * dx) / d;
    const midY = centre.y + (a * dy) / d;
    const perpX = (-dy / d) * h;
    const perpY = (dx / d) * h;
    return [
      { x: midX + perpX, y: midY + perpY },
      { x: midX - perpX, y: midY - perpY },
    ]
      .filter((point) => other.kind === "circle" || isWithinArcSweep(sketch, other, point.x, point.y))
      .map((point) => angleAround(centre, point));
  }

  return [];
}

/**
 * Trims a circle back to its nearest crossings — the closed-loop counterpart of
 * `trimLineAt`. A circle is a loop rather than an open run, so N crossing points split it
 * into N arcs (not N-1, the way N interior cuts split a line into N-1 stretches); removing
 * the one the click landed in leaves N-1 arcs behind. Fewer than two distinct crossings
 * means there's nothing to bound a trim to, so the whole circle is removed instead — the
 * same fallback `trimLineAt` uses for a line with no crossings at all.
 */
export function trimCircleAt(sketch: Sketch, entityId: string, x: number, y: number): Sketch {
  const entity = entityById(sketch, entityId);
  if (!entity || entity.kind !== "circle") return sketch;

  const centre = pointById(sketch, entity.center);
  if (!centre) return sketch;

  const angleSet = new Set<number>();
  const angleSource = new Map<number, SketchEntity>();
  for (const other of sketch.entities) {
    if (other.id === entityId) continue;
    for (const angle of circleCrossingAngles(sketch, entity, centre, other)) {
      const rounded = Math.round(angle * 1e6) / 1e6;
      angleSet.add(rounded);
      if (!angleSource.has(rounded)) angleSource.set(rounded, other);
    }
  }
  const cuts = [...angleSet].sort((a, b) => a - b);
  // Fewer than two distinct crossings means there's nothing to bound a trim to, so the
  // whole circle goes — same fallback `trimLineAt` uses for a line with no crossings.
  if (cuts.length < 2) return dropEntities(sketch, new Set([entityId]));

  const clickAngle = angleAround(centre, { x, y });
  const segmentAt = (index: number): { from: number; to: number } => ({
    from: cuts[index],
    to: index + 1 < cuts.length ? cuts[index + 1] : cuts[0] + Math.PI * 2,
  });

  let clickedIndex = -1;
  for (let i = 0; i < cuts.length; i += 1) {
    const { from, to } = segmentAt(i);
    const angle = clickAngle >= from ? clickAngle : clickAngle + Math.PI * 2;
    if (angle >= from - 1e-6 && angle <= to + 1e-6) {
      clickedIndex = i;
      break;
    }
  }
  if (clickedIndex === -1) return sketch;

  let working = sketch;
  const splitPins: { pointId: string; source: SketchEntity }[] = [];
  const pointAtAngle = (angle: number): string => {
    const result = ensurePoint(
      working,
      centre.x + Math.cos(angle) * entity.radius,
      centre.y + Math.sin(angle) * entity.radius,
      TRIM_SPLIT_POINT_TOLERANCE,
    );
    working = result.sketch;
    const source = angleSource.get(angle);
    if (source) splitPins.push({ pointId: result.pointId, source });
    return result.pointId;
  };

  const survivors: SketchEntity[] = [];
  for (let i = 0; i < cuts.length; i += 1) {
    if (i === clickedIndex) continue;
    const { from, to } = segmentAt(i);
    if (to - from < 1e-6) continue;
    survivors.push({
      id: uid("arc"),
      kind: "arc",
      center: entity.center,
      start: pointAtAngle(from),
      end: pointAtAngle(to),
      radius: entity.radius,
      construction: entity.construction,
    });
  }

  return withSplitPins(dropEntities(working, new Set([entityId]), survivors), splitPins);
}

/**
 * Trims a spline back to its nearest crossings — the same "click a stretch to remove it,
 * keep the rest" idea as `trimLineAt`, generalised from one segment to the spline's whole
 * point-to-point chain. Crossings are found per-segment (each stretch between two
 * consecutive spline points is itself straight for intersection purposes, the same as a
 * line) and expressed as one continuous parameter along the chain — segment index plus the
 * local `t` within it, so `1.5` means "halfway through the second segment" — the spline's
 * equivalent of a line's `[0, 1]`, spanning `[0, segmentCount]` instead. A surviving
 * stretch keeps every original interior point that falls inside it, not just its two new
 * endpoints, so the kept curve is still the shape actually drawn, not a straight-line
 * stand-in for it.
 */
export function trimSplineAt(sketch: Sketch, entityId: string, x: number, y: number): Sketch {
  const entity = entityById(sketch, entityId);
  if (!entity || entity.kind !== "spline" || entity.points.length < 2) return sketch;

  const vertices = entity.points.map((id) => pointById(sketch, id));
  if (vertices.some((point) => !point)) return sketch;
  const points = vertices as SketchPoint[];
  const segmentCount = points.length - 1;

  const cutSet = new Set<number>([0, segmentCount]);
  const cutSource = new Map<number, SketchEntity>();
  for (const other of sketch.entities) {
    if (other.id === entityId) continue;
    for (let i = 0; i < segmentCount; i += 1) {
      for (const t of lineIntersectionParams(points[i], points[i + 1], other, sketch)) {
        cutSet.add(i + t);
        if (!cutSource.has(i + t)) cutSource.set(i + t, other);
      }
    }
  }
  const cuts = [...cutSet].sort((a, b) => a - b);

  // Nearest point on the chain to the click, expressed as that same segment+t parameter.
  let clickParam = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < segmentCount; i += 1) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const lengthSquared = dx * dx + dy * dy || 1e-12;
    const t = Math.min(1, Math.max(0, ((x - points[i].x) * dx + (y - points[i].y) * dy) / lengthSquared));
    const distance = Math.hypot(points[i].x + t * dx - x, points[i].y + t * dy - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      clickParam = i + t;
    }
  }

  let clickedIndex = -1;
  for (let i = 0; i < cuts.length - 1; i += 1) {
    if (clickParam >= cuts[i] - 1e-6 && clickParam <= cuts[i + 1] + 1e-6) {
      clickedIndex = i;
      break;
    }
  }
  if (clickedIndex === -1) return sketch;

  let working = sketch;
  const splitPins: { pointId: string; source: SketchEntity }[] = [];
  const pointAtParam = (param: number): string => {
    const rounded = Math.round(param);
    if (Math.abs(param - rounded) < 1e-9 && rounded >= 0 && rounded <= segmentCount) {
      return entity.points[rounded];
    }
    const i = Math.max(0, Math.min(segmentCount - 1, Math.floor(param)));
    const t = param - i;
    const result = ensurePoint(
      working,
      points[i].x + t * (points[i + 1].x - points[i].x),
      points[i].y + t * (points[i + 1].y - points[i].y),
      TRIM_SPLIT_POINT_TOLERANCE,
    );
    working = result.sketch;
    const source = cutSource.get(param);
    if (source) splitPins.push({ pointId: result.pointId, source });
    return result.pointId;
  };

  const survivors: SketchEntity[] = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    if (i === clickedIndex || cuts[i + 1] - cuts[i] < 1e-6) continue;

    const from = cuts[i];
    const to = cuts[i + 1];
    const chainPoints = [pointAtParam(from)];
    for (let k = Math.ceil(from); k < to; k += 1) {
      if (k > from + 1e-9) chainPoints.push(entity.points[k]);
    }
    chainPoints.push(pointAtParam(to));

    if (chainPoints.length >= 2) {
      survivors.push({ id: uid("spline"), kind: "spline", points: chainPoints, construction: entity.construction });
    }
  }

  return withSplitPins(dropEntities(working, new Set([entityId]), survivors), splitPins);
}

/** Pins each surviving split point back onto the entity that produced it — shared tail for
 * `trimCircleAt`/`trimSplineAt` (`trimLineAt` inlines the same idea since it also needs to
 * carry the trimmed line's own horizontal/vertical constraints in the same pass). A point
 * that didn't survive the trim (e.g. it fell inside the removed stretch) is silently
 * skipped rather than erroring — `addConstraint` would just as happily add a constraint on
 * a since-deleted point id, which is worse than not adding one. */
function withSplitPins(sketch: Sketch, splitPins: { pointId: string; source: SketchEntity }[]): Sketch {
  const survivingPointIds = new Set(sketch.points.map((point) => point.id));
  let result = sketch;
  for (const pin of splitPins) {
    if (!survivingPointIds.has(pin.pointId)) continue;
    // See the matching comment in `trimLineAt` — skips a redundant, trivially-satisfied
    // constraint when `TRIM_SPLIT_POINT_TOLERANCE` merged this pin's point onto the exact
    // entity it would otherwise be pinned to.
    const currentSource = entityById(result, pin.source.id);
    if (currentSource && entityPoints(currentSource).includes(pin.pointId)) continue;
    const kind = curveConstraintKind(pin.source);
    if (kind) result = addConstraint(result, kind, [pin.source.id], [pin.pointId]);
  }
  return result;
}

/** Dispatches a trim click to the right kind-specific trim function — the single entry
 * point `sketchStore.ts`'s `trimAt` calls, so the sketch canvas doesn't need to know which
 * entity kinds are trimmable. Points aren't trimmable (nothing to cut them back to). */
export function trimEntityAt(sketch: Sketch, entityId: string, x: number, y: number): Sketch {
  const entity = entityById(sketch, entityId);
  if (!entity) return sketch;
  switch (entity.kind) {
    case "line":
      return trimLineAt(sketch, entityId, x, y);
    case "circle":
      return trimCircleAt(sketch, entityId, x, y);
    case "spline":
      return trimSplineAt(sketch, entityId, x, y);
    default:
      return sketch;
  }
}

/**
 * Whether `entity` fits entirely inside an axis-aligned window — a conservative bounding
 * check (a circle/arc's full circle, not just its swept portion, has to fit) rather than an
 * exact one, so a curve is never removed for merely *looking* like it fits when its true
 * extent pokes outside the window.
 */
function entityWithinWindow(
  sketch: Sketch,
  entity: SketchEntity,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  if (entity.kind === "point") return false;

  if (entity.kind === "circle" || entity.kind === "arc") {
    const centre = pointById(sketch, entity.center);
    if (!centre) return false;
    return (
      centre.x - entity.radius >= minX &&
      centre.x + entity.radius <= maxX &&
      centre.y - entity.radius >= minY &&
      centre.y + entity.radius <= maxY
    );
  }

  const ids = entity.kind === "line" ? [entity.start, entity.end] : entity.points;
  const points = ids.map((id) => pointById(sketch, id)).filter((point): point is SketchPoint => !!point);
  return points.length > 0 && points.every((point) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY);
}

/**
 * Where a line crosses an axis-aligned window's boundary, as parameters along the line
 * (0 = start, 1 = end) — Liang-Barsky segment-vs-box clipping, testing the line's
 * direction against each of the box's four half-plane edges in turn and narrowing
 * `[tEnter, tExit]` to whatever's left inside all four. Returns the portion of the line's
 * own `[0, 1]` range that lies *inside* the window (what a crossing trim removes); `null`
 * means the line never enters the window at all, so a crossing trim leaves it untouched.
 */
function lineWindowOverlap(
  start: { x: number; y: number },
  end: { x: number; y: number },
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): [number, number] | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let tEnter = 0;
  let tExit = 1;

  const edges: [number, number][] = [
    [-dx, start.x - minX],
    [dx, maxX - start.x],
    [-dy, start.y - minY],
    [dy, maxY - start.y],
  ];

  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > tExit) return null;
      if (r > tEnter) tEnter = r;
    } else {
      if (r < tEnter) return null;
      if (r < tExit) tExit = r;
    }
  }

  return tEnter <= tExit ? [tEnter, tExit] : null;
}

/**
 * Trims every entity a dragged selection window touches in one go — item 6's "hold and
 * drag a window to trim several entities at once". An entity fully enclosed by the window
 * is removed outright, same as always; a *line* the window only crosses now has the
 * portion actually inside the window cropped away, leaving whatever stretch(es) poked out
 * the other side (0, 1 or 2 of them) as new surviving segments — the "crop it exactly at
 * the window's edge" refinement the single-entity-window case used to defer. Circles, arcs
 * and splines the window merely crosses are still left untouched; clipping a curve against
 * a rectangle is a further refinement beyond what this covers.
 */
export function trimEntitiesInWindow(
  sketch: Sketch,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Sketch {
  let working = sketch;
  const removed = new Set<string>();
  const extraEntities: SketchEntity[] = [];
  const carriedKindsBySurvivor = new Map<string, GeometricConstraintKind[]>();

  for (const entity of sketch.entities) {
    if (entityWithinWindow(sketch, entity, minX, minY, maxX, maxY)) {
      removed.add(entity.id);
      continue;
    }
    if (entity.kind !== "line") continue;

    const start = pointById(working, entity.start);
    const end = pointById(working, entity.end);
    if (!start || !end) continue;
    const overlap = lineWindowOverlap(start, end, minX, minY, maxX, maxY);
    if (!overlap) continue;
    const [tEnter, tExit] = overlap;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const pointAt = (t: number): string => {
      if (t <= 1e-9) return entity.start;
      if (t >= 1 - 1e-9) return entity.end;
      const result = ensurePoint(working, start.x + t * dx, start.y + t * dy, TRIM_SPLIT_POINT_TOLERANCE);
      working = result.sketch;
      return result.pointId;
    };

    const carriedKinds = working.constraints
      .filter(
        (constraint) =>
          (constraint.kind === "horizontal" || constraint.kind === "vertical") &&
          constraint.entities.length === 1 &&
          constraint.entities[0] === entity.id,
      )
      .map((constraint) => constraint.kind);

    const segments: [number, number][] = [];
    if (tEnter > 1e-6) segments.push([0, tEnter]);
    if (tExit < 1 - 1e-6) segments.push([tExit, 1]);

    removed.add(entity.id);
    for (const [a, b] of segments) {
      const survivorId = uid("line");
      extraEntities.push({ id: survivorId, kind: "line", start: pointAt(a), end: pointAt(b), construction: entity.construction });
      carriedKindsBySurvivor.set(survivorId, carriedKinds);
    }
  }

  if (removed.size === 0 && extraEntities.length === 0) return sketch;

  let result = dropEntities(working, removed, extraEntities);
  for (const [survivorId, kinds] of carriedKindsBySurvivor) {
    for (const kind of kinds) result = addConstraint(result, kind, [survivorId], []);
  }
  return result;
}
