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
  options: { construction?: boolean; tolerance?: number } = {},
): { sketch: Sketch; entityId: string; startId: string; endId: string } {
  const tolerance = options.tolerance ?? 0;

  const start = ensurePoint(sketch, from.x, from.y, tolerance);
  const end = ensurePoint(start.sketch, to.x, to.y, tolerance);

  const entity: SketchEntity = {
    id: uid("line"),
    kind: "line",
    start: start.pointId,
    end: end.pointId,
    construction: options.construction ?? false,
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

export function addConstraint(
  sketch: Sketch,
  kind: GeometricConstraintKind,
  entities: string[],
  points: string[],
): Sketch {
  return {
    ...sketch,
    constraints: [...sketch.constraints, { id: uid("con"), kind, entities, points }],
  };
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
      const angle = Math.atan2(Math.abs(u.x * v.y - u.y * v.x), u.x * v.x + u.y * v.y);
      return (angle * 180) / Math.PI;
    }
    default:
      return 0;
  }
}

/**
 * Chooses the dimension a Smart Dimension click should create from what is selected,
 * mirroring how SolidWorks infers intent rather than asking.
 */
export function inferSmartDimension(
  sketch: Sketch,
  selectedEntities: string[],
  selectedPoints: string[],
): { kind: DimensionKind; points: string[]; entities: string[] } | null {
  if (selectedPoints.length === 2) {
    return { kind: "distance", points: selectedPoints, entities: [] };
  }

  if (selectedEntities.length === 1) {
    const entity = entityById(sketch, selectedEntities[0]);
    if (entity?.kind === "circle" || entity?.kind === "arc") {
      return { kind: "radius", points: [], entities: [entity.id] };
    }
    if (entity?.kind === "line") {
      return { kind: "distance", points: [entity.start, entity.end], entities: [] };
    }
  }

  if (selectedEntities.length === 2) {
    const first = entityById(sketch, selectedEntities[0]);
    const second = entityById(sketch, selectedEntities[1]);
    if (first?.kind === "line" && second?.kind === "line") {
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
 * Trims a line back to its nearest intersections: `(x, y)` (the click position, in sketch
 * space) picks which stretch of the line to remove, and every other entity that actually
 * crosses this line contributes a cut point. A line with no crossings has nowhere to trim
 * back to, so a click anywhere on it removes the whole entity — the same as trimming an
 * overshooting stray segment down to nothing in any CAD sketcher.
 *
 * Circles, arcs, splines, and standalone points are not yet trimmable themselves — only
 * lines are, though they can be trimmed back to where they cross any of those — the same
 * kind of scope cut `offsetEntities` documents for entities with no single well-defined
 * offset direction. A closed curve needs different bookkeeping (removing an interior arc
 * of it rather than an end of it), which is a natural follow-up, not something this
 * forecloses.
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

  const cutSet = new Set<number>([0, 1]);
  for (const other of sketch.entities) {
    if (other.id === entityId) continue;
    for (const t of lineIntersectionParams(start, end, other, sketch)) cutSet.add(t);
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
  const pointAt = (t: number): string => {
    if (t <= 1e-9) return entity.start;
    if (t >= 1 - 1e-9) return entity.end;
    const result = ensurePoint(working, start.x + t * dx, start.y + t * dy, 0);
    working = result.sketch;
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

  const removed = new Set([entityId]);
  const entities = [...working.entities.filter((candidate) => !removed.has(candidate.id)), ...survivors];
  const survivingPoints = new Set(entities.flatMap(entityPoints));
  survivingPoints.add(originPointId(working.id));

  return {
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
}
