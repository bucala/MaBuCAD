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
  defaultDimensionAnchor,
  entityById,
  entityPoints,
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
  trimLineAt,
} from "@/sketch/sketchModel";
import type { DragSnapSuggestion, PatternOptions } from "@/sketch/sketchModel";
import { sketchStatusFromDiagnostics, solveSketch } from "@/sketch/solver";
import type {
  DimensionKind,
  GeometricConstraintKind,
  Sketch,
  SketchDiagnostics,
} from "@/sketch/types";
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
  | "smart-dimension"
  | "ordinate"
  | "ordinate-horizontal"
  | "ordinate-vertical";

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
}

interface SketchStore {
  /** Feature id of the sketch being edited, or null outside sketch mode. */
  activeSketchId: string | null;
  sketches: Record<string, Sketch>;
  diagnostics: SketchDiagnostics;
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

  applyConstraint: (kind: GeometricConstraintKind) => boolean;
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
  /** The other of the two angles two intersecting lines actually form (θ and its
   * supplement, 180-θ) — the two numerically distinct choices at that vertex; the other
   * two visual quadrants are one of these two values again, by vertical angles. A no-op
   * for any other dimension kind. */
  flipAngleDimension: (dimensionId: string) => void;

  /** Snapshots the active sketch onto the undo stack without changing it — called once
   * when a point-drag gesture starts, so the whole drag undoes in one step rather than
   * every intermediate `dragPoint` call during the drag becoming its own step. */
  beginDrag: () => void;
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

