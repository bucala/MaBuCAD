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
}

export interface CircleEntity {
  id: string;
  kind: "circle";
  center: string;
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

export type SketchEntity = LineEntity | CircleEntity | SplineEntity;

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
  | "fix";

export interface GeometricConstraint {
  id: string;
  kind: GeometricConstraintKind;
  /** Entity ids the constraint acts on (lines, circles). */
  entities: string[];
  /** Point ids the constraint acts on. */
  points: string[];
}

export type DimensionKind =
  | "distance"
  | "horizontal-distance"
  | "vertical-distance"
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
