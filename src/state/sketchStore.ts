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
  entityById,
  entityPoints,
  hasClosedProfile,
  inferSmartDimension,
  measure,
  mirrorEntities,
  originPointId,
  roundDimensionValue,
  pointById,
} from "@/sketch/sketchModel";
import { sketchStatusFromDiagnostics, solveSketch } from "@/sketch/solver";
import type {
  DimensionKind,
  GeometricConstraintKind,
  Sketch,
  SketchDiagnostics,
} from "@/sketch/types";
import type { SketchStatus } from "@/types/ui";

/** Tools available while a sketch is open. */
export type SketchTool =
  | "select"
  | "line"
  | "rectangle"
  | "circle"
  | "spline"
  | "construction-line"
  | "point"
  | "arc"
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

  beginSketch: (featureId: string, planeId: string) => void;
  resumeSketch: (featureId: string) => void;
  exitSketch: () => void;
  openContextMenu: (x: number, y: number) => void;
  closeContextMenu: () => void;

  setTool: (tool: SketchTool) => void;
  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string, additive: boolean) => void;
  clearSelection: () => void;

  drawLine: (from: Point2, to: Point2, construction?: boolean) => void;
  drawRectangle: (corner: Point2, opposite: Point2) => void;
  drawCircle: (centre: Point2, radius: number) => void;
  drawSpline: (positions: Point2[]) => void;
  drawPoint: (position: Point2) => void;
  drawArc: (centre: Point2, start: Point2, end: Point2) => void;

  applyConstraint: (kind: GeometricConstraintKind) => boolean;
  mirrorSelection: () => boolean;
  applySmartDimension: () => boolean;
  applyOrdinateDimension: (axis: "both" | "x" | "y") => boolean;
  setDimensionValue: (dimensionId: string, value: number) => void;
  deleteDimension: (dimensionId: string) => void;

  dragPoint: (pointId: string, position: Point2) => void;
  deleteSelection: () => void;
}

interface Point2 {
  x: number;
  y: number;
}

/** Snap radius in sketch units; small enough to be deliberate, large enough to be easy. */
export const SNAP_TOLERANCE = 2.5;

export const useSketchStore = create<SketchStore>((set, get) => {
  /** Applies an edit, re-solves, and stores both the geometry and the diagnostics. */
  const edit = (mutate: (sketch: Sketch) => Sketch) => {
    const { activeSketchId, sketches } = get();
    if (!activeSketchId) return;

    const current = sketches[activeSketchId];
    if (!current) return;

    const { sketch, diagnostics } = solveSketch(mutate(current));
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
      });
    },

    exitSketch: () =>
      set({
        activeSketchId: null,
        tool: "select",
        selection: [],
        diagnostics: IDLE_DIAGNOSTICS,
        contextMenu: null,
      }),

    setTool: (tool) => set({ tool, selection: [] }),
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

    drawLine: (from, to, construction = false) =>
      edit((sketch) => addLine(sketch, from, to, { construction, tolerance: SNAP_TOLERANCE }).sketch),

    drawRectangle: (corner, opposite) =>
      edit((sketch) => addRectangle(sketch, corner, opposite, { tolerance: SNAP_TOLERANCE }).sketch),

    drawCircle: (centre, radius) =>
      edit((sketch) => addCircle(sketch, centre, radius, { tolerance: SNAP_TOLERANCE }).sketch),

    drawSpline: (positions) =>
      edit((sketch) => addSpline(sketch, positions, { tolerance: SNAP_TOLERANCE }).sketch),

    drawPoint: (position) =>
      edit((sketch) => addPoint(sketch, position, { tolerance: SNAP_TOLERANCE }).sketch),

    drawArc: (centre, start, end) =>
      edit((sketch) => addArc(sketch, centre, start, end, { tolerance: SNAP_TOLERANCE }).sketch),

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

    applySmartDimension: () => {
      const { activeSketchId, sketches } = get();
      const sketch = activeSketchId ? sketches[activeSketchId] : undefined;
      if (!sketch) return false;

      const { entities, points } = partitionSelection(sketch);
      const inferred = inferSmartDimension(sketch, entities, points);
      if (!inferred) return false;

      edit((current) => {
        const value = roundDimensionValue(
          measure(current, inferred.kind, inferred.points, inferred.entities),
        );
        return addDimension(current, inferred.kind, value, inferred.points, inferred.entities).sketch;
      });

      set({ selection: [] });
      return true;
    },

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

    deleteDimension: (dimensionId) =>
      edit((sketch) => ({
        ...sketch,
        dimensions: sketch.dimensions.filter((dimension) => dimension.id !== dimensionId),
      })),

    /**
     * Drags a point by re-solving with it pinned to the cursor.
     *
     * Pinning through the solver rather than writing the coordinate directly is what keeps
     * the rest of the sketch consistent: constrained neighbours follow, and a fully
     * defined sketch refuses to move at all.
     */
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
      set({
        sketches: { ...sketches, [activeSketchId]: final.sketch },
        diagnostics: final.diagnostics,
      });
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
          constraints: sketch.constraints.filter(
            (constraint) =>
              !constraint.entities.some((id) => removed.has(id)) &&
              constraint.points.every((id) => survivingPoints.has(id)),
          ),
          dimensions: sketch.dimensions.filter(
            (dimension) =>
              !dimension.entities.some((id) => removed.has(id)) &&
              dimension.points.every((id) => survivingPoints.has(id)),
          ),
        };
      });

      set({ selection: [] });
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
