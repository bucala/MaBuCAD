import type { Dimension, GeometricConstraint, Sketch, SketchEntity } from "./types";

/**
 * Variable layout for the solver.
 *
 * Every point contributes x and y; every circle contributes its radius. The index maps
 * let residual functions read the current guess without searching.
 */
export interface VariableLayout {
  /** point id -> index of its x coordinate (y sits at index + 1). */
  pointIndex: Map<string, number>;
  /** circle id -> index of its radius. */
  radiusIndex: Map<string, number>;
  size: number;
}

export function buildLayout(sketch: Sketch): VariableLayout {
  const pointIndex = new Map<string, number>();
  const radiusIndex = new Map<string, number>();
  let size = 0;

  for (const point of sketch.points) {
    pointIndex.set(point.id, size);
    size += 2;
  }

  for (const entity of sketch.entities) {
    if (entity.kind === "circle") {
      radiusIndex.set(entity.id, size);
      size += 1;
    }
  }

  return { pointIndex, radiusIndex, size };
}

export function packVariables(sketch: Sketch, layout: VariableLayout): Float64Array {
  const values = new Float64Array(layout.size);

  for (const point of sketch.points) {
    const index = layout.pointIndex.get(point.id)!;
    values[index] = point.x;
    values[index + 1] = point.y;
  }

  for (const entity of sketch.entities) {
    if (entity.kind === "circle") {
      values[layout.radiusIndex.get(entity.id)!] = entity.radius;
    }
  }

  return values;
}

export function unpackVariables(sketch: Sketch, layout: VariableLayout, values: Float64Array): Sketch {
  return {
    ...sketch,
    points: sketch.points.map((point) => {
      const index = layout.pointIndex.get(point.id)!;
      return { ...point, x: values[index], y: values[index + 1] };
    }),
    entities: sketch.entities.map((entity) =>
      entity.kind === "circle"
        ? { ...entity, radius: values[layout.radiusIndex.get(entity.id)!] }
        : entity,
    ),
  };
}

interface Vec2 {
  x: number;
  y: number;
}

function readPoint(values: Float64Array, layout: VariableLayout, id: string): Vec2 {
  const index = layout.pointIndex.get(id);
  if (index === undefined) return { x: 0, y: 0 };
  return { x: values[index], y: values[index + 1] };
}

/** Endpoints of a line entity, or null when the id is not a line. */
function lineEnds(
  entities: Map<string, SketchEntity>,
  values: Float64Array,
  layout: VariableLayout,
  id: string,
): { a: Vec2; b: Vec2 } | null {
  const entity = entities.get(id);
  if (!entity || entity.kind !== "line") return null;
  return { a: readPoint(values, layout, entity.start), b: readPoint(values, layout, entity.end) };
}

const direction = (a: Vec2, b: Vec2): Vec2 => ({ x: b.x - a.x, y: b.y - a.y });
const dot = (u: Vec2, v: Vec2) => u.x * v.x + u.y * v.y;
const cross = (u: Vec2, v: Vec2) => u.x * v.y - u.y * v.x;
const length = (v: Vec2) => Math.hypot(v.x, v.y);

/**
 * Residual equations for one geometric constraint.
 *
 * Each returned number must be zero when the constraint is satisfied. Scaling matters:
 * residuals are kept in length units where possible so the solver weights a 1 mm error in
 * a distance the same as a 1 mm error in a coincidence.
 */
