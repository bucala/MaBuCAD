/**
 * 2D sketch model.
 *
 * A sketch lives in the local coordinate system of its plane, so everything here is
 * plain 2D. The plane's rotation maps (x, y) into world space at render time.
 *
 * Geometry is stored as a pool of points plus entities that reference them by id. Two
 * entities sharing a point is what makes a profile connected, so closing a profile means
 * reusing the first point rather than adding a coincident constraint between duplicates.
 */

export interface SketchPoint {
  id: string;
  x: number;
  y: number;
}

export interface LineEntity {
  id: string;
  kind: "line";
  start: string;
  end: string;
  construction: boolean;
  /**
   * A construction line specifically marked as a revolve/rotation axis (drawn dash-dot,
   * the CAD convention for centrelines) — always also `construction: true`, so it is
   * excluded from a profile the same way any construction line already is. The distinction
   * from a plain construction line only matters to `revolveAxis()` in `kernel/rebuild.ts`:
   * when a sketch has one, it is preferred over "just the first construction line", which
   * is ambiguous the moment a sketch also uses a construction line for something else
   * (a mirror axis, an offset reference).
   */
  isAxis?: boolean;
}

export interface CircleEntity {
  id: string;
  kind: "circle";
  center: string;
  radius: number;
  construction: boolean;
}

/**
 * A centrepoint arc: a circle's centre plus two points on its rim.
 *
 * Always sweeps counter-clockwise from `start` to `end` — a fixed convention rather than
 * a stored direction flag, since the interactive tool and the kernel's loop-walking both
 * need to agree on which of the two possible arcs (through the near side or the far side
 * of the circle) a given `start`/`end` pair means, and that only works if both derive it
 * the same way.
 */
export interface ArcEntity {
  id: string;
  kind: "arc";
  center: string;
  start: string;
  end: string;
  radius: number;
  construction: boolean;
}

export interface SplineEntity {
  id: string;
  kind: "spline";
  /** Interpolated through these points, in order. */
  points: string[];
  construction: boolean;
}

export interface PointEntity {
  id: string;
  kind: "point";
  /** The point this entity anchors, in the shared point pool. */
  at: string;
  construction: boolean;
}

export type SketchEntity = LineEntity | CircleEntity | SplineEntity | PointEntity | ArcEntity;

export type GeometricConstraintKind =
  | "coincident"
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
  | "tangent"
  | "concentric"
  | "equal"
  | "point-on-line"
  /** A point lies on a circle's or arc's rim (distance from centre equals radius) — the
   * circle/arc counterpart of `point-on-line`, both driven by the same "Coincident" button
   * when the current selection is one point plus one curve instead of two points. */
  | "point-on-circle"
  /** A point lies on a spline's own curve — same idea as `point-on-line`/`point-on-circle`
   * for the one entity kind that isn't a single straight line or a single circle. */
  | "point-on-spline"
  /** A point's own position is pinned — used directly for a standalone point, and as the
   * dispatch target when "Fix" is applied to a circle/arc (its centre point). For a
   * circle/arc specifically, `geometricResiduals`'s "fix" case also pins the entity's own
   * radius at whatever it was when the constraint was added, so the whole shape stays put:
   * an arc's start/end points remain free to slide along its (now fixed) rim, extending or
   * shortening the arc's sweep, but can no longer drag its radius open or shut. */
  | "fix"
  /** "Fix" applied to a line: pins the infinite line it lies on (direction + offset) at
   * its position when the constraint was added, but — unlike pinning both endpoints —
   * leaves each endpoint free to slide along that fixed line, so the line can still be
   * lengthened/shortened from either end as long as its own two endpoint points carry no
   * other constraint pinning them in place. */
  | "fix-line"
  /** A point sits at the midpoint of a line — persisted so it stays there as the line's
   * endpoints move, rather than the one-time positional snap this used to be. */
  | "midpoint"
  /** Two lines share the same infinite line, without requiring their endpoints to touch. */
  | "colinear"
  /**
   * Not user-facing (no ribbon command creates it directly): pins one endpoint of an arc
   * to its entity's radius from its centre, auto-added alongside the arc so it stays
   * circular under dragging. Two of these exist per arc, one for `start` and one for `end`.
   */
  | "arc-radius";

export interface GeometricConstraint {
  id: string;
  kind: GeometricConstraintKind;
  /** Entity ids the constraint acts on (lines, circles). */
  entities: string[];
  /** Point ids the constraint acts on. */
  points: string[];
  /**
   * An explicit target position, used only by the sketcher's ephemeral drag pin
   * (`sketchStore.ts`'s `dragPoint`): the pin must pull the dragged point *to the cursor*
   * while every real "fix"/"fix-line" in the same solve stays anchored to the pre-drag
   * sketch (see `solveSketch`'s `anchorSketch` doc comment) — one shared anchor map cannot
   * express both for the same point, so the pin carries its own. Never persisted: the
   * store strips the drag-pin constraint before the solved sketch lands anywhere, and no
   * user-facing command creates a constraint with this field.
   */
  at?: { x: number; y: number };
}

export type DimensionKind =
  | "distance"
  | "horizontal-distance"
  | "vertical-distance"
  /** Perpendicular distance from a point (`points[0]`) to a line's own infinite extension
   * (`entities[0]`) — distinct from `distance` (which is always point-to-point) because a
   * point-to-line span isn't anchored to either of the line's own endpoints; it has to be
   * measured against the line's direction instead. */
  | "point-line-distance"
  | "radius"
  | "diameter"
  | "angle"
  /** Measured from a datum along the sketch X axis; the basis of ordinate dimensioning. */
  | "ordinate-x"
  /** Measured from a datum along the sketch Y axis. */
  | "ordinate-y";

export interface Dimension {
  id: string;
  kind: DimensionKind;
  /** Driving value in millimetres, or degrees for angles. */
  value: number;
  points: string[];
  entities: string[];
  /** Where the label sits relative to what it measures, in sketch coordinates. */
  labelOffset: { x: number; y: number };
  /** Radius/diameter only: extends the leader line inward past the near-rim point all the
   * way to the circle/arc's own centre, the ISO/Inventor convention for a small circle
   * where the plain rim-to-label leader alone doesn't make clear which circle it's
   * measuring. Toggled from the dimension's own right-click menu. */
  extendToCenter?: boolean;
}

export interface Sketch {
  /** Matches the id of the sketch feature in the document. */
  id: string;
  /** Reference plane the sketch is drawn on. */
  planeId: string;
  points: SketchPoint[];
  entities: SketchEntity[];
  constraints: GeometricConstraint[];
  dimensions: Dimension[];
}

/** Constraint state reported to the status bar, matching SolidWorks terminology. */
export interface SketchDiagnostics {
  /** Remaining degrees of freedom. Zero means fully defined. */
  dof: number;
  /** The solver reached a solution within tolerance. */
  converged: boolean;
  /** Some constraint duplicates another, so the system is over-constrained. */
  redundant: boolean;
  residualNorm: number;
  iterations: number;
}
