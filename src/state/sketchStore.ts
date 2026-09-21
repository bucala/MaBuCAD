import { create } from "zustand";

import {
  addArc,
  addCircle,
  addConstraint,
  addDimension,
  addLine,
  addPoint,
  addRectangle,
  addSpline,
  createSketch,
  curveConstraintKind,
  defaultDimensionAnchor,
  entityById,
  entityPoints,
  filletCorner,
  hasClosedProfile,
  inferDragSnap,
  inferSmartDimension,
  measure,
  mirrorEntities,
  offsetEntities,
  originPointId,
  patternEntities,
  roundDimensionValue,
  pointById,
  trimEntitiesInWindow,
  trimEntityAt,
} from "@/sketch/sketchModel";
import type { DragSnapSuggestion, PatternOptions } from "@/sketch/sketchModel";
import { findConflictingConstraints, sketchStatusFromDiagnostics, solveSketch } from "@/sketch/solver";
import type { SolveOutcome } from "@/sketch/solver";
import type {
  DimensionKind,
  GeometricConstraintKind,
  Sketch,
  SketchDiagnostics,
} from "@/sketch/types";
import { useGeometryStore } from "@/state/geometryStore";
import { useSettingsStore } from "@/state/settingsStore";
import type { SketchStatus } from "@/types/ui";

/** Tools available while a sketch is open. */
export type SketchTool =
  | "select"
  | "line"
  | "rectangle"
  | "circle"
  | "spline"
  | "construction-line"
  | "axis-line"
  | "point"
  | "arc"
  | "trim"
  | "fillet"
  | "smart-dimension";

const IDLE_DIAGNOSTICS: SketchDiagnostics = {
  dof: 0,
  converged: true,
  redundant: false,
  residualNorm: 0,
  iterations: 0,
};

/** Matches `documentStore.ts`'s own cap — same "last 30 steps" budget, applied here too
 * since sketch edits (draw, constrain, dimension) get their own history, separate from
 * the document's feature history. */
const SKETCH_HISTORY_LIMIT = 30;

/**
 * Minimum spacing between `findConflictingConstraints` scans during a live point drag.
 * While a sketch is over-defined, that search re-solves the whole system once per
 * constraint — fine for a discrete edit, but O(constraints × solves) per pointermove when
 * `dragPoint` ran it on every move. The red conflict highlighting it produces doesn't
 * meaningfully change within a gesture, so it is deferred to this cadence mid-drag and
 * flushed the instant the drag ends (`commitDragSnap`).
 */
const DRAG_CONFLICT_SCAN_MS = 150;

/** Throttle state for `scheduleConflictScan` — module-level because it belongs to the
 * gesture, not to the store instance, and must survive across store re-creations in
 * tests exactly the way it survives across the app's single instance in production. */
let conflictScanTimer: ReturnType<typeof setTimeout> | null = null;
let conflictScanPending: Sketch | null = null;

/**
 * A Smart Dimension proposal that hasn't been committed to the sketch yet — the
 * Inventor-style flow this drives: picking one entity proposes this and it follows the
 * cursor (`hoverPosition` below) rather than landing immediately; picking a second,
 * compatible entity re-infers it (e.g. a second non-parallel line turns a length
 * proposal into an angle one); a click on empty sketch space commits it wherever that
 * click landed. Escape, `deleteSelection`, or leaving the tool discards it.
 */
interface PendingDimension {
  kind: DimensionKind;
  points: string[];
  entities: string[];
  value: number;
  /** See `inferSmartDimension`'s own doc comment on the same field — carried through so
   * `commitPendingDimension` can add the pair's Parallel constraint alongside the
   * dimension itself once the user clicks to place it. */
  alsoConstrainParallel?: [string, string];
}

interface SketchStore {
  /** Feature id of the sketch being edited, or null outside sketch mode. */
  activeSketchId: string | null;
  sketches: Record<string, Sketch>;
  diagnostics: SketchDiagnostics;
  /** Constraint/dimension ids `findConflictingConstraints` found responsible for the
   * current over-defined state — empty whenever the sketch isn't over-defined. Drives the
   * error-red highlighting on their own glyphs (`SketchConstraintGlyphs.tsx`) and on the
   * sketch contours they touch (`SketchGeometry.tsx`). */
  conflictingIds: string[];
  /** Entity ids the solve's freedom analysis (`solveSketch`'s `underDefinedEntityIds`)
   * found still movable — the blue of the classic CAD blue/black sketch colouring that
   * SolidWorks, Fusion and Onshape all document, where fully-defined geometry renders
   * black (near-white in the dark theme). Kept beside `diagnostics` because both come out
   * of the same solve; arrays rather than the solver's Sets so the store stays
   * plain-data. */
  underDefinedEntityIds: string[];
  /** Point ids (endpoints, centres, standalone) whose own x/y can still move — the point
   * dots join the entity strokes in the same blue/black convention. */
  underDefinedPointIds: string[];
  tool: SketchTool;
  /** Entity and point ids selected inside the sketch. */
  selection: string[];
  /**
   * Screen position of an open right-click menu, or null when it is closed.
   *
   * Lives here rather than as local state in the component that opens it
   * (`SketchCanvas`, which renders inside the react-three-fiber `<Canvas>`) because the
   * menu itself has to render as a plain DOM overlay outside that canvas — react-dom's
   * `createPortal` does not safely cross out of r3f's own reconciler, so the store is
   * what lets a component outside the canvas see this state.
   */
  contextMenu: { x: number; y: number } | null;

  /** An uncommitted Smart Dimension proposal, or null. See `PendingDimension`'s own doc
   * comment. */
  pendingDimension: PendingDimension | null;
  /**
   * A relation button clicked with no selection (or an incomplete one) yet to satisfy it —
   * `null` means no relation is waiting on picks. Set by `armConstraint`, consumed by
   * `pickForConstraint` as the viewport is clicked, same "arm then accumulate picks" shape
   * `pendingDimension` already uses for Smart Dimension. Lets "click the relation, then
   * pick elements" work as well as the original "select elements, then click the
   * relation" — `armConstraint` tries applying immediately first and only arms this if
   * the current selection doesn't already satisfy the relation.
   */
  pendingConstraintKind: GeometricConstraintKind | null;
  /** Radius the Fillet tool applies to the next corner it picks — set from the Sketch
   * panel's own numeric field, read by `pickForFillet` at the moment a second line
   * completes a pick. Lives here (rather than as a one-shot argument) so it survives
   * between picks the same way `pendingConstraintKind` does. */
  filletRadius: number;
  /** The first line picked toward a Fillet while `tool === "fillet"`, or null — same
   * "arm then accumulate picks" shape as `pendingConstraintKind`, but for a tool rather
   * than a relation, since a fillet also needs the numeric radius above. */
  pendingFilletLineId: string | null;
  /** "Constrains smart" — a relation the point currently being dragged is close enough
   * to for `commitDragSnap` to apply on release. See `DragSnapSuggestion`'s own doc
   * comment in `sketchModel.ts`. */
  dragSnapSuggestion: DragSnapSuggestion | null;
  /** Live cursor position in sketch coordinates, kept live by `SketchCanvas.tsx`'s
   * pointer-move handler purely so a pending dimension's preview can follow it —
   * unrelated to the drawing tools' own local `cursor` state, which already does the
   * same tracking for their own rubber-band previews. */
  hoverPosition: Point2 | null;

