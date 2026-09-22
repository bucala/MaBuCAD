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
  /** Tapped/taper-tapped only. The kernel still cuts a plain cylinder — no real thread
   * profile is machined into the B-Rep, so this has no effect on STEP/STL export — but
   * `components/viewport/model/HoleThreadOverlay.tsx` reads it to wind its cosmetic thread
   * helix the matching direction, the same "display only" convention SolidWorks' own
   * cosmetic threads use. */
  threadDirection?: "right" | "left";
  /** Tapped/taper-tapped only: whether the cosmetic thread (`HoleThreadOverlay.tsx`) is
   * drawn the hole's full depth, or the shorter engagement length in `threadDepth` (which
   * defaults to a fraction of the hole when unset, for documents saved before that field
   * existed). Still display only; the kernel doesn't read this — it always cuts the hole
   * at the hole's own `depth` regardless of how deep the thread is drawn. */
  fullDepthThread?: boolean;
  /** Tapped/taper-tapped only, and only while `fullDepthThread` is `false`: how deep the
   * cosmetic thread helix is drawn, in mm — the same "thread depth" figure SolidWorks'
   * Hole Wizard asks for next to its own Full Depth toggle. The kernel still cuts a plain
   * cylinder of the hole's own `depth`; this only caps `HoleThreadOverlay.tsx`'s drawn
   * engagement length (clamped to the hole itself). */
  threadDepth?: number;
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
  /** Seat recess depth in mm (counterbore/spotface) or included angle in degrees
   * (countersink, conventionally 90°) — which one depends on `seatType`. Matches
   * `data/holeStandards.ts`'s own `depthOrAngle` semantics; `kernel/rebuild.ts`'s
   * `buildSeatTool` halves it into the half-angle the cone actually needs. */
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
  /**
   * Fillet/Chamfer only: true for the brief window between the feature being created (by
   * clicking the ribbon button) and the user picking their first edge — `kernel/rebuild.ts`
   * treats a feature with this set and no `edgePoints` yet as a pure pass-through (no edges
   * rounded/chamfered at all), rather than falling back to "every edge" the way an absent
   * `edgePoints` on an *already-edited* feature still does. `commandRegistry.ts`'s
   * `"feature.fillet"`/`"feature.chamfer"` handlers are the only place this gets set to
   * true; the edge-pick handler in `SolidModel.tsx` clears it the moment the first edge is
   * picked, so deselecting back down to zero edges *after* that point still means "every
   * edge" as before — this flag only gates that one initial moment, not the field's whole
   * meaning. Absent (including on any document saved before this field existed) behaves
   * exactly like before: no gate, empty/absent `edgePoints` is every edge.
   */
  edgesPending?: boolean;
  /**
   * Restricts an Extrude/Cut-Extrude/Revolve/Cut-Revolve's profile to just the closed
   * regions of its sketch that own at least one of these entity ids, instead of every
   * closed region the sketch has (`kernel/profile.ts`'s `profileRegions`'s default). Empty
   * or absent means "the whole sketch", this app's original single-profile behaviour —
   * set from `PropertyManager.tsx`'s "Profile Regions" picker once a sketch has more than
   * one closed contour to choose from.
   */
  profileEntityIds?: string[];
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

/** Every direction a standard view can look from — `"front"` plus the other six a
 * Projected View can add (the five remaining axis-aligned directions, and `"iso"`'s own
 * conventional (1,-1,1) corner). All seven are associated to whichever one is `"front"`
 * for layout purposes — see `commands/drawingViewLayout.ts`'s `repositionStandardViews`,
 * which is what re-derives every placed one's sheet position from `front`'s own whenever a
 * view is added or the sheet's `projectionMethod` is toggled. */
export type StandardProjectionKind = "front" | "top" | "bottom" | "left" | "right" | "back" | "iso";

/** A placed view's own camera — identical to `StandardProjectionKind` today (a Section
 * view's camera, chosen by `kernel/drawingProjection.ts`'s `sectionViewCamera` to look
 * straight at the newly exposed cut face, always lands on one of that same axis-aligned
 * set). Kept as its own alias since a view's *camera* and a view's *place in the standard
 * six-view layout* are conceptually different things that only happen to share one set of
 * values right now. */
