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
      return entity?.kind === "circle" ? entity.radius : 0;
    }
    case "diameter": {
      const entity = entities[0] ? entityById(sketch, entities[0]) : undefined;
      return entity?.kind === "circle" ? entity.radius * 2 : 0;
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
    if (entity?.kind === "circle") {
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
  }
}

/**
 * Whether the non-construction geometry forms at least one closed loop.
 *
 * Reported in the sketch panel because a profile must close before it can be extruded.
 */
export function hasClosedProfile(sketch: Sketch): boolean {
  const lines = sketch.entities.filter(
    (entity): entity is Extract<SketchEntity, { kind: "line" }> =>
      entity.kind === "line" && !entity.construction,
  );
  if (lines.length < 3) {
    return sketch.entities.some((entity) => entity.kind === "circle" && !entity.construction);
  }

  // Every endpoint of a closed loop is shared by at least two lines.
  const degree = new Map<string, number>();
  for (const line of lines) {
    degree.set(line.start, (degree.get(line.start) ?? 0) + 1);
    degree.set(line.end, (degree.get(line.end) ?? 0) + 1);
  }

  const endpoints = [...degree.values()];
  return endpoints.length > 0 && endpoints.every((count) => count >= 2);
}
