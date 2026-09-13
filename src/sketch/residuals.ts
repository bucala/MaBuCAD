import type { Dimension, GeometricConstraint, Sketch, SketchEntity } from "./types";

/**
 * Floor for any geometric length the residuals divide by or compare against — the single
 * named home for the clamp that had drifted into eight separate inline `Math.max(len,
 * 1e-9)` calls. Guards the degenerate cases (a zero-length line has no direction;
 * `atan2` at the origin is noisy) uniformly.
 */
const MIN_LENGTH = 1e-9;

/**
 * Residual weight of the sketcher's ephemeral drag pin (a "fix" carrying its own cursor
 * target via `GeometricConstraint.at` — see the "fix" case below for why the pin must
 * lose, not tie, against real constraints). Small enough that a conflicting constraint
 * holds to sub-micron while the point still slides freely along whichever directions the
 * constraint leaves open; a free point's pin is the only residual, so its weight has no
 * effect on where it lands.
 */
const DRAG_PIN_WEIGHT = 1e-3;

/**
 * Variable layout for the solver.
 *
 * Every point contributes x and y; every circle and arc contributes its radius. The
 * index maps let residual functions read the current guess without searching.
 */
export interface VariableLayout {
  /** point id -> index of its x coordinate (y sits at index + 1). */
  pointIndex: Map<string, number>;
  /** circle id -> index of its radius. */
  radiusIndex: Map<string, number>;
  size: number;
}

/**
 * One independently-shaped block of the residual vector: a single geometric constraint or
 * dimension, whose equations read only a known handful of layout variables.
 *
 * Splitting the residual vector into these sparse blocks is what lets the Jacobian be built
 * without perturing every variable for every equation — the old dense build perturbed a
 * full column at a time and paid 2n+1 *full* residual evaluations per Newton iteration;
 * here each block is recomputed only along the few variables its own equations actually
 * read (see `solver.ts`'s `jacobian`). `variables` must be a superset of what `evaluate`
 * reads — never a subset: a missed dependency would silently zero a Jacobian entry that a
 * dense probe would fill. The `jacobian.spec.ts` consistency suite is what proves the two
 * builds produce identical matrices on every constraint/dimension kind.
 */