export type DrawingProjectionKind = StandardProjectionKind;

/**
 * One placed view on a Drawing sheet.
 *
 * `visiblePaths`/`hiddenPaths`/`width`/`height` are a cache of the last projection, not
 * live geometry — a Drawing document has no feature history of its own to rebuild from
 * (see `DrawingSheetData`'s own doc comment), so these are what makes a saved-and-reopened
 * drawing show its views immediately rather than needing `sourcePart` re-read first. The
 * "Update View" command (`kernel/drawingProjection.ts`'s `rebuildAndProjectPart`) is what
 * refreshes this cache after the referenced part changes.
 */
/** A standard view is a plain projection; a section view is a standard view's projection
 * kind but of a solid that's been cut first (`section` carries the cut); a detail view
 * isn't projected from the solid at all — it's a magnified crop of another view's own
 * already-cached paths (`detailOf`). */
export type DrawingViewKind = "standard" | "section" | "detail";

/**
 * The Hole Wizard facts a Drawing Hole Callout needs, snapshotted at projection time.
 *
 * Kept structured rather than as the final displayed sentence so the renderer can localise
 * "THRU"/"CEZ" and the thread-depth labels without rewriting a saved drawing, and so a
 * later formatter can improve the standard wording without a document migration. Values
 * intentionally describe the *whole* hole feature (for example `holeDepth` is the drilled
 * depth, while `threadDepth` is the possibly shorter cosmetic-thread engagement), not just
 * whichever circular edge the user happened to pick.
 */
export interface DrawingHoleCalloutMetadata {
  /** Stable id of the source Hole feature this metadata was captured from. */
  sourceFeatureId: string;
  holeType: NonNullable<FeatureParameters["holeType"]>;
  /** Final cut diameter in mm — the clearance/simple-hole diameter, or a tapped hole's tap
   * drill diameter (the kernel only models the drilled cylinder, never thread crests). */
  diameter: number;
  /** Literal drilled depth in mm. For `endCondition: "through-all"` this is only the
   * user-entered reference value; the callout displays THRU instead of treating the
   * kernel's deliberately oversized cut as a real depth. */
  holeDepth: number;
  endCondition: EndCondition;
  /** Tapped/taper-tapped: the bare thread designation (e.g. "M6×1"), with any class
   * suffix carried separately in `threadClass`. Clearance: the nominal fastener size. */
  designation?: string;
  holeStandard?: string;
  holeSize?: string;
  holeFit?: FeatureParameters["holeFit"];
  /** Internal thread class from the selected standard row (e.g. "6H"/"2B"). */
  threadClass?: string;
  threadDirection?: FeatureParameters["threadDirection"];
  fullDepthThread?: boolean;
  threadDepth?: number;
  /** The counterbore/spotface/countersink recess the kernel stacked above the hole, if
   * any — snapshotted from the feature's own seat fields so the callout can spell the seat
   * out (ISO 15786's ⌴/⌵ lines) rather than report only the drilled cylinder beneath it.
   * Absent means "no seat", matching the feature. */
  seatType?: FeatureParameters["seatType"];
  seatDiameter?: number;
  seatDepthOrAngle?: number;
}

/** One projected circular Hole Wizard edge a Hole Callout pick can snap to — cached with
 * the view, in the same unscaled raw projection coordinates as `visiblePaths`. */
export interface DrawingHoleTargetData {
  id: string;
  cx: number;
  cy: number;
  radius: number;
  metadata: DrawingHoleCalloutMetadata;
}

/** A standards-aware, leadered hole note — `annotation.hole-callout`'s own data. */
export interface DrawingHoleCalloutData {
  id: string;
  /** Which placed view this callout is bound to — always set by the picker, because a
   * callout is only created from a projected hole edge. */
  parentViewId?: string;
  /** The cached `DrawingHoleTargetData.id` it was created from — diagnostic/traceability
   * only; the callout keeps a full metadata snapshot so it still renders after the source
   * part changes or its views are refreshed. */
  sourceTargetId: string;
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
  metadata: DrawingHoleCalloutMetadata;
}

