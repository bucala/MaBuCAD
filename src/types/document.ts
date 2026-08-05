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
   * drawn the full depth it computes, or a shorter engagement length — there is no real
   * modelled thread length to draw the exact figure from, so `false` just draws visibly
   * shorter rather than a second exact-but-fabricated measurement. Still display only; the
   * kernel doesn't read this either. */
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

/** The four standard views `drawing.model-view` places. */
export type StandardProjectionKind = "front" | "top" | "right" | "iso";

/**
 * A placed view's own camera — the four standard ones, plus the other three axis-aligned
 * directions (`"back"`/`"left"`/`"bottom"`) a Section view's camera can land on: it looks
 * straight at the newly exposed cut face rather than reusing its source view's own
 * direction — see `kernel/drawingProjection.ts`'s `sectionViewCamera`.
 */
export type DrawingProjectionKind = StandardProjectionKind | "back" | "left" | "bottom";

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
   * outline, filled with a hatch pattern per ISO 128-50 — see
   * `kernel/drawingProjection.ts`'s `SectionGeometry`. */
  hatchPaths?: string[];
  /** Absent for a `"standard"` view — see `DrawingViewKind`'s own doc comment. */
  kind?: DrawingViewKind;
  /** Section view only: the world-space cut plane used to produce it — a plane
   * perpendicular to one world axis, at a fixed offset along it. `keepPositiveSide` false
   * keeps material on the axis's negative side instead (`drawing.section`'s "flip" toggle). */
  section?: { axis: "x" | "y" | "z"; offset: number; keepPositiveSide: boolean };
  /** Detail view only: which view it was cropped from and the circular region (in that
   * source view's own rendered screen-space, unscaled) it magnifies. `sourceHeight` is the
   * source view's own `height` at the moment of cropping, needed to replay the same Y-flip
   * transform `View` applies to every view's cached (Y-up) paths. */
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
 * A Drawing document's sheet: which part it shows views of, and the views themselves.
 *
 * Unlike a Part (`Feature[]` replayed by `kernel/rebuild.ts`), a Drawing has no history of
 * its own to rebuild — it references another document's saved file the way a SolidWorks
 * drawing references a `.sldprt` on disk, rather than embedding that part's own feature
 * history. `sourcePart.path` is only ever populated under Tauri (a real filesystem path);
 * in the browser dev build there is no reusable file handle, so `path` stays null and
 * "Update View" falls back to re-prompting with the file picker — see `io/files.ts`.
 */
export interface DrawingSheetData {
  sourcePart: { fileName: string; path: string | null } | null;
  views: DrawingViewData[];
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