  /** Undo history for the sketch currently being edited — reset on every entry into
   * sketch editing (`beginSketch`/`resumeSketch`) and on exit, so its scope is one
   * editing session rather than persisting across sketches. Separate from
   * `documentStore`'s own `past`/`future`: sketch geometry never lives in `CadDocument`
   * (see `sketches` above), so the document's history never captured these edits at all —
   * this is what actually makes Undo work for drawing and dimensioning. */
  past: Sketch[];
  future: Sketch[];

  beginSketch: (featureId: string, planeId: string) => void;
  resumeSketch: (featureId: string) => void;
  exitSketch: () => void;
  openContextMenu: (x: number, y: number) => void;
  closeContextMenu: () => void;

  /** Replaces every sketch — Open, New, loading a document that isn't the one whose
   * sketches are currently in memory. Also leaves sketch mode, since whatever sketch was
   * active belonged to the document being replaced. */
  loadSketches: (sketches: Record<string, Sketch>) => void;

  setTool: (tool: SketchTool) => void;
  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string, additive: boolean) => void;
  clearSelection: () => void;

  drawLine: (from: Point2, to: Point2, construction?: boolean, isAxis?: boolean) => void;
  drawRectangle: (corner: Point2, opposite: Point2) => void;
  drawCircle: (centre: Point2, radius: number) => void;
  drawSpline: (positions: Point2[]) => void;
  drawPoint: (position: Point2) => void;
  drawArc: (centre: Point2, start: Point2, end: Point2) => void;
  trimAt: (entityId: string, position: Point2) => void;
  /** Trims every entity fully enclosed by a dragged window in one go — see
   * `trimEntitiesInWindow`'s own doc comment for what "enclosed" means for a circle/arc. */
  trimWindowSelect: (minX: number, minY: number, maxX: number, maxY: number) => void;

  applyConstraint: (kind: GeometricConstraintKind) => boolean;
  /** Converts every currently selected line/circle/arc/spline to construction geometry, or
   * back to normal — see the implementation's own doc comment for which direction it picks
   * when the selection is a mix of both. Unlike the Line tool's construction/axis cycling
   * (which only decides a new entity's own flag at draw time), this is the only way to
   * change an *already-drawn* entity's construction status after the fact. */
  toggleConstruction: () => void;
  /** The "click the relation first" entry point: tries `applyConstraint(kind)` against
   * whatever is already selected, and only arms `pendingConstraintKind` (waiting on
   * `pickForConstraint`) if that selection doesn't already satisfy it. */
  armConstraint: (kind: GeometricConstraintKind) => void;
  /** Picks (or unpicks) `id` toward the armed `pendingConstraintKind`, applying it — and
   * clearing the arm — the moment the accumulated selection satisfies its shape. A no-op
   * with nothing armed. */
  pickForConstraint: (id: string) => void;
  /** Discards the current `pendingConstraintKind` without applying it — Escape, or
   * switching tools. */
  cancelPendingConstraint: () => void;
  setFilletRadius: (value: number) => void;
  /** Picks (or unpicks, on a repeat click) `id` toward the Fillet tool's two-line pick —
   * applies `filletCorner` with the current `filletRadius` the moment a second, distinct
   * line is picked, same accumulate-then-auto-apply shape as `pickForConstraint`. A no-op
   * for anything that isn't a line. */
  pickForFillet: (id: string) => void;
  mirrorSelection: () => boolean;
  offsetSelection: (distance: number) => boolean;
  patternSelection: (options: PatternOptions) => boolean;
  /** Picks (or accumulates picking) `id` toward a Smart Dimension proposal — see
   * `PendingDimension`'s own doc comment for the full flow. */
  pickForSmartDimension: (id: string) => void;
  /** Commits the current pending proposal into the sketch, with its label placed at
   * `position` (a click on empty sketch space while proposing — see `SketchCanvas.tsx`).
   * A no-op if nothing is pending. */
  commitPendingDimension: (position: Point2) => void;
  /** Discards the current pending proposal without creating a dimension — Escape, or
   * switching away from the Smart Dimension tool. */
  cancelPendingDimension: () => void;
  setHoverPosition: (position: Point2 | null) => void;
  applyOrdinateDimension: (axis: "both" | "x" | "y") => boolean;
  setDimensionValue: (dimensionId: string, value: number) => void;
  setDimensionLabelOffset: (dimensionId: string, offset: Point2) => void;
  deleteDimension: (dimensionId: string) => void;
  /** Radius <-> diameter on a circle/arc dimension, converting the driving value (2x or
   * /2) so the circle it drives doesn't jump size. A no-op for any other dimension kind. */
  toggleDimensionRadiusDiameter: (dimensionId: string) => void;
  /** Extends a radius/diameter dimension's leader line inward past its near-rim point to
   * the circle/arc's own centre — a no-op for any other dimension kind. */
  toggleRadiusExtendToCenter: (dimensionId: string) => void;
  /** Switches a linear (two-point) dimension between Aligned (`distance`, true point-to-point
   * length), Horizontal (`horizontal-distance`) and Vertical (`vertical-distance`) — a no-op
   * for any other dimension kind. Re-measures the value from the current geometry rather
   * than converting it algebraically, so it's exact regardless of the dimension's current mode. */
  setLinearDimensionMode: (dimensionId: string, mode: "distance" | "horizontal-distance" | "vertical-distance") => void;
  /** The other of the two angles two intersecting lines actually form (θ and its
   * supplement, 180-θ) — the two numerically distinct choices at that vertex; the other
   * two visual quadrants are one of these two values again, by vertical angles. A no-op
   * for any other dimension kind. */
  flipAngleDimension: (dimensionId: string) => void;

  /** Arms a point-drag (or dimension-label drag) gesture — the gesture's first *changing*
   * frame snapshots the pre-gesture sketch as the single undo entry for the whole drag, so
   * the intermediate `dragPoint`/`setDimensionLabelOffset` calls during the drag don't
   * each become their own step, and a press that never changes anything pushes nothing at
   * all. `commitDragSnap` ends a point-drag gesture; `endDrag` ends a label one. */
  beginDrag: () => void;
  /** Ends an armed drag gesture without applying anything — the dimension-label drag's
   * pointer-up. A point drag ends through `commitDragSnap` instead, which is guaranteed
   * to run on the gesture's release (see `SketchCanvas.tsx`'s `installDragRelease`). */
  endDrag: () => void;
  dragPoint: (pointId: string, position: Point2) => void;
  /** Applies the current `dragSnapSuggestion` (if any) for the point that was just
   * dragged, and clears it — called from `SketchCanvas.tsx`'s pointer-up, once the drag
   * gesture actually ends. A no-op with nothing suggested. */
  commitDragSnap: (pointId: string) => void;
  deleteSelection: () => void;

  undo: () => void;
  redo: () => void;
}