export interface ResidualSource {
  /** First row of the full residual vector this block contributes, in source order. */
  rowStart: number;
  /** Variable indices this block's equations read, in any order (duplicates allowed). */
  variables: number[];
  /** Computes exactly this block's rows — its own residuals — at a given value vector. */
  evaluate: (values: Float64Array) => number[];
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
    if (entity.kind === "circle" || entity.kind === "arc") {
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
    if (entity.kind === "circle" || entity.kind === "arc") {
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
      entity.kind === "circle" || entity.kind === "arc"
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
  originalEntities: Map<string, SketchEntity>,
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
      // `at` (the drag pin's own cursor target) takes precedence over the anchor-map
      // position — see `GeometricConstraint.at`'s doc comment for why one shared anchor
      // cannot serve both the pin and the pre-drag-anchored real fixes in a drag solve.
      const anchor = constraint.at ?? original.get(id) ?? { x: 0, y: 0 };
      // The drag pin is a *goal*, not a constraint: when the cursor position fights a real
      // constraint (dragging an endpoint of a Fix-Line line off its own extension), the
      // constraint must win and the point lands on the cursor's projection, not on a
      // least-squares midpoint that breaks the constraint. An unweighted pin residual is
      // exactly equal in rank to every real constraint's, so the Newton compromise would
      // sit halfway — weighting only the pull (never the radius hold below, and never a
      // real fix, which has no `at`) makes real constraints dominate while a free point,
      // whose pin is the only residual, still lands exactly on the cursor in one linear
      // step regardless of the weight.
      const pull = constraint.at ? DRAG_PIN_WEIGHT : 1;
      const residuals = [(p.x - anchor.x) * pull, (p.y - anchor.y) * pull];

      // "Fix" dispatched onto a circle/arc's centre (see `applyConstraint`'s "fix" branch)
      // also pins the shape's own size at whatever it was when the constraint was added —
      // otherwise the centre alone leaves radius completely free, so dragging an arc's rim
      // point would silently resize it instead of just sliding it around the fixed circle.
      for (const entity of entities.values()) {
        if ((entity.kind !== "arc" && entity.kind !== "circle") || entity.center !== id) continue;
        const anchorEntity = originalEntities.get(entity.id);
        if (!anchorEntity || (anchorEntity.kind !== "arc" && anchorEntity.kind !== "circle")) continue;
        const radiusIndex = layout.radiusIndex.get(entity.id);
        if (radiusIndex === undefined) continue;
        residuals.push(values[radiusIndex] - anchorEntity.radius);
      }

      return residuals;
    }

    case "fix-line": {
      // Locks the line's own infinite extension (direction + perpendicular offset) to
      // where it was when the constraint was added — its two *own* degrees of freedom —
      // without pinning either endpoint's position along that line, so the line can still
      // be lengthened/shortened from either end.
      const line = entities.get(constraint.entities[0]);
      if (!line || line.kind !== "line") return [];
      const currentA = readPoint(values, layout, line.start);
      const currentB = readPoint(values, layout, line.end);
      const anchorA = original.get(line.start) ?? currentA;
      const anchorB = original.get(line.end) ?? currentB;
      const anchorDir = direction(anchorA, anchorB);
      const scale = Math.max(length(anchorDir), MIN_LENGTH);
      const currentDir = direction(currentA, currentB);
      return [cross(anchorDir, currentDir) / scale, cross(anchorDir, direction(anchorA, currentA)) / scale];
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
      const scale = Math.max(length(u) * length(v), MIN_LENGTH);
      return [cross(u, v) / scale];
    }

    case "perpendicular": {
      const first = lineEnds(entities, values, layout, constraint.entities[0]);
      const second = lineEnds(entities, values, layout, constraint.entities[1]);
      if (!first || !second) return [];
      const u = direction(first.a, first.b);
      const v = direction(second.a, second.b);
      const scale = Math.max(length(u) * length(v), MIN_LENGTH);
      return [dot(u, v) / scale];
    }

    case "equal": {
      const [firstId, secondId] = constraint.entities;
      const firstEntity = entities.get(firstId);
      const secondEntity = entities.get(secondId);
      if (!firstEntity || !secondEntity) return [];

      // Circles and arcs both carry a radius variable (see `buildLayout`), and an arc's
      // radius is held consistent with its centre and rim points by the "arc-radius"
      // constraints every arc is created with — so equal radii is one residual for any
      // curve pair. Previously an arc fell through to the line branch, contributed *no*
      // residual, and the constraint silently did nothing while the DOF readout counted
      // it as absent.
      const isCurve = (entity: SketchEntity) => entity.kind === "circle" || entity.kind === "arc";
      if (isCurve(firstEntity) && isCurve(secondEntity)) {
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
      // Arcs share a circle's centre-driven rim (their `center` is the same kind of point
      // reference), so the constraint applies to any circle/arc pair — previously an arc
      // made this a silent no-op.
      const isCurve = (entity: SketchEntity | undefined) =>
        entity?.kind === "circle" || entity?.kind === "arc";
      if (!isCurve(first) || !isCurve(second)) return [];

      const p = readPoint(values, layout, first!.center);
      const q = readPoint(values, layout, second!.center);
      return [p.x - q.x, p.y - q.y];
    }

    case "arc-radius": {
      const arc = entities.get(constraint.entities[0]);
      if (!arc || arc.kind !== "arc") return [];

      const centre = readPoint(values, layout, arc.center);
      const rim = readPoint(values, layout, constraint.points[0]);
      const radius = values[layout.radiusIndex.get(arc.id)!];
      return [length(direction(centre, rim)) - radius];
    }

    case "tangent": {
      // Line tangent to a circle or an arc — a Sketch Fillet's rounded corner is exactly
      // this (a line tangent to the fillet arc), and an arc's rim is driven by the same
      // centre/radius pair as a circle's (see `point-on-circle` above), so the same
      // "perpendicular distance from the centre equals r" residual applies to either.
      const lineId = constraint.entities.find((id) => entities.get(id)?.kind === "line");
      const curveId = constraint.entities.find((id) => {
        const kind = entities.get(id)?.kind;
        return kind === "circle" || kind === "arc";
      });
      if (!lineId || !curveId) return [];

      const ends = lineEnds(entities, values, layout, lineId);
      const curve = entities.get(curveId);
      if (!ends || !curve || (curve.kind !== "circle" && curve.kind !== "arc")) return [];

      const centre = readPoint(values, layout, curve.center);
      const radius = values[layout.radiusIndex.get(curveId)!];
      const u = direction(ends.a, ends.b);
      const denominator = Math.max(length(u), MIN_LENGTH);
      const distance = Math.abs(cross(u, direction(ends.a, centre))) / denominator;
      return [distance - radius];
    }

    case "point-on-line": {
      const ends = lineEnds(entities, values, layout, constraint.entities[0]);
      if (!ends) return [];
      const p = readPoint(values, layout, constraint.points[0]);
      const u = direction(ends.a, ends.b);
      const scale = Math.max(length(u), MIN_LENGTH);
      return [cross(u, direction(ends.a, p)) / scale];
    }

    case "point-on-circle": {
      // Covers both a circle and an arc — an arc's rim is just its underlying circle's,
      // so the same "distance from centre equals radius" residual applies to either
      // without needing to know or enforce which side of the arc's sweep the point sits on.
      const curve = entities.get(constraint.entities[0]);
      if (!curve || (curve.kind !== "circle" && curve.kind !== "arc")) return [];
      const centre = readPoint(values, layout, curve.center);
      const p = readPoint(values, layout, constraint.points[0]);
      const radius = values[layout.radiusIndex.get(curve.id)!];
      return [length(direction(centre, p)) - radius];
    }

    case "point-on-spline": {
      // A spline is a chain of straight segments for constraint purposes (the same
      // approximation the trim/intersection code already makes) — find whichever segment
      // the point currently sits closest to and pin it there with a point-on-line-style
      // residual for that segment. Re-picking the nearest segment on every evaluation
      // rather than fixing it once at constraint-creation time keeps this correct as the
      // spline reshapes, at the cost of a small kink in the residual where the closest
      // segment changes — acceptable since the solver only needs local convergence.
      const spline = entities.get(constraint.entities[0]);
      if (!spline || spline.kind !== "spline" || spline.points.length < 2) return [];
      const p = readPoint(values, layout, constraint.points[0]);

      let best: { distance: number; residual: number } | null = null;
      for (let i = 0; i < spline.points.length - 1; i += 1) {
        const a = readPoint(values, layout, spline.points[i]);
        const b = readPoint(values, layout, spline.points[i + 1]);
        const u = direction(a, b);
        const segLength = Math.max(length(u), MIN_LENGTH);
        const t = Math.min(1, Math.max(0, dot(direction(a, p), u) / (segLength * segLength)));
        const closest = { x: a.x + t * u.x, y: a.y + t * u.y };
        const distance = length(direction(closest, p));
        const residual = cross(u, direction(a, p)) / segLength;
        if (!best || distance < best.distance) best = { distance, residual };
      }
      return best ? [best.residual] : [];
    }

    case "midpoint": {
      const ends = lineEnds(entities, values, layout, constraint.entities[0]);
      if (!ends) return [];
      const p = readPoint(values, layout, constraint.points[0]);
      const mid = { x: (ends.a.x + ends.b.x) / 2, y: (ends.a.y + ends.b.y) / 2 };
      return [p.x - mid.x, p.y - mid.y];
    }

    case "colinear": {
      // Both endpoints of the second line lie on the first line's infinite extension —
      // two point-on-line equations sharing the first line as reference, rather than one
      // equation per line the way parallel/perpendicular work, since colinear is strictly
      // stronger than parallel (same line, not just same direction).
      const first = lineEnds(entities, values, layout, constraint.entities[0]);
      const second = lineEnds(entities, values, layout, constraint.entities[1]);
      if (!first || !second) return [];
      const u = direction(first.a, first.b);
      const scale = Math.max(length(u), MIN_LENGTH);
      return [
        cross(u, direction(first.a, second.a)) / scale,
        cross(u, direction(first.a, second.b)) / scale,
      ];
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

    case "point-line-distance": {
      const ends = lineEnds(entities, values, layout, dimension.entities[0]);
      if (!ends) return [];
      const p = readPoint(values, layout, dimension.points[0]);
      const u = direction(ends.a, ends.b);
      const scale = Math.max(length(u), MIN_LENGTH);
      // Unsigned perpendicular distance from the point to the line's own infinite
      // extension — `Math.abs` because a driving dimension's target is always a positive
      // span, same as `distance`'s own `length()` never goes negative; which side of the
      // line the point sits on isn't something this dimension records.
      return [Math.abs(cross(u, direction(ends.a, p))) / scale - dimension.value];
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
      // A degenerate (zero-length) line has no angle to anything — `atan2(0, 0)` is 0 and
      // its finite-difference derivative near the origin is both large and noisy, which
      // would poison the Jacobian. The dimension sits out until some other constraint has
      // given the line actual extent, the same guard every scaled residual already applies.
      if (length(u) < MIN_LENGTH || length(v) < MIN_LENGTH) return [];
      const current = Math.atan2(Math.abs(cross(u, v)), dot(u, v));
      return [current - (dimension.value * Math.PI) / 180];
    }

    default:
      return [];
  }
}

/**
 * Id -> entity lookup shared by every residual pass over one sketch — hoisted out of
 * `evaluateResiduals` so a solver can build it once per solve instead of once per
 * evaluation (the finite-difference Jacobian alone evaluates it 2n+1 times per iteration).
 */
export function buildEntityMap(sketch: Sketch): Map<string, SketchEntity> {
  return new Map(sketch.entities.map((entity) => [entity.id, entity]));
}

/** Variable indices for a list of point ids (each contributes its x and y slot). */
function pointVariables(layout: VariableLayout, ids: string[]): number[] {
  const variables: number[] = [];
  for (const id of ids) {
    const index = layout.pointIndex.get(id);
    if (index !== undefined) variables.push(index, index + 1);
  }
  return variables;
}

/** Variable indices for one or more line entities' endpoints (start and end each 2). */
function lineVariables(
  layout: VariableLayout,
  entities: Map<string, SketchEntity>,
  ids: string[],
): number[] {
  const variables: number[] = [];
  for (const id of ids) {
    const entity = entities.get(id);
    if (!entity || entity.kind !== "line") continue;
    const a = layout.pointIndex.get(entity.start);
    const b = layout.pointIndex.get(entity.end);
    if (a !== undefined) variables.push(a, a + 1);
    if (b !== undefined) variables.push(b, b + 1);
  }
  return variables;
}

/**
 * The set of layout variables one geometric constraint's equations read.
 *
 * This is the mirror image of `geometricResiduals` above — every switch case must report
 * every point/radius slot the matching residual case actually reads, and must stay in step
 * with it when either changes. The `jacobian.spec.ts` suite pins the two together by
 * comparing the Jacobian built from these dependencies against a dense perturbation of the
 * full residual vector, so a drift in either direction fails loudly rather than silently
 * producing a wrong sparse matrix.
 */
function geometricVariables(
  constraint: GeometricConstraint,
  layout: VariableLayout,
  entities: Map<string, SketchEntity>,
): number[] {
  switch (constraint.kind) {
    case "coincident":
      return pointVariables(layout, constraint.points);

    case "fix": {
      // The point's own x/y plus the radius of every circle/arc whose centre is this exact
      // point — the same scan `geometricResiduals`'s "fix" case performs to pin each
      // matching shape's size.
      const variables = pointVariables(layout, constraint.points);
      for (const entity of entities.values()) {
        if ((entity.kind !== "arc" && entity.kind !== "circle") || entity.center !== constraint.points[0]) continue;
        const radius = layout.radiusIndex.get(entity.id);
        if (radius !== undefined) variables.push(radius);
      }
      return variables;
    }

    case "fix-line":
    case "horizontal":
    case "vertical":
      return lineVariables(layout, entities, constraint.entities);

    case "parallel":
    case "perpendicular":
    case "colinear":
      return lineVariables(layout, entities, constraint.entities);

    case "equal": {
      const first = entities.get(constraint.entities[0]);
      const second = entities.get(constraint.entities[1]);
      const isCurve = (entity: SketchEntity | undefined) =>
        entity?.kind === "circle" || entity?.kind === "arc";
      if (isCurve(first) && isCurve(second)) {
        const variables: number[] = [];
        for (const id of constraint.entities) {
          const radius = layout.radiusIndex.get(id);
          if (radius !== undefined) variables.push(radius);
        }
        return variables;
      }
      return lineVariables(layout, entities, constraint.entities);
    }

    case "concentric": {
      const variables: number[] = [];
      for (const id of constraint.entities) {
        const entity = entities.get(id);
        if (entity?.kind === "circle" || entity?.kind === "arc") {
          variables.push(...pointVariables(layout, [entity.center]));
        }
      }
      return variables;
    }

    case "arc-radius": {
      const arc = entities.get(constraint.entities[0]);
      if (!arc || arc.kind !== "arc") return [];
      const variables = pointVariables(layout, [arc.center, constraint.points[0]]);
      const radius = layout.radiusIndex.get(arc.id);
      if (radius !== undefined) variables.push(radius);
      return variables;
    }

    case "tangent": {
      const lineId = constraint.entities.find((id) => entities.get(id)?.kind === "line");
      const curveId = constraint.entities.find((id) => {
        const kind = entities.get(id)?.kind;
        return kind === "circle" || kind === "arc";
      });
      const curve = curveId ? entities.get(curveId) : undefined;
      const variables = lineVariables(layout, entities, lineId ? [lineId] : []);
      if (curve && (curve.kind === "circle" || curve.kind === "arc")) {
        variables.push(...pointVariables(layout, [curve.center]));
        const radius = layout.radiusIndex.get(curve.id);
        if (radius !== undefined) variables.push(radius);
      }
      return variables;
    }

    case "point-on-line":
      return [
        ...lineVariables(layout, entities, constraint.entities),
        ...pointVariables(layout, constraint.points),
      ];

    case "point-on-circle": {
      const curve = entities.get(constraint.entities[0]);
      const variables = pointVariables(layout, constraint.points);
      if (curve && (curve.kind === "circle" || curve.kind === "arc")) {
        variables.push(...pointVariables(layout, [curve.center]));
        const radius = layout.radiusIndex.get(curve.id);
        if (radius !== undefined) variables.push(radius);
      }
      return variables;
    }

    case "point-on-spline": {
      // The residual re-picks the nearest segment over *all* of the spline's points, so
      // every one of them (plus the constrained point) feeds the equation.
      const spline = entities.get(constraint.entities[0]);
      const ids = [...constraint.points];
      if (spline && spline.kind === "spline") ids.push(...spline.points);
      return pointVariables(layout, ids);
    }

    case "midpoint":
      return [
        ...lineVariables(layout, entities, constraint.entities),
        ...pointVariables(layout, constraint.points),
      ];

    default:
      return [];
  }
}

/** The set of layout variables one dimension's equation reads — see `geometricVariables`. */
function dimensionVariables(
  dimension: Dimension,
  layout: VariableLayout,
  entities: Map<string, SketchEntity>,
): number[] {
  switch (dimension.kind) {
    case "distance":
    case "horizontal-distance":
    case "vertical-distance":
    case "ordinate-x":
    case "ordinate-y":
      return pointVariables(layout, dimension.points);

    case "point-line-distance":
      return [
        ...lineVariables(layout, entities, dimension.entities),
        ...pointVariables(layout, dimension.points),
      ];

    case "radius":
    case "diameter": {
      const radius = layout.radiusIndex.get(dimension.entities[0]);
      return radius === undefined ? [] : [radius];
    }

    case "angle":
      return lineVariables(layout, entities, dimension.entities);

    default:
      return [];
  }
}

/**
 * Decomposes a sketch's residual vector into its sparse per-constraint/per-dimension blocks.
 *
 * Each block owns a contiguous run of rows (`rowStart`…`rowStart`+evaluate-length-1) and the
 * short list of layout variables its own equations read; a solver builds this once per solve
 * and reuses the block closures across every iteration, residual evaluation and Jacobian
 * probe instead of re-deriving them. Row offsets are established by evaluating each block
 * once at `values` — the same evaluation that produces the solve's initial residual.
 */
export function residualSources(
  sketch: Sketch,
  layout: VariableLayout,
  values: Float64Array,
  anchors: Map<string, { x: number; y: number }>,
  anchorEntities: Map<string, SketchEntity>,
  entities: Map<string, SketchEntity>,
): ResidualSource[] {
  const sources: ResidualSource[] = [];
  let rowStart = 0;

  for (const constraint of sketch.constraints) {
    const evaluate = (probe: Float64Array) =>
      geometricResiduals(constraint, entities, probe, layout, anchors, anchorEntities);
    sources.push({ rowStart, variables: geometricVariables(constraint, layout, entities), evaluate });
    rowStart += evaluate(values).length;
  }

  for (const dimension of sketch.dimensions) {
    const evaluate = (probe: Float64Array) =>
      dimensionResiduals(dimension, entities, probe, layout);
    sources.push({ rowStart, variables: dimensionVariables(dimension, layout, entities), evaluate });
    rowStart += evaluate(values).length;
  }

  return sources;
}

/** Full residual vector by concatenating every source's own rows, in source order. */
export function sourceResiduals(sources: ResidualSource[], values: Float64Array): number[] {
  const residuals: number[] = [];
  for (const source of sources) residuals.push(...source.evaluate(values));
  return residuals;
}

/**
 * Full residual vector for a sketch at a given guess.
 *
 * `anchors`/`anchorEntities` hold the positions and radii "fix"/"fix-line" constraints pin
 * to, captured before solving so a fixed point (or a fixed arc/circle's radius) does not
 * drift with the guess. `entities` is the same id -> entity lookup `buildEntityMap`
 * produces, overridable so a caller that evaluates many times over one sketch reuses one
 * map rather than rebuilding it per call.
 */
export function evaluateResiduals(
  sketch: Sketch,
  layout: VariableLayout,
  values: Float64Array,
  anchors: Map<string, { x: number; y: number }>,
  anchorEntities: Map<string, SketchEntity> = buildEntityMap(sketch),
  entities: Map<string, SketchEntity> = buildEntityMap(sketch),
): number[] {
  return sourceResiduals(residualSources(sketch, layout, values, anchors, anchorEntities, entities), values);
}
