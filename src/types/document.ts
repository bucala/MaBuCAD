/**
 * Document model for a history-based parametric part.
 *
 * A document is an ordered list of features. Rebuilding means replaying that list from
 * the top, so order is meaningful and a feature may only reference features above it.
 * This mirrors how SolidWorks, NX and Inventor structure a part.
 */

export type FeatureKind =
  // Reference geometry present in every new document
  | "annotations"
  | "material"
  | "plane"
  | "origin"
  // Sketches
  | "sketch"
  // Material-adding features
  | "extrude"
  | "revolve"
  | "sweep"
  | "loft"
  // Material-removing features
  | "cut-extrude"
  | "cut-revolve"
  | "cut-sweep"
  | "hole"
  // Dress-up features
  | "fillet"
  | "chamfer"
  | "shell"
  | "draft"
  | "rib"
  // Pattern features
  | "linear-pattern"
  | "circular-pattern"
  | "mirror"
  // A body loaded from STEP or STL; it has no history to replay
  | "imported"
  // Reference geometry created by the user
  | "reference-plane"
  | "reference-axis"
  | "reference-point";

/** Depth condition for extruded features, used by the property manager in Step 5. */
export type EndCondition = "blind" | "through-all" | "mid-plane" | "up-to-surface";

export interface FeatureParameters {
  depth?: number;
  angle?: number;
  radius?: number;
  distance?: number;
  thickness?: number;
  endCondition?: EndCondition;
  reversed?: boolean;
  count?: number;
  /**
   * World axis a pattern repeats along/around, or a mirror reflects across. Stands in for
   * picking a reference edge/axis/face in the viewport, which the app has no UI for yet.
   */
  axis?: "x" | "y" | "z";
}

export interface Feature {
  id: string;
  kind: FeatureKind;
  name: string;
  /** Suppressed features stay in the history but are skipped during rebuild. */
  suppressed: boolean;
  /**
   * Reference geometry created with the document. Cannot be deleted, and the rollback
   * bar cannot be dragged above it.
   */
  isDefault: boolean;
  /** Features this one consumes — a sketch's plane, an extrude's sketch. */
  parents: string[];
  parameters: FeatureParameters;
  /** Set when the last rebuild could not resolve this feature. */
  error?: string;
}

export type DocumentKind = "part" | "assembly" | "drawing";

export interface CadDocument {
  id: string;
  name: string;
  kind: DocumentKind;
  /** Ordered history. Index 0 rebuilds first. */
  features: Feature[];
  /**
   * How many features are currently built. Features from this index onwards sit below
   * the rollback bar and are excluded from the rebuild.
   */
  rollbackIndex: number;
}