interface Point2 {
  x: number;
  y: number;
}

export const useSketchStore = create<SketchStore>((set, get) => {
  /** Snap radius in sketch units — Settings > Sketch > "Snap tolerance", previously a
   * hardcoded constant here. Read live (not destructured once) so a change while a sketch
   * is already open takes effect on the very next click rather than needing a re-entry. */
  const snapTolerance = () => useSettingsStore.getState().snapTolerance;

  /** Snapshots `sketch` onto the undo stack and clears redo — the same shape as
   * `documentStore.ts`'s `commit()`, kept separate because it caps a different history. */
  const pushHistory = (sketch: Sketch) => {
    set((state) => ({
      past: [...state.past, sketch].slice(-SKETCH_HISTORY_LIMIT),
      future: [],
    }));
  };

  /**
   * The pre-gesture sketch of a pointer-drag currently in progress (`beginDrag` until
   * `endDrag`/`commitDragSnap`), or null outside a gesture — see `beginDrag`'s doc
   * comment. Closure state, not store state: transient gesture bookkeeping nothing
   * renders, the same convention `documentStore.ts`'s own drag gesture follows.
   */
  let dragSnapshot: Sketch | null = null;
  /** Whether a pointer-drag gesture is currently in progress at all — stays true for the
   * whole gesture, unlike `dragSnapshot`, which the first *changing* frame consumes. */
  let inDragGesture = false;

  /**
   * The first *changing* mutation of a drag gesture consumes the gesture's pre-gesture
   * snapshot as its single history entry; the gesture's remaining frames apply without
   * one (`inDragGesture` stays true, `dragSnapshot` is already null by then). Arming is
   * lazy, so a press that never changes anything (a click on a fixed point, a label
   * grabbed and released without moving) leaves the history untouched — an eagerly
   * pushed snapshot would leave a duplicate of the current sketch on the stack, making
   * one undo step appear to do nothing.
   */
  const consumeDragSnapshot = () => {
    if (!dragSnapshot) return;
    pushHistory(dragSnapshot);
    dragSnapshot = null;
  };

  /** `findConflictingConstraints` is only worth its own (relatively expensive, O(n) solves)
   * cost when the sketch is actually over-defined — every other call site just wants `[]`. */
  const conflictsFor = (sketch: Sketch, diagnostics: SketchDiagnostics): string[] =>
    sketchStatusFromDiagnostics(diagnostics) === "over-defined" ? [...findConflictingConstraints(sketch)] : [];

  /** A solve outcome's freedom sets as store-ready arrays — every path that stores
   * `diagnostics` stores these beside it, since both describe the same solve. */
  const freedomOf = (
    outcome: SolveOutcome,
  ): Pick<SketchStore, "underDefinedEntityIds" | "underDefinedPointIds"> => ({
    underDefinedEntityIds: [...outcome.underDefinedEntityIds],
    underDefinedPointIds: [...outcome.underDefinedPointIds],
  });

  /**
   * `dragPoint`'s own `conflictsFor`, throttled: an over-defined sketch's brute-force
   * search would otherwise run once per pointermove, so mid-drag it is deferred to the
   * `DRAG_CONFLICT_SCAN_MS` cadence and the previous highlighting is kept until the scan
   * lands. Not over-defined returns `[]` immediately — the cheap path stays cheap.
   */
  const scheduleConflictScan = (sketch: Sketch, diagnostics: SketchDiagnostics): string[] => {
    if (sketchStatusFromDiagnostics(diagnostics) !== "over-defined") return [];
    conflictScanPending = sketch;
    if (conflictScanTimer === null) {
      conflictScanTimer = setTimeout(() => {
        conflictScanTimer = null;
        const pendingSketch = conflictScanPending;
        conflictScanPending = null;
        if (!pendingSketch) return;
        set({ conflictingIds: [...findConflictingConstraints(pendingSketch)] });
      }, DRAG_CONFLICT_SCAN_MS);
    }
    return get().conflictingIds;
  };

  /** Runs a deferred conflict scan (if one is pending) right now — the drag gesture's
   * end path (`commitDragSnap`), so the final highlighting matches the final geometry
   * immediately rather than a throttle tick later. */
  const flushConflictScan = (): void => {
    const pendingSketch = conflictScanPending;
    conflictScanPending = null;
    if (conflictScanTimer !== null) {
      clearTimeout(conflictScanTimer);
      conflictScanTimer = null;
    }
    if (!pendingSketch) return;
    set({ conflictingIds: [...findConflictingConstraints(pendingSketch)] });
  };

  /**
   * Applies an edit, re-solves, and stores both the geometry and the diagnostics.
   *
   * Gesture-aware: inside an armed drag gesture (`beginDrag` … `endDrag`/`commitDragSnap`)
   * the first *changing* edit consumes the gesture's pre-gesture snapshot as the single
   * history entry and the gesture's later edits apply without one; outside a gesture it
   * records the pre-edit sketch as always.
   */
  const edit = (mutate: (sketch: Sketch) => Sketch) => {
    const { activeSketchId, sketches } = get();
    if (!activeSketchId) return;

    const current = sketches[activeSketchId];
    if (!current) return;

    const mutated = mutate(current);
    // `current`, not `mutated`, anchors "fix"/"fix-line" — see `solveSketch`'s own doc
    // comment. Most edits never move an already-fixed point/entity, so this is a no-op for
    // them; the ones that do (a drag-snap moving a point straight to a target, a trim
    // reshaping a fixed line's endpoint) would otherwise have the mutation itself silently
    // become the new "anchor", defeating the fix the same way an uncorrected point drag did.
    const outcome = solveSketch(mutated, current);
    const { sketch, diagnostics } = outcome;
    if (sketch === current) return;

    if (inDragGesture) {
      consumeDragSnapshot();
    } else {
      pushHistory(current);
    }
    // `conflictsFor` re-solves with each constraint/dimension removed in turn to see which
    // one clears the conflict — and `solveSketch`'s own "fix" residual anchors to wherever
    // its point *currently* sits at the start of whichever solve is testing it. Feeding it
    // the already-solved (settled wherever the solver's monotone best-so-far left it
    // chasing an unsatisfiable residual) `sketch` would silently re-anchor every Fix to
    // that drifted position and often mask
    // the very conflict being diagnosed. `mutated` — the edit applied but not yet
    // re-solved — still has the points at their last good position, which is what every
    // one of `conflictsFor`'s internal solves needs to agree on.
    set({
      sketches: { ...sketches, [activeSketchId]: sketch },
      diagnostics,
      conflictingIds: conflictsFor(mutated, diagnostics),
      ...freedomOf(outcome),
    });
  };

  /** Splits the current selection into entity ids and point ids. */
  const partitionSelection = (sketch: Sketch) => {
    const { selection } = get();
    const entities = selection.filter((id) => entityById(sketch, id));
    const points = selection.filter((id) => pointById(sketch, id));
    return { entities, points };
  };

  return {
    activeSketchId: null,
    sketches: {},
    diagnostics: IDLE_DIAGNOSTICS,
    conflictingIds: [],
    underDefinedEntityIds: [],
    underDefinedPointIds: [],
    tool: "select",
    selection: [],
    contextMenu: null,
    pendingDimension: null,
    pendingConstraintKind: null,
    filletRadius: 5,
    pendingFilletLineId: null,
    dragSnapSuggestion: null,
    hoverPosition: null,
    past: [],
    future: [],

    openContextMenu: (x, y) => set({ contextMenu: { x, y } }),
    closeContextMenu: () => set({ contextMenu: null }),

    beginSketch: (featureId, planeId) => {
      const sketch = createSketch(featureId, planeId);
      const solved = solveSketch(sketch);

      // Entering a new editing session resets the history below — an armed gesture
      // belonging to the previous session must not survive into it.
      inDragGesture = false;
      dragSnapshot = null;
      set((state) => ({
        activeSketchId: featureId,
        sketches: { ...state.sketches, [featureId]: solved.sketch },
        diagnostics: solved.diagnostics,
        conflictingIds: [],
        ...freedomOf(solved),
        tool: "line",
        selection: [],
        contextMenu: null,
        pendingDimension: null,
        pendingConstraintKind: null,
        pendingFilletLineId: null,
        dragSnapSuggestion: null,
        hoverPosition: null,
        past: [],
        future: [],
      }));
    },

    resumeSketch: (featureId) => {
      const sketch = get().sketches[featureId];
      if (!sketch) return;
      const outcome = solveSketch(sketch);
      const diagnostics = outcome.diagnostics;
      inDragGesture = false;
      dragSnapshot = null;
      set({
        activeSketchId: featureId,
        diagnostics,
        conflictingIds: conflictsFor(sketch, diagnostics),
        ...freedomOf(outcome),
        tool: "select",
        selection: [],
        contextMenu: null,
        pendingDimension: null,
        pendingConstraintKind: null,
        pendingFilletLineId: null,
        dragSnapSuggestion: null,
        hoverPosition: null,
        past: [],
        future: [],
      });
    },

    exitSketch: () => {
      inDragGesture = false;
      dragSnapshot = null;
      set({
        activeSketchId: null,
        tool: "select",
        selection: [],
        diagnostics: IDLE_DIAGNOSTICS,
        conflictingIds: [],
        underDefinedEntityIds: [],
        underDefinedPointIds: [],
        contextMenu: null,
        pendingDimension: null,
        pendingConstraintKind: null,
        pendingFilletLineId: null,
        dragSnapSuggestion: null,
        hoverPosition: null,
        past: [],
        future: [],
      });
    },

    loadSketches: (sketches) => {
      inDragGesture = false;
      dragSnapshot = null;
      set({
        sketches,
        activeSketchId: null,
        tool: "select",
        selection: [],
        diagnostics: IDLE_DIAGNOSTICS,
        conflictingIds: [],
        underDefinedEntityIds: [],
        underDefinedPointIds: [],
        contextMenu: null,
        pendingDimension: null,
        pendingConstraintKind: null,
        pendingFilletLineId: null,
        dragSnapSuggestion: null,
        hoverPosition: null,
        past: [],
        future: [],
      });
    },

    // A pending Smart Dimension proposal only makes sense while that tool stays active —
    // switching to any other tool (including re-arming Smart Dimension itself, which goes
    // through this same setter) discards it rather than leaving a ghost proposal behind.
    setTool: (tool) =>
      set({
        tool,
        selection: [],
        pendingDimension: null,
        pendingConstraintKind: null,
        pendingFilletLineId: null,
        dragSnapSuggestion: null,
      }),
    setSelection: (ids) => set({ selection: ids }),
    clearSelection: () => set({ selection: [] }),

    toggleSelection: (id, additive) =>
      set((state) => {
        if (!additive) return { selection: [id] };
        return {
          selection: state.selection.includes(id)
            ? state.selection.filter((selected) => selected !== id)
            : [...state.selection, id],
        };
      }),

    drawLine: (from, to, construction = false, isAxis = false) =>
      edit((sketch) => addLine(sketch, from, to, { construction, isAxis, tolerance: snapTolerance() }).sketch),

    drawRectangle: (corner, opposite) =>
      edit((sketch) => addRectangle(sketch, corner, opposite, { tolerance: snapTolerance() }).sketch),

    drawCircle: (centre, radius) =>
      edit((sketch) => addCircle(sketch, centre, radius, { tolerance: snapTolerance() }).sketch),

    drawSpline: (positions) =>
      edit((sketch) => addSpline(sketch, positions, { tolerance: snapTolerance() }).sketch),

    drawPoint: (position) =>
      edit((sketch) => addPoint(sketch, position, { tolerance: snapTolerance() }).sketch),

    drawArc: (centre, start, end) =>
      edit((sketch) => addArc(sketch, centre, start, end, { tolerance: snapTolerance() }).sketch),

    trimAt: (entityId, position) =>
      edit((sketch) => trimEntityAt(sketch, entityId, position.x, position.y)),

    trimWindowSelect: (minX, minY, maxX, maxY) =>
      edit((sketch) => trimEntitiesInWindow(sketch, minX, minY, maxX, maxY)),

    applyConstraint: (kind) => {
      const { activeSketchId, sketches } = get();
      const sketch = activeSketchId ? sketches[activeSketchId] : undefined;
      if (!sketch) return false;

      const { entities, points } = partitionSelection(sketch);

      // Coincident is two shapes at once: two points pinned together (the original case),
      // or one point pinned onto one curve — dispatched to whichever of `point-on-line`/
      // `point-on-circle`/`point-on-spline` matches the curve's kind, since each needs its
      // own residual but all read the same way from the "Coincident" button.
      if (kind === "coincident") {
        if (points.length === 2 && entities.length === 0) {
          edit((current) => addConstraint(current, "coincident", [], points));
          set({ selection: [] });
          return true;
        }
        if (points.length === 1 && entities.length === 1) {
          const curve = entityById(sketch, entities[0]);
          const curveKind = curve ? curveConstraintKind(curve) : undefined;
          if (!curveKind) return false;
          edit((current) => addConstraint(current, curveKind, entities, points));
          set({ selection: [] });
          return true;
        }
        return false;
      }

      // Fix reads from either a point (pins it directly) or a single line/circle/arc
      // entity — a line dispatches to `fix-line` (pins its infinite extension, not its
      // endpoints, so it stays extendable/shortenable), a circle or arc to a plain `fix`
      // on its own centre point, which also pins the entity's own radius (see `fix`'s own
      // residual in `residuals.ts`) so only its rim points stay free to slide.
      if (kind === "fix") {
        if (points.length === 1 && entities.length === 0) {
          edit((current) => addConstraint(current, "fix", [], points));
          set({ selection: [] });
          return true;
        }
        if (points.length === 0 && entities.length === 1) {
          const target = entityById(sketch, entities[0]);
          if (target?.kind === "line") {
            edit((current) => addConstraint(current, "fix-line", entities, []));
            set({ selection: [] });
            return true;
          }
          if (target?.kind === "circle" || target?.kind === "arc") {
            edit((current) => addConstraint(current, "fix", [], [target.center]));
            set({ selection: [] });
            return true;
          }
        }
        return false;
      }

      // Each constraint kind needs a specific selection shape; refusing an ill-formed
      // selection is better than silently adding a constraint that does nothing.
      const needsTwoEntities = [
        "parallel",
        "perpendicular",
        "equal",
        "tangent",
        "concentric",
        "colinear",
      ].includes(kind);
      const needsOneEntity = ["horizontal", "vertical"].includes(kind);

      if (needsTwoEntities && entities.length !== 2) return false;
      if (needsOneEntity && entities.length === 0) return false;
      if (kind === "point-on-line" && (entities.length !== 1 || points.length !== 1)) return false;

      edit((current) => {
        // Horizontal and vertical apply to each selected line independently.
        if (needsOneEntity) {
          return entities.reduce(
            (accumulated, entityId) => addConstraint(accumulated, kind, [entityId], []),
            current,
          );
        }
        return addConstraint(current, kind, entities, points);
      });

      set({ selection: [] });
      return true;
    },

    toggleConstruction: () => {
      const { activeSketchId, sketches, selection } = get();
      const sketch = activeSketchId ? sketches[activeSketchId] : undefined;
      if (!sketch) return;

      const ids = new Set(selection);
      const targets = sketch.entities.filter((entity) => entity.kind !== "point" && ids.has(entity.id));
      if (targets.length === 0) return;

      // A mixed selection converts everything to construction rather than flipping each
      // entity individually — matching the convention of "make construction" reading as one
      // deliberate action, with the toggle back to normal only kicking in once the whole
      // selection already agrees it's construction. A single entity still behaves as a
      // plain toggle, since `every` over one item is just that item's own flag.
      const makeConstruction = !targets.every((entity) => entity.construction);

      edit((current) => ({
        ...current,
        entities: current.entities.map((entity) => {
          if (entity.kind === "point" || !ids.has(entity.id)) return entity;
          // A construction line demoted back to normal can no longer also be the revolve
          // axis — `isAxis` only means anything on a construction line to begin with.
          if (entity.kind === "line") {
            return { ...entity, construction: makeConstruction, isAxis: makeConstruction ? entity.isAxis : undefined };
          }
          return { ...entity, construction: makeConstruction };
        }),
      }));
    },

    armConstraint: (kind) => {
      // Already-selected elements might already be exactly what this relation needs (e.g.
      // the user selected two lines, then clicked Parallel) — try that first so arming is
      // only ever a fallback, not the only path.
      if (get().applyConstraint(kind)) return;
      // Picking only reaches the sketch (rather than whatever a drawing tool would do
      // with the same click) while the Select tool is active — force it so a relation
      // armed from, say, still having the Line tool selected doesn't silently swallow
      // the next click into drawing a new line instead of picking for the relation.
      set({ pendingConstraintKind: kind, tool: "select" });
    },

    pickForConstraint: (id) => {
      const { pendingConstraintKind, selection } = get();
      if (!pendingConstraintKind) return;

      const nextSelection = selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id];
      set({ selection: nextSelection });

      if (get().applyConstraint(pendingConstraintKind)) {
        set({ pendingConstraintKind: null });
      }
    },

    cancelPendingConstraint: () => set({ pendingConstraintKind: null, selection: [] }),

    setFilletRadius: (value) => {
      if (Number.isFinite(value) && value > 0) set({ filletRadius: value });
    },

    pickForFillet: (id) => {
      const { activeSketchId, sketches, pendingFilletLineId, filletRadius } = get();
      const sketch = activeSketchId ? sketches[activeSketchId] : undefined;
      if (!sketch) return;

      const entity = entityById(sketch, id);
      if (!entity || entity.kind !== "line") return;

      if (!pendingFilletLineId) {
        set({ pendingFilletLineId: id });
        return;
      }
      if (pendingFilletLineId === id) {
        // A repeat click on the same line un-picks it rather than failing silently,
        // matching how `pickForConstraint` treats a repeat pick.
        set({ pendingFilletLineId: null });
        return;
      }

      const before = sketch.entities.length;
      edit((current) => filletCorner(current, pendingFilletLineId, id, filletRadius));
      set({ pendingFilletLineId: null });

      const after = get().sketches[activeSketchId!]?.entities.length ?? before;
      if (after === before) {
        useGeometryStore
          .getState()
          .showToast("Those two lines need to share a corner, and the radius has to fit both of them.", 3500);
      }
    },

    mirrorSelection: () => {
      const { activeSketchId, sketches, selection } = get();
      const sketch = activeSketchId ? sketches[activeSketchId] : undefined;
      if (!sketch) return false;

      // The mirror axis is whichever selected construction line is present; everything
      // else selected (including a second, non-construction line) is what gets mirrored.
      const axisId = selection.find((id) => {
        const entity = entityById(sketch, id);
        return entity?.kind === "line" && entity.construction;
      });
      if (!axisId) return false;

      const targets = selection.filter((id) => id !== axisId && entityById(sketch, id));
      if (targets.length === 0) return false;

      edit((current) => mirrorEntities(current, targets, axisId));

      set({ selection: [] });
      return true;
    },

    offsetSelection: (distance) => {
      const { activeSketchId, sketches, selection } = get();
      const sketch = activeSketchId ? sketches[activeSketchId] : undefined;
      if (!sketch || !Number.isFinite(distance) || distance === 0) return false;

      const targets = selection.filter((id) => {
        const entity = entityById(sketch, id);
        return entity?.kind === "line" || entity?.kind === "circle" || entity?.kind === "arc";
      });
      if (targets.length === 0) return false;

      edit((current) => offsetEntities(current, targets, distance));

      set({ selection: [] });
      return true;
    },

    patternSelection: (options) => {
      const { activeSketchId, sketches, selection } = get();
      const sketch = activeSketchId ? sketches[activeSketchId] : undefined;
      if (!sketch || !Number.isFinite(options.count) || options.count < 2) return false;

      const targets = selection.filter((id) => entityById(sketch, id));
      if (targets.length === 0) return false;

      edit((current) => patternEntities(current, targets, options));

      set({ selection: [] });
      return true;
    },

    pickForSmartDimension: (id) => {
      const { activeSketchId, sketches, selection } = get();
      const sketch = activeSketchId ? sketches[activeSketchId] : undefined;
      if (!sketch) return;

      const nextSelection = selection.includes(id) ? selection : [...selection, id];
      const entities = nextSelection.filter((candidate) => entityById(sketch, candidate));
      const points = nextSelection.filter((candidate) => pointById(sketch, candidate));

      const inferred = inferSmartDimension(sketch, entities, points);
      if (!inferred) {
        // Not conclusive yet (e.g. a lone point with no partner) — keep accumulating and
        // wait for the next pick, same as before this flow deferred the actual commit.
        set({ selection: nextSelection });
        return;
      }

      const value = roundDimensionValue(measure(sketch, inferred.kind, inferred.points, inferred.entities));
      set({
        selection: nextSelection,
        pendingDimension: {
          kind: inferred.kind,
          points: inferred.points,
          entities: inferred.entities,
          value,
          alsoConstrainParallel: inferred.alsoConstrainParallel,
        },
      });
    },

    commitPendingDimension: (position) => {
      const { pendingDimension } = get();
      if (!pendingDimension) return;

      edit((sketch) => {
        const anchor = defaultDimensionAnchor(
          sketch,
          pendingDimension.kind,
          pendingDimension.points,
          pendingDimension.entities,
        );
        const labelOffset = anchor
          ? { x: position.x - anchor.x, y: position.y - anchor.y }
          : { x: 0, y: 0 };

        const withDimension = addDimension(
          sketch,
          pendingDimension.kind,
          pendingDimension.value,
          pendingDimension.points,
          pendingDimension.entities,
          labelOffset,
        ).sketch;

        return pendingDimension.alsoConstrainParallel
          ? addConstraint(withDimension, "parallel", pendingDimension.alsoConstrainParallel, [])
          : withDimension;
      });

      set({ selection: [], pendingDimension: null });
    },

    cancelPendingDimension: () => set({ pendingDimension: null, selection: [] }),

    setHoverPosition: (position) => set({ hoverPosition: position }),

    applyOrdinateDimension: (axis) => {
      const { activeSketchId, sketches } = get();
      const sketch = activeSketchId ? sketches[activeSketchId] : undefined;
      if (!sketch) return false;

      const { entities, points } = partitionSelection(sketch);

      // Dimensioning a line's endpoint is the common case, so accept a selected line and
      // ordinate its far end.
      const targets = points.length > 0
        ? points
        : entities.flatMap((id) => {
            const entity = entityById(sketch, id);
            return entity ? entityPoints(entity).slice(-1) : [];
          });

      const datum = originPointId(sketch.id);
      const dimensioned = targets.filter((target) => target !== datum);
      if (dimensioned.length === 0) return false;

      const kinds: DimensionKind[] =
        axis === "both" ? ["ordinate-x", "ordinate-y"] : axis === "x" ? ["ordinate-x"] : ["ordinate-y"];

      edit((current) =>
        dimensioned.reduce((accumulated, target) => {
          return kinds.reduce((inner, kind) => {
            const value = roundDimensionValue(measure(inner, kind, [datum, target], []));
            return addDimension(inner, kind, value, [datum, target], []).sketch;
          }, accumulated);
        }, current),
      );

      set({ selection: [] });
      return true;
    },

    setDimensionValue: (dimensionId, value) =>
      edit((sketch) => ({
        ...sketch,
        dimensions: sketch.dimensions.map((dimension) =>
          dimension.id === dimensionId ? { ...dimension, value } : dimension,
        ),
      })),

    // Repositioning a label is display-only — it does not change what the dimension
    // measures or drive a re-solve, so this writes the sketch directly rather than going
    // through `edit()` (which re-solves and updates `diagnostics`, neither of which apply
    // here). It is still a persisted, user-driven edit — the offset is saved with the
    // document — so it pushes history: undoing a label drag has to restore the label, not
    // (surprisingly) the last unrelated sketch edit. The label drag arms the same gesture
    // mechanism a point drag does (`beginDrag` at the label's own pointer-down, see
    // `SketchDimensions.tsx`), so a whole drag is one step — the first moving frame
    // consumes the pre-gesture snapshot, later frames of the same drag apply without
    // another entry.
    setDimensionLabelOffset: (dimensionId, offset) => {
      const { activeSketchId, sketches } = get();
      if (!activeSketchId) return;
      const current = sketches[activeSketchId];
      if (!current) return;

      const target = current.dimensions.find((dimension) => dimension.id === dimensionId);
      if (!target || (target.labelOffset.x === offset.x && target.labelOffset.y === offset.y)) return;

      if (inDragGesture) {
        consumeDragSnapshot();
      } else {
        pushHistory(current);
      }

      set({
        sketches: {
          ...sketches,
          [activeSketchId]: {
            ...current,
            dimensions: current.dimensions.map((dimension) =>
              dimension.id === dimensionId ? { ...dimension, labelOffset: offset } : dimension,
            ),
          },
        },
      });
    },

    deleteDimension: (dimensionId) =>
      edit((sketch) => ({
        ...sketch,
        dimensions: sketch.dimensions.filter((dimension) => dimension.id !== dimensionId),
      })),

    toggleDimensionRadiusDiameter: (dimensionId) =>
      edit((sketch) => ({
        ...sketch,
        dimensions: sketch.dimensions.map((dimension) => {
          if (dimension.id !== dimensionId) return dimension;
          if (dimension.kind === "radius") {
            return { ...dimension, kind: "diameter", value: dimension.value * 2 };
          }
          if (dimension.kind === "diameter") {
            return { ...dimension, kind: "radius", value: dimension.value / 2 };
          }
          return dimension;
        }),
      })),

    toggleRadiusExtendToCenter: (dimensionId) =>
      edit((sketch) => ({
        ...sketch,
        dimensions: sketch.dimensions.map((dimension) =>
          dimension.id === dimensionId && (dimension.kind === "radius" || dimension.kind === "diameter")
            ? { ...dimension, extendToCenter: !dimension.extendToCenter }
            : dimension,
        ),
      })),

    flipAngleDimension: (dimensionId) =>
      edit((sketch) => ({
        ...sketch,
        dimensions: sketch.dimensions.map((dimension) =>
          dimension.id === dimensionId && dimension.kind === "angle"
            ? { ...dimension, value: 180 - dimension.value }
            : dimension,
        ),
      })),

    setLinearDimensionMode: (dimensionId, mode) =>
      edit((sketch) => ({
        ...sketch,
        dimensions: sketch.dimensions.map((dimension) => {
          if (dimension.id !== dimensionId) return dimension;
          if (
            dimension.kind !== "distance" &&
            dimension.kind !== "horizontal-distance" &&
            dimension.kind !== "vertical-distance"
          ) {
            return dimension;
          }
          const first = pointById(sketch, dimension.points[0]);
          const second = pointById(sketch, dimension.points[1]);
          if (!first || !second) return { ...dimension, kind: mode };
          // Re-measured from the current geometry rather than converted algebraically from
          // the old value (e.g. via the two points' angle) — simpler, and exact regardless
          // of which mode the dimension is switching *from*, so a chain of mode switches
          // never accumulates rounding.
          const value =
            mode === "horizontal-distance"
              ? Math.abs(second.x - first.x)
              : mode === "vertical-distance"
                ? Math.abs(second.y - first.y)
                : Math.hypot(second.x - first.x, second.y - first.y);
          return { ...dimension, kind: mode, value: roundDimensionValue(value) };
        }),
      })),

    /**
     * Drags a point by re-solving with it pinned to the cursor.
     *
     * Pinning through the solver rather than writing the coordinate directly is what keeps
     * the rest of the sketch consistent: constrained neighbours follow, and a fully
     * defined sketch refuses to move at all.
     */
    beginDrag: () => {
      const { activeSketchId, sketches } = get();
      const current = activeSketchId ? sketches[activeSketchId] : undefined;
      if (!current) return;
      // Arms rather than pushes — see `consumeDragSnapshot`'s doc comment for why the
      // snapshot only lands on the stack if the gesture actually changes something.
      inDragGesture = true;
      dragSnapshot = current;
    },

    endDrag: () => {
      inDragGesture = false;
      dragSnapshot = null;
    },

    dragPoint: (pointId, position) => {
      const { activeSketchId, sketches } = get();
      if (!activeSketchId) return;

      const current = sketches[activeSketchId];
      if (!current) return;

      // A point under a real Fix constraint must not move at all. `solveSketch` below is
      // handed `current` as its anchor sketch precisely so a fixed point/line/arc reads its
      // pre-drag position rather than the cursor position `moved` writes it to — but a
      // point that is *itself* directly fixed has no other DOF to resolve that residual
      // with, so skipping the solve entirely here is just a fast path, not what makes Fix
      // hold (see `solveSketch`'s own doc comment on `anchorSketch` for the general fix).
      const isFixed = current.constraints.some(
        (constraint) => constraint.kind === "fix" && constraint.points.includes(pointId),
      );
      if (isFixed) return;

      const moved: Sketch = {
        ...current,
        points: current.points.map((point) =>
          point.id === pointId ? { ...point, x: position.x, y: position.y } : point,
        ),
      };

      const pinned: Sketch = {
        ...moved,
        constraints: [
          ...moved.constraints,
          // The pin carries its own cursor target (`at`) rather than reading the solve's
          // anchor map: the map is built from `current` below so every *real* fix/fix-line
          // stays anchored to its pre-drag position (the behaviour that map choice was
          // introduced for), but that same choice made the pin anchor the dragged point to
          // its own pre-drag position too — every point drag silently solved straight back
          // to where it started, a no-op drag nobody's test caught until the undo-history
          // suite replayed one. Per-constraint target, and both behaviours coexist.
          { id: "drag-pin", kind: "fix", entities: [], points: [pointId], at: { ...position } },
        ],
      };

      // Anchored to `current` (pre-drag), not `pinned`/`moved` — see `solveSketch`'s
      // `anchorSketch` doc comment. `moved` already wrote the dragged point to the cursor
      // position, so using it as the anchor source too would silently re-anchor any
      // "fix"/"fix-line" touching that point (or, for an arc, its centre) to wherever the
      // cursor currently is instead of where the constraint actually pinned it — exactly
      // the "line moves anywhere" bug this fixes.
      const solved = solveSketch(pinned, current);
      const settled: Sketch = {
        ...solved.sketch,
        constraints: solved.sketch.constraints.filter((constraint) => constraint.id !== "drag-pin"),
      };

      // Re-solve without the pin so the reported diagnostics describe the real sketch
      // rather than one with a temporary extra constraint.
      const final = solveSketch(settled);

      // "Constrains smart": suggested from the point's actual post-solve position (other
      // constraints may have pulled it away from where the cursor literally is), so the
      // highlight always matches where the point really ended up. Off entirely when the
      // Settings ▸ Sketch toggle (`smartConstraintEnabled`) is off, rather than just
      // hiding the highlight — no suggestion means `commitDragSnap` has nothing to apply.
      const settledPoint = pointById(final.sketch, pointId);
      const suggestion =
        settledPoint && useSettingsStore.getState().smartConstraintEnabled
          ? inferDragSnap(final.sketch, pointId, settledPoint, snapTolerance())
          : null;

      // The gesture's first *changing* frame is what turns the armed `beginDrag` snapshot
      // into the drag's single history entry — see `consumeDragSnapshot`'s doc comment.
      if (final.sketch !== current) consumeDragSnapshot();

      set({
        sketches: { ...sketches, [activeSketchId]: final.sketch },
        diagnostics: final.diagnostics,
        // `settled`, not `final.sketch` — see `edit`'s own doc comment on `conflictsFor`'s
        // anchor-reuse pitfall; `settled` is where the drag itself actually left the
        // points, `final.sketch` is a second solve pass that can already have wandered off
        // chasing whatever's unsatisfiable. Throttled rather than direct: the over-defined
        // search is O(constraints) extra solves, which is too much to run per pointermove.
        conflictingIds: scheduleConflictScan(settled, final.diagnostics),
        ...freedomOf(final),
        dragSnapSuggestion: suggestion,
      });
    },

    commitDragSnap: (pointId) => {
      // The drag gesture just ended — run the deferred conflict scan (if one is pending)
      // immediately so the highlighting matches the final geometry right away, not a
      // throttle tick later.
      flushConflictScan();
      const { dragSnapSuggestion } = get();
      if (!dragSnapSuggestion) {
        // The gesture is over either way — a drag that never changed anything (a click on
        // a fixed point, a grab released without moving) discards its armed snapshot here.
        inDragGesture = false;
        dragSnapshot = null;
        return;
      }

      // `edit` is gesture-aware: the snap is the tail of the same gesture `beginDrag`
      // armed, so it applies without a second undo step — a drag that ends in a
      // smart-constraint snap still undoes as one step, back to the pre-drag sketch
      // (position *and* the added relation together), the way `beginDrag`'s own doc
      // comment has always described the gesture working.
      edit((sketch) => {
        if (dragSnapSuggestion.kind === "tangent") {
          return addConstraint(
            sketch,
            "tangent",
            [dragSnapSuggestion.lineEntityId, dragSnapSuggestion.circleEntityId],
            [],
          );
        }

        const snapped: Sketch = {
          ...sketch,
          points: sketch.points.map((point) =>
            point.id === pointId
              ? { ...point, x: dragSnapSuggestion.position.x, y: dragSnapSuggestion.position.y }
              : point,
          ),
        };

        if (dragSnapSuggestion.kind === "coincident") {
          return addConstraint(snapped, "coincident", [], [pointId, dragSnapSuggestion.targetPointId]);
        }
        if (dragSnapSuggestion.kind === "midpoint") {
          return addConstraint(snapped, "midpoint", [dragSnapSuggestion.lineEntityId], [pointId]);
        }
        return snapped;
      });

      // The gesture is over even if the snap's edit changed nothing — never leave a stale
      // armed gesture behind for some later unrelated edit to be swallowed by.
      inDragGesture = false;
      dragSnapshot = null;
      set({ dragSnapSuggestion: null });
    },

    deleteSelection: () => {
      const { activeSketchId, sketches, selection } = get();
      if (selection.length === 0) return;

      // The origin is permanent reference geometry (same rule every mainstream CAD tool
      // enforces — SolidWorks/Inventor don't let you delete a sketch's origin either) and
      // silently survives the filtering below no matter what. Left with no feedback at
      // all, though, selecting just the origin and hitting Delete reads as "Delete is
      // broken" rather than "this one thing is protected" — so say so explicitly instead
      // of doing nothing.
      const activeSketch = activeSketchId ? sketches[activeSketchId] : undefined;
      if (activeSketch && selection.includes(originPointId(activeSketch.id))) {
        useGeometryStore.getState().showToast("The origin point is permanent and can't be deleted.", 3000);
      }

      edit((sketch) => {
        const removed = new Set(selection);

        // A standalone point entity renders as nothing but its own anchor point (see
        // SketchGeometry), so clicking it only ever selects the raw point id, never the
        // entity's own id. Without this, the entity would survive the filter below and
        // keep its point alive via entityPoints() regardless of the selection — deleting
        // a bare point would silently do nothing.
        for (const entity of sketch.entities) {
          if (entity.kind === "point" && removed.has(entity.at)) removed.add(entity.id);
        }

        const entities = sketch.entities.filter((entity) => !removed.has(entity.id));
        const survivingPoints = new Set(entities.flatMap(entityPoints));
        survivingPoints.add(originPointId(sketch.id));

        return {
          ...sketch,
          entities,
          points: sketch.points.filter((point) => survivingPoints.has(point.id)),
          // A constraint or dimension can also be selected and deleted directly (its own
          // id in `removed`, not just an id it references) — clicking a constraint glyph
          // or a dimension label selects that glyph/label itself, not the geometry it
          // annotates, so this check is what actually lets Delete remove either one.
          constraints: sketch.constraints.filter(
            (constraint) =>
              !removed.has(constraint.id) &&
              !constraint.entities.some((id) => removed.has(id)) &&
              constraint.points.every((id) => survivingPoints.has(id)),
          ),
          dimensions: sketch.dimensions.filter(
            (dimension) =>
              !removed.has(dimension.id) &&
              !dimension.entities.some((id) => removed.has(id)) &&
              dimension.points.every((id) => survivingPoints.has(id)),
          ),
        };
      });

      set({ selection: [] });
    },

    undo: () => {
      // A keyboard undo mid-drag ends the gesture: the drag's next frame becomes a fresh
      // edit against the restored sketch rather than being swallowed as a gesture frame.
      inDragGesture = false;
      dragSnapshot = null;
      const { activeSketchId, sketches, past, future } = get();
      if (!activeSketchId) return;
      const current = sketches[activeSketchId];
      const previous = past[past.length - 1];
      if (!current || !previous) return;

      const previousOutcome = solveSketch(previous);
      const diagnostics = previousOutcome.diagnostics;
      set({
        sketches: { ...sketches, [activeSketchId]: previous },
        diagnostics,
        conflictingIds: conflictsFor(previous, diagnostics),
        ...freedomOf(previousOutcome),
        past: past.slice(0, -1),
        future: [current, ...future].slice(0, SKETCH_HISTORY_LIMIT),
        selection: [],
      });
    },

    redo: () => {
      inDragGesture = false;
      dragSnapshot = null;
      const { activeSketchId, sketches, past, future } = get();
      if (!activeSketchId) return;
      const current = sketches[activeSketchId];
      const [next, ...rest] = future;
      if (!current || !next) return;

      const nextOutcome = solveSketch(next);
      const diagnostics = nextOutcome.diagnostics;
      set({
        sketches: { ...sketches, [activeSketchId]: next },
        diagnostics,
        conflictingIds: conflictsFor(next, diagnostics),
        ...freedomOf(nextOutcome),
        past: [...past, current].slice(-SKETCH_HISTORY_LIMIT),
        future: rest,
        selection: [],
      });
    },
  };
});

/* ------------------------------------------------------------------ selectors */

export const selectActiveSketch = (state: SketchStore): Sketch | null =>
  state.activeSketchId ? (state.sketches[state.activeSketchId] ?? null) : null;

export const selectIsSketchMode = (state: SketchStore) => state.activeSketchId !== null;

export function selectSketchStatus(state: SketchStore): SketchStatus {
  if (!state.activeSketchId) return "no-sketch";
  return sketchStatusFromDiagnostics(state.diagnostics);
}

export function selectProfileClosed(state: SketchStore): boolean {
  const sketch = selectActiveSketch(state);
  return sketch ? hasClosedProfile(sketch) : false;
}