/**
 * A leadered/measured annotation (dimension, ordinate chain, datum, GD&T frame, surface
 * finish, weld) can carry `parentViewId`, pointing at one of `DrawingSheetData.views` —
 * `DrawingSheet.tsx`'s own "bound annotations" feature. An annotation gets bound two ways:
 * automatically, the instant its anchor snaps to a specific placed view's own geometry
 * (`kernel/drawingGeometry.ts`'s `nearestVertex` already reports which view a snapped
 * vertex belongs to); or, for an annotation placed in free space with nothing to snap to,
 * by whichever view is currently "active" (double-click a view's frame to activate it,
 * double-click empty sheet to clear) at the moment it's created. A bound annotation moves
 * with its view — `documentStore.ts`'s `moveDrawingView` shifts every annotation whose
 * `parentViewId` matches by the same delta the view itself moved by, rather than the plain
 * `updateDrawingView` every other view-position write still uses. An unbound annotation
 * (no active view, no snap) stays exactly where every annotation always has: independent,
 * fixed-position sheet coordinates.
 */
export interface DrawingViewData {
  id: string;
  label: string;
  projection: DrawingProjectionKind;
  /** Sheet position (mm) of this view's own bounding-box centre. Freely draggable — see
   * `documentStore.ts`'s `updateDrawingView`. */
  x: number;
  y: number;
  /** 1 = full size. */
  scale: number;
  /** SVG path `d` strings for edges visible from this projection. */
  visiblePaths: string[];
  /** SVG path `d` strings for edges hidden behind the solid from this projection, drawn dashed. */
  hiddenPaths: string[];
  /** Projected bounding box (mm, before `scale`) shared by `visiblePaths`/`hiddenPaths`. */
  width: number;
  height: number;
  /** World-space coordinate (in the source part's own camera-projected basis — see
   * `kernel/drawingProjection.ts`'s `projectOne`) that `visiblePaths`/`hiddenPaths` were
   * shifted by to land at (0, 0). Optional/defaults to (0, 0) for a view cached before this
   * existed — only matters for placing a Section view's cut line in world space, so an
   * absent value just means "don't offer a section cut from this view" in practice. */
  originX?: number;
  originY?: number;
  /** Section view only: SVG path `d` strings for the newly exposed cut face(s)' own
   * outline, filled with a hatch pattern per ISO 128-3 — see
   * `kernel/drawingProjection.ts`'s `SectionGeometry`. */
  hatchPaths?: string[];
  /** ISO 6410's own thin, 3/4-broken thread-major-diameter circles — one per tapped hole
   * this view happens to show end-on, computed once at projection time alongside
   * `visiblePaths`/`hiddenPaths` (see `kernel/drawingProjection.ts`'s `threadOverlaysFor`).
   * Absent/empty means either no tapped holes, or none of them viewed down their own axis. */
  threadPaths?: string[];
  /** Projected circular edges known to belong to Hole Wizard features — the picking cache
   * behind `annotation.hole-callout`. Computed alongside `threadPaths` and stored with the
   * view so a saved-and-reopened drawing can place a callout without first re-reading its
   * referenced part. */
  holeTargets?: DrawingHoleTargetData[];
  /** Absent for a `"standard"` view — see `DrawingViewKind`'s own doc comment. */
  kind?: DrawingViewKind;
  /** Section view only: the world-space cut plane used to produce it, plus enough of the
   * *source* view's own picking state to draw the ISO 128 cutting-plane line (with its
   * direction arrows and `letter-letter` label, e.g. "A-A") back onto that source view —
   * `sourceViewId` says which view to draw it on, `orientation`/`localScreenPosition` are
   * exactly the values `SectionOverlay.tsx` captured when the line was picked (the same
   * source-view-local, unscaled coordinate space `kernel/drawingGeometry.ts`'s
   * `viewVertices` uses), and `letter` is this section's own sequential designation
   * (A-A, B-B, C-C, …, one shared with the new section view's own "SECTION A-A" label).
   * `keepPositiveSide` false keeps material on the axis's negative side instead
   * (`drawing.section`'s "flip" toggle). */
  section?: {
    axis: "x" | "y" | "z";
    offset: number;
    keepPositiveSide: boolean;
    sourceViewId: string;
    orientation: "horizontal" | "vertical";
    localScreenPosition: number;
    letter: string;
  };
  /** Detail view only: which view it was cropped from and the circular region (in that
   * source view's own rendered screen-space, unscaled) it magnifies. `sourceHeight` is the
   * source view's own `height` at the moment of cropping, needed to replay the same Y-flip
   * transform `View` applies to every view's cached (Y-up) paths. The same `sourceViewId`/
   * `cx`/`cy`/`radius` also drive the matching boundary circle + leadered letter callout
   * drawn back onto the source view — see `DrawingSheet.tsx`'s `DetailCalloutView`. */
  detailOf?: { sourceViewId: string; cx: number; cy: number; radius: number; sourceHeight: number };
}

