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
  | "reference-point"
  | "reference-csys";

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
   * Hole Wizard configuration — see the "Hole Wizard" section in `PropertyManager.tsx` and
   * `data/holeStandards.ts`/`data/holeResolution.ts` for where the data comes from. A hole
   * places one cylindrical cut per point in its sketch (`kernel/rebuild.ts`'s
   * `buildHoleSolid`), sized by `radius`; these four fields only drive *how `radius` gets
   * set* — the kernel itself only ever reads `radius`/`depth`/`endCondition`/`reversed`,
   * the same fields every other hole already used, so a document saved before this existed
   * still rebuilds unchanged.
   */
  holeType?: "simple" | "clearance" | "tapped" | "taper-tapped";
  /** `ClearanceStandardId` or `TappedStandardId` from `data/holeStandards.ts`, matching `holeType`
   * (`"taper-tapped"` uses the `"npt"` `TappedStandardId`, the same lookup as `"tapped"`). */
  holeStandard?: string;
  /** Clearance: the nominal size label (e.g. "M6"). Tapped/taper-tapped: the full thread designation (e.g. "M6x1"). */
  holeSize?: string;
  /** Clearance only. */
  holeFit?: "close" | "normal" | "loose";
  /** Resolved thread callout for a tapped or taper-tapped hole, e.g. "M6x1 (6H)" — display only. */
  threadDesignation?: string;
  /** Tapped/taper-tapped only, display metadata (this app doesn't model handedness or a
   * real thread profile at all — see `radius`'s own note above). */
  threadDirection?: "right" | "left";
  /** Tapped/taper-tapped only, display metadata: whether the thread runs the hole's full
   * depth rather than a shorter engagement length. Not yet read by the kernel — the same
   * "not modelled yet, but tracked so a future thread-visualisation feature has it" status
   * `threadDirection` has. */
  fullDepthThread?: boolean;
  /**
   * A hole's optional counterbore/spotface/countersink recess (`SeatType` from
   * `data/holeStandards.ts`, default/absent means `"none"`) — unlike the thread-display
   * fields above, this *does* drive real kernel geometry (`kernel/rebuild.ts`'s
   * `buildHoleSolid`): a second, wider cut stacked on the through-hole, cylindrical for
   * counterbore/spotface or conical for countersink.
   */
  seatType?: "none" | "counterbore" | "spotface" | "countersink";
  /** Seat recess diameter in mm, resolved from `data/holeStandards.ts`'s `SEAT_STANDARDS`
   * the same way `radius` is resolved from the clearance/tapped tables — kept as a plain
   * number rather than re-deriving it from `holeSize` at rebuild time so a custom recess
   * size (typed directly rather than picked from the standard) is possible later without a
   * kernel change. */
  seatDiameter?: number;
  /** Seat recess depth in mm (counterbore/spotface) or half-angle in degrees (countersink,
   * conventionally 90° full angle, so 45° half-angle) — which one depends on `seatType`. */
  seatDepthOrAngle?: number;
  /**
   * A blind hole's bottom profile: `"flat"` (the kernel's original, unchanged behaviour —
   * the cut simply stops) or `"angle"`, which caps it with an inward-pointing cone instead,
   * matching the shape a real twist drill actually leaves (118° included angle is the
   * standard general-purpose bit, matching Autodesk's own Hole Wizard default). Meaningless
   * (and ignored) for a through-all or up-to-surface hole, which has no "bottom" to shape.
   */
  drillPoint?: "flat" | "angle";
  /**
   * World axis a pattern repeats along/around, or a mirror reflects across. Also doubles as
   * the direction a `reference-axis` or `reference-point` is drawn along, and the plane a
   * `reference-plane` offsets from is stored in `Feature.parents` instead — all four stand
   * in for picking an edge/face/plane in the viewport, which the app has no UI for yet.
   */
  axis?: "x" | "y" | "z";
  /**
   * How an extrude/revolve combines with the body that already exists: `join` adds
   * material (a boss), `cut` removes it, `intersect` keeps only the overlap. Set on
   * every extrude/cut-extrude/revolve/cut-revolve feature so `kernel/rebuild.ts` reads
   * this rather than inferring add-vs-remove purely from the feature's own kind — kind
   * still supplies the default (extrude/revolve start as `join`, the cut-* kinds start
   * as `cut`), but this can be changed afterward without recreating the feature under a
   * different kind, matching how other CAD tools expose one Extrude command with a
   * Boolean choice rather than two separate commands.
   *
   * There is no fourth "new body" option: the kernel keeps one fused body per document
   * (see `viewportStore.ts`'s own note on this), so there is nothing yet for a second
   * body to be.
   */
  operation?: "join" | "cut" | "intersect";
  /**
   * World-space points marking the specific edges a Fillet or Chamfer applies to, picked in
   * the viewport (see `viewportStore.ts`'s `edgePickModeFeatureId` and `SolidModel.tsx`'s
   * edge-overlay click handling). There is no true persistent edge naming here — a rebuilt
   * solid's edges have no stable id to reference across a parametric replay the way a real
   * CAD kernel's topological naming would give them — so each point is instead re-resolved
   * on every rebuild via `EdgeFinder.withinDistance`, the closest edge to where the point
   * was picked in the *new* solid. This can occasionally latch onto the wrong edge if the
   * body changes enough between rebuilds, the honest cost of not having real persistent
   * naming, but works well for the common case of a shape that only grows/shrinks a little
   * between edits. Empty or absent means "every edge", matching this app's original,
   * unselective Fillet/Chamfer behaviour.
   */
  edgePoints?: [number, number, number][];
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