function geometricResiduals(
  constraint: GeometricConstraint,
  entities: Map<string, SketchEntity>,
  values: Float64Array,
  layout: VariableLayout,
  original: Map<string, { x: number; y: number }>,
): number[] {
  switch (constraint.kind) {
    case "coincident": {
      const [first, second] = constraint.points;
      const p = readPoint(values, layout, first);
      const q = readPoint(values, layout, second);
      return [p.x - q.x, p.y - q.y];
    }

    case "fix": {
      const [id] = constraint.points;
      const p = readPoint(values, layout, id);
      const anchor = original.get(id) ?? { x: 0, y: 0 };
      return [p.x - anchor.x, p.y - anchor.y];
    }

    case "horizontal": {
      const ends = lineEnds(entities, values, layout, constraint.entities[0]);
      return ends ? [ends.a.y - ends.b.y] : [];
    }

    case "vertical": {
      const ends = lineEnds(entities, values, layout, constraint.entities[0]);
      return ends ? [ends.a.x - ends.b.x] : [];
    }

    case "parallel": {
      const first = lineEnds(entities, values, layout, constraint.entities[0]);
      const second = lineEnds(entities, values, layout, constraint.entities[1]);
      if (!first || !second) return [];
      const u = direction(first.a, first.b);
      const v = direction(second.a, second.b);
      // Normalised so the residual stays in length units rather than area units.
      const scale = Math.max(length(u) * length(v), 1e-9);
      return [cross(u, v) / scale];
    }

    case "perpendicular": {
      const first = lineEnds(entities, values, layout, constraint.entities[0]);
      const second = lineEnds(entities, values, layout, constraint.entities[1]);
      if (!first || !second) return [];
      const u = direction(first.a, first.b);
      const v = direction(second.a, second.b);
      const scale = Math.max(length(u) * length(v), 1e-9);
      return [dot(u, v) / scale];
    }

    case "equal": {
      const [firstId, secondId] = constraint.entities;
      const firstEntity = entities.get(firstId);
      const secondEntity = entities.get(secondId);
      if (!firstEntity || !secondEntity) return [];

      if (firstEntity.kind === "circle" && secondEntity.kind === "circle") {
        return [
          values[layout.radiusIndex.get(firstId)!] - values[layout.radiusIndex.get(secondId)!],
        ];
      }

      const first = lineEnds(entities, values, layout, firstId);
      const second = lineEnds(entities, values, layout, secondId);
      if (!first || !second) return [];
      return [length(direction(first.a, first.b)) - length(direction(second.a, second.b))];
    }

    case "concentric": {
      const [firstId, secondId] = constraint.entities;
      const first = entities.get(firstId);
      const second = entities.get(secondId);
      if (!first || !second || first.kind !== "circle" || second.kind !== "circle") return [];

      const p = readPoint(values, layout, first.center);
      const q = readPoint(values, layout, second.center);
      return [p.x - q.x, p.y - q.y];
    }

    case "tangent": {
      // Line tangent to a circle: the perpendicular distance from the centre equals r.
      const lineId = constraint.entities.find((id) => entities.get(id)?.kind === "line");
      const circleId = constraint.entities.find((id) => entities.get(id)?.kind === "circle");
      if (!lineId || !circleId) return [];

      const ends = lineEnds(entities, values, layout, lineId);
      const circle = entities.get(circleId);
      if (!ends || !circle || circle.kind !== "circle") return [];

      const centre = readPoint(values, layout, circle.center);
      const radius = values[layout.radiusIndex.get(circleId)!];
      const u = direction(ends.a, ends.b);
      const denominator = Math.max(length(u), 1e-9);
      const distance = Math.abs(cross(u, direction(ends.a, centre))) / denominator;
      return [distance - radius];
    }

    case "point-on-line": {
      const ends = lineEnds(entities, values, layout, constraint.entities[0]);
      if (!ends) return [];
      const p = readPoint(values, layout, constraint.points[0]);
      const u = direction(ends.a, ends.b);
      const scale = Math.max(length(u), 1e-9);
      return [cross(u, direction(ends.a, p)) / scale];
    }

    default:
      return [];
  }
}

/** Residual for one dimension. Driving dimensions are equations like any other. */
function dimensionResiduals(
  dimension: Dimension,
  entities: Map<string, SketchEntity>,
  values: Float64Array,
  layout: VariableLayout,
): number[] {
  switch (dimension.kind) {
    case "distance": {
      const p = readPoint(values, layout, dimension.points[0]);
      const q = readPoint(values, layout, dimension.points[1]);
      return [length(direction(p, q)) - dimension.value];
    }

    // Ordinate dimensions are signed axis distances from a datum, which is exactly what
    // makes a chain of them share one zero.
    case "horizontal-distance":
    case "ordinate-x": {
      const datum = readPoint(values, layout, dimension.points[0]);
      const target = readPoint(values, layout, dimension.points[1]);
      return [target.x - datum.x - dimension.value];
    }

    case "vertical-distance":
    case "ordinate-y": {
      const datum = readPoint(values, layout, dimension.points[0]);
      const target = readPoint(values, layout, dimension.points[1]);
      return [target.y - datum.y - dimension.value];
    }

    case "radius": {
      const index = layout.radiusIndex.get(dimension.entities[0]);
      return index === undefined ? [] : [values[index] - dimension.value];
    }

    case "diameter": {
      const index = layout.radiusIndex.get(dimension.entities[0]);
      return index === undefined ? [] : [2 * values[index] - dimension.value];
    }

    case "angle": {
      const first = lineEnds(entities, values, layout, dimension.entities[0]);
      const second = lineEnds(entities, values, layout, dimension.entities[1]);
      if (!first || !second) return [];
      const u = direction(first.a, first.b);
      const v = direction(second.a, second.b);
      const current = Math.atan2(Math.abs(cross(u, v)), dot(u, v));
      return [current - (dimension.value * Math.PI) / 180];
    }

    default:
      return [];
  }
}

/**
 * Full residual vector for a sketch at a given guess.
 *
 * `anchors` holds the positions "fix" constraints pin to, captured before solving so a
 * fixed point does not drift with the guess.
 */
export function evaluateResiduals(
  sketch: Sketch,
  layout: VariableLayout,
  values: Float64Array,
  anchors: Map<string, { x: number; y: number }>,
): number[] {
  const entities = new Map(sketch.entities.map((entity) => [entity.id, entity]));
  const residuals: number[] = [];

  for (const constraint of sketch.constraints) {
    residuals.push(...geometricResiduals(constraint, entities, values, layout, anchors));
  }

  for (const dimension of sketch.dimensions) {
    residuals.push(...dimensionResiduals(dimension, entities, values, layout));
  }

  return residuals;
}