  /** Applies an edit, re-solves, and stores both the geometry and the diagnostics. */
  const edit = (mutate: (sketch: Sketch) => Sketch) => {
    const { activeSketchId, sketches } = get();
    if (!activeSketchId) return;

    const current = sketches[activeSketchId];
    if (!current) return;

    const { sketch, diagnostics } = solveSketch(mutate(current));
    if (sketch === current) return;

    pushHistory(current);
    set({ sketches: { ...sketches, [activeSketchId]: sketch }, diagnostics });
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
    tool: "select",
    selection: [],
    contextMenu: null,
    pendingDimension: null,
    dragSnapSuggestion: null,
    hoverPosition: null,
    past: [],
    future: [],

    openContextMenu: (x, y) => set({ contextMenu: { x, y } }),
    closeContextMenu: () => set({ contextMenu: null }),

    beginSketch: (featureId, planeId) => {
      const sketch = createSketch(featureId, planeId);
      const solved = solveSketch(sketch);

      set((state) => ({
        activeSketchId: featureId,
        sketches: { ...state.sketches, [featureId]: solved.sketch },
        diagnostics: solved.diagnostics,
        tool: "line",
        selection: [],
        contextMenu: null,
        pendingDimension: null,
        dragSnapSuggestion: null,
        hoverPosition: null,
        past: [],
        future: [],
      }));
    },

    resumeSketch: (featureId) => {
      const sketch = get().sketches[featureId];
      if (!sketch) return;
      set({
        activeSketchId: featureId,
        diagnostics: solveSketch(sketch).diagnostics,
        tool: "select",
        selection: [],
        contextMenu: null,
        pendingDimension: null,
        dragSnapSuggestion: null,
        hoverPosition: null,
        past: [],
        future: [],
      });
    },

    exitSketch: () =>
      set({
        activeSketchId: null,
        tool: "select",
        selection: [],
        diagnostics: IDLE_DIAGNOSTICS,
        contextMenu: null,
        pendingDimension: null,
        dragSnapSuggestion: null,
        hoverPosition: null,
        past: [],
        future: [],
      }),

    loadSketches: (sketches) =>
      set({
        sketches,
        activeSketchId: null,
        tool: "select",
        selection: [],
        diagnostics: IDLE_DIAGNOSTICS,
        contextMenu: null,
        pendingDimension: null,
        dragSnapSuggestion: null,
        hoverPosition: null,
        past: [],
        future: [],
      }),

    // A pending Smart Dimension proposal only makes sense while that tool stays active —
    // switching to any other tool (including re-arming Smart Dimension itself, which goes
    // through this same setter) discards it rather than leaving a ghost proposal behind.
    setTool: (tool) => set({ tool, selection: [], pendingDimension: null, dragSnapSuggestion: null }),
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
      edit((sketch) => trimLineAt(sketch, entityId, position.x, position.y)),

    applyConstraint: (kind) => {
      const { activeSketchId, sketches } = get();
      const sketch = activeSketchId ? sketches[activeSketchId] : undefined;
      if (!sketch) return false;

      const { entities, points } = partitionSelection(sketch);

      // Each constraint kind needs a specific selection shape; refusing an ill-formed
      // selection is better than silently adding a constraint that does nothing.
      const needsTwoEntities = ["parallel", "perpendicular", "equal", "tangent", "concentric"].includes(
        kind,
      );
      const needsOneEntity = ["horizontal", "vertical"].includes(kind);
      const needsTwoPoints = kind === "coincident";
      const needsOnePoint = kind === "fix";

      if (needsTwoEntities && entities.length !== 2) return false;
      if (needsOneEntity && entities.length === 0) return false;
      if (needsTwoPoints && points.length !== 2) return false;
      if (needsOnePoint && points.length !== 1) return false;
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
        pendingDimension: { kind: inferred.kind, points: inferred.points, entities: inferred.entities, value },
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

        return addDimension(
          sketch,
          pendingDimension.kind,
          pendingDimension.value,
          pendingDimension.points,
          pendingDimension.entities,
          labelOffset,
        ).sketch;
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
    // measures or drive a re-solve, so this writes directly rather than going through
    // `edit()` (which re-solves and updates `diagnostics`, neither of which apply here).
    setDimensionLabelOffset: (dimensionId, offset) => {
      const { activeSketchId, sketches } = get();
      if (!activeSketchId) return;
      const current = sketches[activeSketchId];
      if (!current) return;

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

    flipAngleDimension: (dimensionId) =>
      edit((sketch) => ({
        ...sketch,
        dimensions: sketch.dimensions.map((dimension) =>
          dimension.id === dimensionId && dimension.kind === "angle"
            ? { ...dimension, value: 180 - dimension.value }
            : dimension,
        ),
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
      pushHistory(current);
    },

    dragPoint: (pointId, position) => {
      const { activeSketchId, sketches } = get();
      if (!activeSketchId) return;

      const current = sketches[activeSketchId];
      if (!current) return;

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
          { id: "drag-pin", kind: "fix", entities: [], points: [pointId] },
        ],
      };

      const solved = solveSketch(pinned);
      const settled: Sketch = {
        ...solved.sketch,
        constraints: solved.sketch.constraints.filter((constraint) => constraint.id !== "drag-pin"),
      };

      // Re-solve without the pin so the reported diagnostics describe the real sketch
      // rather than one with a temporary extra constraint.
      const final = solveSketch(settled);

      // "Constrains smart": suggested from the point's actual post-solve position (other
      // constraints may have pulled it away from where the cursor literally is), so the
      // highlight always matches where the point really ended up.
      const settledPoint = pointById(final.sketch, pointId);
      const suggestion = settledPoint
        ? inferDragSnap(final.sketch, pointId, settledPoint, snapTolerance())
        : null;

      set({
        sketches: { ...sketches, [activeSketchId]: final.sketch },
        diagnostics: final.diagnostics,
        dragSnapSuggestion: suggestion,
      });
    },

    commitDragSnap: (pointId) => {
      const { dragSnapSuggestion } = get();
      if (!dragSnapSuggestion) return;

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

        return dragSnapSuggestion.kind === "coincident"
          ? addConstraint(snapped, "coincident", [], [pointId, dragSnapSuggestion.targetPointId])
          : snapped;
      });

      set({ dragSnapSuggestion: null });
    },

    deleteSelection: () => {
      const { selection } = get();
      if (selection.length === 0) return;

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
      const { activeSketchId, sketches, past, future } = get();
      if (!activeSketchId) return;
      const current = sketches[activeSketchId];
      const previous = past[past.length - 1];
      if (!current || !previous) return;

      set({
        sketches: { ...sketches, [activeSketchId]: previous },
        diagnostics: solveSketch(previous).diagnostics,
        past: past.slice(0, -1),
        future: [current, ...future].slice(0, SKETCH_HISTORY_LIMIT),
        selection: [],
      });
    },

    redo: () => {
      const { activeSketchId, sketches, past, future } = get();
      if (!activeSketchId) return;
      const current = sketches[activeSketchId];
      const [next, ...rest] = future;
      if (!current || !next) return;

      set({
        sketches: { ...sketches, [activeSketchId]: next },
        diagnostics: solveSketch(next).diagnostics,
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
