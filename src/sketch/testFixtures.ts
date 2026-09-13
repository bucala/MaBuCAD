import type {
  ArcEntity,
  CircleEntity,
  Dimension,
  GeometricConstraint,
  GeometricConstraintKind,
  LineEntity,
  PointEntity,
  Sketch,
  SketchPoint,
  SplineEntity,
} from "./types";

/**
 * Hand-built sketch fixtures for the solver/residual unit tests. Unlike the interactive
 * tools' own output these state exactly the geometry and relations a test cares about,
 * so a failing assertion points at the behaviour under test, not at whatever the tool
 * happened to add alongside it.
 */

export function p(id: string, x: number, y: number): SketchPoint {
  return { id, x, y };
}

export function line(id: string, start: string, end: string): LineEntity {
  return { id, kind: "line", start, end, construction: false };
}

export function circle(id: string, center: string, radius: number): CircleEntity {
  return { id, kind: "circle", center, radius, construction: false };
}

export function arc(id: string, center: string, start: string, end: string, radius: number): ArcEntity {
  return { id, kind: "arc", center, start, end, radius, construction: false };
}

export function gc(
  id: string,
  kind: GeometricConstraintKind,
  entities: string[] = [],
  points: string[] = [],
): GeometricConstraint {
  return { id, kind, entities, points };
}

export function dim(
  id: string,
  kind: Dimension["kind"],
  value: number,
  points: string[] = [],
  entities: string[] = [],
): Dimension {
  return { id, kind, value, points, entities, labelOffset: { x: 0, y: 0 } };
}

export function sketch(
  points: SketchPoint[],
  entities:
    | LineEntity[]
    | (LineEntity | ArcEntity | CircleEntity | SplineEntity | PointEntity)[] = [],
  constraints: GeometricConstraint[] = [],
  dimensions: Dimension[] = [],
): Sketch {
  return {
    id: "test-sketch",
    planeId: "front",
    points,
    entities: entities as Sketch["entities"],
    constraints,
    dimensions,
  };
}

/** Anchor map a plain (non-anchored) solve uses: every point pins to where it already is. */
export function anchorsOf(sk: Sketch): Map<string, { x: number; y: number }> {
  return new Map(sk.points.map((point) => [point.id, { x: point.x, y: point.y }]));
}

/**
 * A large sketch at the scale the render memoisation (`sketchRender.ts`) and solver
 * fixtures target: 240 curve entities (80 circles, 80 lines, 40 arcs, 40 splines — a mix
 * chosen so the expensive tessellations dominate) plus 80 standalone points, over a
 * 600-point pool. Deterministic — same ids, same coordinates, every build — so specs can
 * pin per-entity behaviour without depending on store tool side effects. Unconstrained by
 * design: this is a *scale* fixture, and the solver suites carry their own small
 * hand-constrained sketches.
 *
 * `draggedCircleId`/`draggedPointId` name the one circle a drag spec moves: moving that
 * centre must re-tessellate exactly the one circle that references it and nothing else —
 * the whole point of the entity-keyed memoisation.
 */
export interface LargeSketchFixture {
  sketch: Sketch;
  draggedCircleId: string;
  draggedPointId: string;
}

export function largeSketchFixture(): LargeSketchFixture {
  const points: SketchPoint[] = [];
  const entities: (LineEntity | ArcEntity | CircleEntity | SplineEntity | PointEntity)[] = [];

  for (let i = 0; i < 80; i++) {
    const center = `large-circle-${i}`;
    points.push(p(center, (i * 7) % 280 + 10, (i * 11) % 180 + 10));
    entities.push(circle(center, center, 2 + (i % 5)));
  }

  for (let i = 0; i < 80; i++) {
    const start = `large-line-${i}-a`;
    const end = `large-line-${i}-b`;
    points.push(p(start, (i * 13) % 280 + 10, (i * 17) % 180 + 10));
    points.push(p(end, (i * 13) % 280 + 15, (i * 17) % 180 + 13));
    entities.push(line(`large-line-${i}`, start, end));
  }

  for (let i = 0; i < 40; i++) {
    const center = `large-arc-${i}`;
    const start = `large-arc-${i}-s`;
    const end = `large-arc-${i}-e`;
    const cx = (i * 19) % 270 + 15;
    const cy = (i * 23) % 170 + 15;
    points.push(p(center, cx, cy), p(start, cx + 5, cy), p(end, cx, cy + 5));
    entities.push(arc(center, center, start, end, 5));
  }

  for (let i = 0; i < 40; i++) {
    const ids = [0, 1, 2, 3].map((n) => `large-spline-${i}-${n}`);
    const bx = (i * 29) % 260 + 20;
    const by = (i * 31) % 160 + 20;
    ids.forEach((id, n) => points.push(p(id, bx + n * 4, by + (n % 2) * 6)));
    entities.push({ id: `large-spline-${i}`, kind: "spline", points: ids, construction: false });
  }

  for (let i = 0; i < 80; i++) {
    const id = `large-free-${i}`;
    points.push(p(id, (i * 37) % 290 + 5, 120 + (i * 41) % 70));
    entities.push({ id, kind: "point", at: id, construction: false });
  }

  return {
    sketch: sketch(points, entities),
    draggedCircleId: "large-circle-0",
    draggedPointId: "large-circle-0",
  };
}