/** A freeform text annotation placed directly on the sheet (not attached to a view) —
 * `annotation.note`'s own data. Position is the text's top-left corner, sheet mm. */
export interface DrawingNoteData {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

/**
 * A dimension measured directly on a placed view's own projected geometry — distinct from a
 * sketch dimension (`sketch/types.ts`'s `Dimension`), which drives constraint-solved 2D
 * geometry; this one is read-only annotation over an already-projected, already-final view,
 * the same distinction a sketch's own construction-time dimensions have from a drawing's
 * documentation-time ones in every mainstream CAD tool.
 *
 * `x1,y1`/`x2,y2` are both sheet mm, snapped from the picked view's own projected vertices
 * (see `kernel/drawingGeometry.ts`'s `nearestVertex`) at the moment the dimension was
 * created — not live-linked to the view, so dragging/rescaling a view afterward leaves an
 * existing dimension where it was measured, matching how a Model View's own cached
 * `visiblePaths` already work (`DrawingViewData`'s own doc comment).
 */
export interface DrawingDimensionData {
  id: string;
  /** Which placed view this dimension is bound to, if any — see `DrawingViewData`'s own
   * "bound annotations" doc comment for how this gets set and what it does. */
  parentViewId?: string;
  /** "linear" is a free aligned distance; "horizontal"/"vertical" project onto one axis
   * only — auto-picked from how the two points relate when the dimension was created
   * (see `commands/drawingCommands.ts`'s `runPickDimensionPoint`). */
  kind: "linear" | "horizontal" | "vertical";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The real-world distance this dimension reports, already divided by the source view's
   * own `scale` — a dimension on a 2:1 detail view still reads the part's actual size, not
   * the enlarged on-paper one. */
  value: number;
  /** Offset of the dimension line/label from the two points' own midpoint, sheet mm —
   * draggable, the same "user can always declutter a crowded drawing" convention every
   * other placed element here already follows. */
  offsetX: number;
  offsetY: number;
  /** How the tolerance is displayed next to `value` — absent/"none" means a plain nominal,
   * matching every dimension placed before this existed. "symmetric" shows one ± value;
   * "deviation" shows independent +upper/-lower deviations stacked to the right of the
   * nominal; "limits" replaces the nominal entirely with the two computed limit values
   * stacked (upper over lower); "basic" boxes the plain nominal (ASME Y14.5's "theoretically
   * exact" convention, no tolerance shown at all — the frame *is* the callout); "fit" appends
   * an ISO 286 class designation after the nominal. */
  toleranceMode?: "none" | "symmetric" | "deviation" | "limits" | "basic" | "fit";
  /** Symmetric: the single ± value (always shown positive). Deviation/Limits: the upper
   * (over-nominal) deviation, signed — almost always ≥ 0 but not required to be. */
  toleranceUpper?: number;
  /** Deviation/Limits only: the lower (under-nominal) deviation, signed (e.g. -0.05) —
   * stored as a deviation from `value`, not an absolute limit, so it reads the same way a
   * caliper or a drawing's own tolerance block already specifies a bilateral tolerance. */
  toleranceLower?: number;
  /** Fit mode only: the ISO 286 hole/shaft class typed after the nominal, e.g. "H7" or
   * "g6". This app has no ISO 286 grade/deviation table to compute actual limits from, so a
   * Fit dimension shows the same designation a machinist would look up themselves — the
   * information every other CAD package's own "Fit" tolerance type shows before it also
   * happens to have that table wired in. */
  fitClass?: string;
}

/** Ordinate dimensions sharing one datum/zero point — `annotation.ordinate`'s own data.
 * Unlike `DrawingDimensionData`, every entry in one chain measures from the same
 * `datumX`/`datumY`, which is what keeps them visually and numerically consistent as a set
 * (adding a fourth ordinate to an existing chain doesn't need touching the first three). */
export interface DrawingOrdinateChainData {
  id: string;
  /** Which placed view this chain is bound to, if any — see `DrawingViewData`'s own
   * "bound annotations" doc comment. */
  parentViewId?: string;
  axis: "x" | "y";
  datumX: number;
  datumY: number;
  /** Each further point in the chain, sheet mm — `value` is that point's real-world offset
   * from the datum along `axis`, already divided by the source view's `scale`. */
  points: { id: string; x: number; y: number; value: number }[];
}

/** A datum feature symbol (boxed letter + filled triangle) with a leader to the feature it
 * references — GD&T's own "named reference surface/point" convention (ASME Y14.5). */
export interface DrawingDatumData {
  id: string;
  /** Which placed view this datum is bound to, if any — see `DrawingViewData`'s own
   * "bound annotations" doc comment. */
  parentViewId?: string;
  letter: string;
  /** Leader tip, sheet mm — snapped to the referenced feature's own geometry. */
  anchorX: number;
  anchorY: number;
  /** The boxed-letter symbol's own position, sheet mm — draggable independently of the
   * anchor, the same "leader stays put, label moves" convention `SketchDimensions.tsx`'s
   * own leader/label split already uses. */
  labelX: number;
  labelY: number;
}

/** ASME Y14.5's full geometric characteristic table, minus profile-of-a-line/surface's own
 * rarely-distinguished-in-practice pair being the only prior omission — now included too. */
export type GdtSymbol =
  | "position"
  | "flatness"
  | "straightness"
  | "circularity"
  | "cylindricity"
  | "perpendicularity"
  | "parallelism"
  | "angularity"
  | "runout"
  | "total-runout"
  | "concentricity"
  | "symmetry"
  | "profile-line"
  | "profile-surface";

/** A material-condition modifier on a feature control frame's tolerance or a datum
 * reference, ASME Y14.5's own circled-letter symbols — absent means RFS (regardless of
 * feature size), the default that needs no symbol at all. */
export type GdtModifier = "MMC" | "LMC";

/** One datum reference in a feature control frame's third compartment (or beyond, for a
 * multi-datum frame) — a bare letter, e.g. "A", plus its own optional material modifier. */
export interface GdtDatumReference {
  letter: string;
  modifier?: GdtModifier;
}

/** A GD&T feature control frame — symbol, tolerance value and up to three datum
 * references, with a leader to the feature it constrains. */
export interface DrawingGdtData {
  id: string;
  /** Which placed view this frame is bound to, if any — see `DrawingViewData`'s own
   * "bound annotations" doc comment. */
  parentViewId?: string;
  symbol: GdtSymbol;
  /** Tolerance value in mm, as typed (e.g. "0.05") — kept as free text since a real callout
   * can carry extra qualifiers a bare number can't (this app's own `diameter`/`modifier`
   * fields below cover the two most common of those; anything else can still be typed
   * straight into this field the way it always could). */
  tolerance: string;
  /** Prefixes `tolerance` with ⌀ — a cylindrical tolerance zone (position on a hole/pin,
   * the single most common reason for this), rather than the default planar/linear zone. */
  diameter?: boolean;
  /** The tolerance's own material-condition modifier (e.g. "⌀0.1 Ⓜ"). */
  modifier?: GdtModifier;
  /** Datum letters this frame references, in precedence order, e.g. ["A", "B"] — empty for
   * a form tolerance (flatness/straightness/circularity/cylindricity), which has none.
   * @deprecated superseded by `datumRefs`, which also carries each one's own modifier;
   * kept so a frame saved before `datumRefs` existed still has *a* value to migrate from
   * (`documentStore.ts`'s `addDrawingGdt`/`updateDrawingGdt` keep both in sync). */
  datums: string[];
  /** Same references as `datums`, each with its own optional material modifier — what every
   * reader/writer added after this field existed actually uses. */
  datumRefs?: GdtDatumReference[];
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
}

/** ISO 21920-1's three base symbol shapes: a bare open tick (any manufacturing process), the
 * same tick with a bar across its long leg (material removal by machining is required), or
 * the tick with a circle at its vertex (material removal is *not* permitted — e.g. a
 * cast/forged surface left as-is). */
export type SurfaceFinishSymbolType = "basic" | "machining-required" | "machining-prohibited";

/** ISO 21920-1's lay-direction symbols (the dominant direction of the surface pattern left by
 * machining), position "d" in the standard's own lettered-position layout. */
export type SurfaceLaySymbol = "=" | "⊥" | "X" | "M" | "C" | "R" | "P";

/** An ISO 21920-1 surface finish (roughness) symbol with a leader — `annotation.surface-finish`'s
 * own data. `roughness` is free text (e.g. "Ra 1.6", "3.2", or blank for "any process"). */
export interface DrawingSurfaceFinishData {
  id: string;
  /** Which placed view this symbol is bound to, if any — see `DrawingViewData`'s own
   * "bound annotations" doc comment. */
  parentViewId?: string;
  roughness: string;
  /** Absent/"basic" matches every symbol placed before this field existed. */
  symbolType?: SurfaceFinishSymbolType;
  /** A small circle at the symbol's own vertex — this requirement applies to every surface
   * visible in the view's outline, not just the one surface the leader points at. */
  allAround?: boolean;
  /** Manufacturing process/heat treatment text along the symbol's long leg (ISO 21920-1
   * position "b"), e.g. "TURNED", "GROUND", "ANODIZED". */
  manufacturingMethod?: string;
  laySymbol?: SurfaceLaySymbol;
  /** Machining allowance in mm (ISO 21920-1 position "e") — stock left for a later finishing
   * pass, shown to the left of the symbol's own vertex. */
  allowance?: string;
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
}

/** One weld symbol type ISO 2553 / AWS A2.4 both define a dedicated glyph for — the subset
 * covering the joint types this app's own users actually draw, not the full standard's
 * much longer table (e.g. stud, edge-flange and scarf welds are left out). */
export type WeldSymbolType =
  | "fillet"
  | "square"
  | "v-groove"
  | "bevel-groove"
  | "u-groove"
  | "j-groove"
  | "flare-v"
  | "flare-bevel"
  | "plug"
  | "spot"
  | "seam"
  | "backing"
  | "surfacing";

/** One side (arrow side or other side) of a weld callout — a symbol plus the numbers that
 * qualify it. Absent fields render blank, the same "nothing to say yet" convention every
 * other free-text annotation field here already follows. */
export interface WeldSideData {
  symbol: WeldSymbolType;
  /** Leg size (fillet) or groove depth (groove types), mm, shown left of the symbol. */
  size?: string;
  /** Included angle, groove types only, shown above the symbol's own opening. */
  angle?: string;
  /** Weld length, shown right of the symbol — an intermittent weld's own "N mm" segment. */
  length?: string;
  /** Centre-to-centre spacing for an intermittent weld, shown after `length` as "length-pitch". */
  pitch?: string;
  /** Final contour of the finished weld face — flat/convex/concave add their own small
   * straight/arc line on top of the base symbol; absent means "as welded", no extra mark. */
  contour?: "flat" | "convex" | "concave";
}

/**
 * An ISO 2553 / AWS A2.4 weld symbol — a leader from the joint to a bend point, then a
 * horizontal reference line carrying the actual callout. Arrow-side information sits below
 * the reference line and other-side information above it (or the reverse, mirrored, if the
 * reference line runs to the *left* of the bend) — the standard's own "which side of the
 * line matches which side of the joint" convention, which is what actually lets a welder
 * standing at the arrow tell arrow-side and other-side apart without extra text.
 */
export interface DrawingWeldData {
  id: string;
  /** Which placed view this weld symbol is bound to, if any — see `DrawingViewData`'s own
   * "bound annotations" doc comment. */
  parentViewId?: string;
  /** Leader tip — the joint being called out, sheet mm, snapped to a placed view's own
   * projected geometry the same way every other leadered annotation here snaps. */
  anchorX: number;
  anchorY: number;
  /** The reference line's own left endpoint, sheet mm — draggable independently of the
   * anchor, the same "leader stays put, label moves" split every other leadered symbol here
   * already uses. */
  labelX: number;
  labelY: number;
  /** At least one of the two is set; both set means a weld on both sides of the joint. */
  arrowSide: WeldSideData | null;
  otherSide: WeldSideData | null;
  /** A small circle at the leader/reference-line bend — this weld goes all around the joint. */
  allAround: boolean;
  /** A small flag at the bend — a field weld, made on site rather than in the shop. */
  fieldWeld: boolean;
  /** Free text in the reference line's own tail (its right end) — process/spec reference,
   * e.g. "GMAW" or a welding procedure specification number. */
  tail?: string;
}

/** A table inserted onto the sheet — `table.bom`/`table.hole`'s own data. `rows[0]` is
 * always the header; every cell is already-formatted display text (not live-linked back to
 * the part, the same "snapshot at insert time" convention `DrawingViewData`'s cached paths
 * already use — re-run the command to refresh after the part changes). */
export interface DrawingTableData {
  id: string;
  kind: "bom" | "hole";
  title: string;
  /** Top-left corner, sheet mm. */
  x: number;
  y: number;
  rows: string[][];
}

/**
 * A Drawing document's sheet: which part it shows views of, and the views themselves.
 *
 * Unlike a Part (`Feature[]` replayed by `kernel/rebuild.ts`), a Drawing has no history of
 * its own to rebuild — it references another document's saved file the way a SolidWorks
 * drawing references a `.sldprt` on disk, rather than embedding that part's own feature
 * history. `sourcePart.path` is only ever populated under Tauri (a real filesystem path);
 * in the browser dev build there is no reusable file handle, so `path` stays null and
 * "Update View" falls back to re-prompting with the file picker — see `io/files.ts`.
 */
/** ISO 128-30's two projection conventions — which quadrant the object is imagined to sit
 * in relative to the projection planes, which is what decides whether the Top view lands
 * above or below Front, and Right lands beside or across from it. "ISO-E" (1st quadrant,
 * "evrópske uspořádání pohledů"/European arrangement) is this app's own default, matching
 * the convention most of its users' drawings are expected to follow; "ISO-A" (3rd quadrant,
 * American arrangement) is the alternative, selected per-document. Absent means "ISO-E",
 * for a Drawing saved before this field existed. */
export type ProjectionMethod = "ISO-E" | "ISO-A";

/**
 * A snapshot of the referenced part file — last-modified time and size — taken the moment
 * the sheet's views were last projected from it. The drawing's own "are these views still
 * current?" question is answered by comparing this stamp against a fresh stat of
 * `DrawingSheetData.sourcePart.path` (`kernel/drawingStaleness.ts`'s `viewsAreStale`): a
 * match means the file hasn't changed since the projection, a mismatch means the views
 * are stale and "Update Views" should re-project. Optional so a Drawing saved before this
 * existed still loads — and deliberately *absent* means "unknown", never "stale", so an
 * old drawing (or one whose part path can't be stat'd this session — unblessed paths
 * aren't readable, see `io/files.ts`'s `statAtPath`) never gets a false out-of-date alarm.
 */
export interface DrawingSourceStamp {
  /** File last-modified time, milliseconds since the Unix epoch. */
  modifiedMs: number;
  /** File size in bytes — a cheap second signal that catches a same-tick rewrite. */
  size: number;
}

export interface DrawingSheetData {
  sourcePart: { fileName: string; path: string | null } | null;
  /**
   * Stamped when `sourcePart`'s views were last projected — see `DrawingSourceStamp`'s
   * own doc comment. Only ever set by Insert Model View / Update Views, alongside the
   * projection cache they write.
   */
  sourceStamp?: DrawingSourceStamp;
  /**
   * A content hash (`kernel/rebuildCache.ts`'s `contentHash`) of the exact part file bytes
   * the current view cache was projected from — the *exact* counterpart to `sourceStamp`'s
   * cheap approximation.
   *
   * The two exist for different jobs. `sourceStamp` answers "might the part have changed?"
   * from a stat alone, cheap enough to run on every window focus, which is what the amber
   * out-of-date indicator needs. This hash answers "would re-projecting actually produce
   * different geometry?" exactly, and Update Views uses it to skip the part rebuild — by
   * far the most expensive step (measured at roughly 70% of the command on a 64-hole
   * plate) — when the answer is no. Computing it costs a file read the command already
   * performs, so the check is free where the stamp would have to guess.
   *
   * Optional/absent means "unknown": a drawing saved before this existed simply re-projects
   * as it always did, never skipping on a hash it doesn't have.
   */
  sourceContentHash?: string;
  views: DrawingViewData[];
  /** Absent means `"ISO-E"` — see `ProjectionMethod`'s own doc comment. Toggling this
   * re-lays out every placed `"standard"` view (see `commands/drawingViewLayout.ts`'s
   * `repositionStandardViews`) and is what the title block's projection-method symbol cell
   * both displays and, on click, toggles. */
  projectionMethod?: ProjectionMethod;
  /** Which `SheetFormat` (from `state/templateStore.ts`'s library) this sheet uses — the
   * paper size/orientation and which Border/Title Block templates draw around the views.
   * Optional so a Drawing saved before Drawing Resources existed still loads: absent means
   * `templateStore.ts`'s `DEFAULT_SHEET_FORMAT_ID`. */
  sheetFormatId?: string;
  /** Per-document values for the chosen title block's fields, keyed by `TitleBlockField.key`
   * — e.g. `{ title: "Bracket", scale: "1:2" }`. A field with no entry here renders blank,
   * never a placeholder like a name or date filled in on the user's behalf. */
  titleBlockValues?: Record<string, string>;
  /** Freeform text notes on the sheet — optional/absent means none yet. */
  notes?: DrawingNoteData[];
  /** All optional/absent-means-none-yet, the same reasoning as `notes` above. */
  dimensions?: DrawingDimensionData[];
  ordinateChains?: DrawingOrdinateChainData[];
  datums?: DrawingDatumData[];
  gdtFrames?: DrawingGdtData[];
  surfaceFinishes?: DrawingSurfaceFinishData[];
  welds?: DrawingWeldData[];
  /** Hole Wizard callouts picked from a view's cached `holeTargets`. */
  holeCallouts?: DrawingHoleCalloutData[];
  tables?: DrawingTableData[];
}

/** A named number, referenced from a sketch dimension's value field as `=name` (see
 * `state/equations.ts`) — Inspect ▸ Equations' own data. Optional so a document saved
 * before this existed still loads: every reader treats a missing map as empty rather than
 * requiring a migration. */
export type Variables = Record<string, number>;

export type SensorProperty = "volume" | "area";
export type SensorOperator = "lt" | "gt" | "eq";

/** A watched property + threshold, evaluated on every rebuild by Inspect ▸ Sensors —
 * `lastStatus` is only ever set by that evaluation, never edited directly, and drives the
 * "flipped since last time" check that fires a toast on a fresh alert rather than on every
 * rebuild the sensor happens to already be failing. */
export interface Sensor {
  id: string;
  name: string;
  property: SensorProperty;
  operator: SensorOperator;
  threshold: number;
  lastStatus: "ok" | "alert" | null;
}

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
  /** See `Variables`'s own doc comment. Optional — absent on documents saved before
   * Inspect ▸ Equations existed. */
  variables?: Variables;
  /** Inspect ▸ Sensors' watch list. Optional for the same reason as `variables`. */
  sensors?: Sensor[];
  /** Present only when `kind === "drawing"` — see `DrawingSheetData`'s own doc comment. */
  drawing?: DrawingSheetData;
}
