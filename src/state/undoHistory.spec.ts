import { beforeEach, describe, expect, it } from "vitest";

import type { DrawingViewData } from "@/types/document";

import { createDocument, useDocumentStore } from "./documentStore";
import { useSettingsStore } from "./settingsStore";
import { selectActiveSketch, useSketchStore } from "./sketchStore";

/**
 * Undo-history semantics for the two stores that own one, at the level users actually
 * experience it: one pointer-drag gesture is one undo step — never one step per
 * pointermove frame — and a press that never changes anything pushes nothing at all.
 *
 * The drag gestures here replay what the real pointer handlers fire: the Drawing sheet
 * arms `beginDragEdit` on pointer-down and `endDragEdit` on pointer-up while its
 * draggable children fire `moveDrawingView`/`updateDrawingNote` per pointermove
 * (`DrawingSheet.tsx`), and the sketcher arms `beginDrag` at a point/label grab with
 * `dragPoint`/`setDimensionLabelOffset` per move and `commitDragSnap`/`endDrag` on
 * release (`SketchCanvas.tsx`, `SketchDimensions.tsx`).
 */

/** The active sketch, as the sketcher's own selectors read it. */
function activeSketch() {
  const sketch = selectActiveSketch(useSketchStore.getState());
  if (!sketch) throw new Error("no active sketch — beginSketch must run first");
  return sketch;
}

function pointAt(x: number, y: number) {
  const point = activeSketch().points.find((candidate) => candidate.x === x && candidate.y === y);
  if (!point) throw new Error(`no sketch point at (${x}, ${y})`);
  return point;
}

/** Loads a fresh Drawing document so each document-side case starts from an empty history. */
function freshDrawingDocument() {
  useDocumentStore.getState().loadDocument(createDocument("drawing", "Sheet1"));
}

const VIEW: DrawingViewData = {
  id: "view-1",
  label: "Front",
  projection: "front",
  x: 100,
  y: 100,
  scale: 1,
  visiblePaths: [],
  hiddenPaths: [],
  width: 50,
  height: 50,
};

beforeEach(() => {
  // The drag-snap path is settings-gated — pin both settings so the gesture tests can't
  // drift when a default changes. (`zustand`'s setState merges, so the rest is untouched.)
  useSettingsStore.setState({ smartConstraintEnabled: true, snapTolerance: 2.5 });
});

describe("documentStore undo history", () => {
  it("a view drag is one undo step, and undo restores the view and its bound annotations", () => {
    freshDrawingDocument();
    const store = useDocumentStore.getState();
    store.addDrawingView(VIEW);
    store.addDrawingDimension({
      kind: "linear",
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 0,
      value: 10,
      offsetX: 0,
      offsetY: 5,
      parentViewId: "view-1",
    });
    const baseline = useDocumentStore.getState().past.length;

    // Three pointermove frames of one drag gesture — must land as a single entry.
    store.beginDragEdit();
    store.moveDrawingView("view-1", 110, 100);
    store.moveDrawingView("view-1", 120, 100);
    store.moveDrawingView("view-1", 130, 100);
    store.endDragEdit();

    const state = useDocumentStore.getState();
    expect(state.past.length).toBe(baseline + 1);
    expect(state.document.drawing!.views[0]!.x).toBe(130);
    // The bound annotation moved with the view by the same +30 mm delta.
    expect(state.document.drawing!.dimensions![0]!.x1).toBe(30);
    expect(state.document.drawing!.dimensions![0]!.x2).toBe(40);

    // One undo takes the whole gesture back — view and its bound annotation together.
    state.undo();
    const undone = useDocumentStore.getState().document.drawing!;
    expect(undone.views[0]!.x).toBe(100);
    expect(undone.dimensions![0]!.x1).toBe(0);
    expect(undone.dimensions![0]!.x2).toBe(10);

    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().document.drawing!.views[0]!.x).toBe(130);
  });

  it("a note drag is one undo step; a press that never changes anything pushes nothing", () => {
    freshDrawingDocument();
    const store = useDocumentStore.getState();
    const noteId = store.addDrawingNote({ x: 10, y: 10, text: "note", fontSize: 12 });
    const baseline = useDocumentStore.getState().past.length;

    // Grabbed and released without moving — the armed gesture is discarded, not pushed.
    store.beginDragEdit();
    store.endDragEdit();
    expect(useDocumentStore.getState().past.length).toBe(baseline);

    store.beginDragEdit();
    store.updateDrawingNote(noteId, { x: 11, y: 10 });
    store.updateDrawingNote(noteId, { x: 12, y: 10 });
    store.updateDrawingNote(noteId, { x: 13, y: 10 });
    store.endDragEdit();

    expect(useDocumentStore.getState().past.length).toBe(baseline + 1);
    expect(useDocumentStore.getState().document.drawing!.notes![0]!.x).toBe(13);

    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.drawing!.notes![0]!.x).toBe(10);
  });

  it("an undo mid-gesture ends the gesture — the next frame is a fresh edit, not a swallowed one", () => {
    freshDrawingDocument();
    const store = useDocumentStore.getState();
    const noteId = store.addDrawingNote({ x: 10, y: 10, text: "note", fontSize: 12 });
    const baseline = useDocumentStore.getState().past.length;

    store.beginDragEdit();
    store.updateDrawingNote(noteId, { x: 11, y: 10 }); // the gesture's single entry
    // A keyboard Ctrl+Z lands mid-drag: restores the pre-gesture note and ends the gesture.
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.drawing!.notes![0]!.x).toBe(10);
    expect(useDocumentStore.getState().past.length).toBe(baseline);

    // The drag's next frame (stale pointer state, a real edge case) must open its own
    // entry rather than being silently swallowed as part of the ended gesture.
    store.updateDrawingNote(noteId, { x: 12, y: 10 });
    expect(useDocumentStore.getState().past.length).toBe(baseline + 1);

    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.drawing!.notes![0]!.x).toBe(10);
  });
});

describe("sketchStore undo history", () => {
  beforeEach(() => {
    // A fresh editing session — `beginSketch` resets the sketch undo history, so every
    // case starts from zero regardless of the case that ran before it.
    useSketchStore.getState().beginSketch("sketch-1", "plane-front");
  });

  it("a point drag that ends in a smart-coincident snap is a single undo step", () => {
    const store = useSketchStore.getState();
    store.drawPoint({ x: 10, y: 0 });
    store.drawPoint({ x: 30, y: 0 });
    const baseline = useSketchStore.getState().past.length;

    const dragged = pointAt(10, 0);
    const target = pointAt(30, 0);

    store.beginDrag();
    // Within the 2.5 snap tolerance of the target point — the release should suggest
    // (and commit) a coincident relation, the "constrains smart" flow.
    store.dragPoint(dragged.id, { x: 28.5, y: 0 });
    expect(useSketchStore.getState().dragSnapSuggestion?.kind).toBe("coincident");
    store.commitDragSnap(dragged.id);

    // One gesture, one entry — the snap must not open a second step on top of the drag.
    expect(useSketchStore.getState().past.length).toBe(baseline + 1);
    const snapped = activeSketch();
    expect(snapped.constraints.some((constraint) => constraint.kind === "coincident")).toBe(true);
    const snappedPoint = snapped.points.find((point) => point.id === dragged.id)!;
    expect(snappedPoint.x).toBeCloseTo(target.x);

    // One undo reverts the whole gesture — the relation *and* the moved point together.
    useSketchStore.getState().undo();
    const undone = activeSketch();
    expect(undone.constraints.some((constraint) => constraint.kind === "coincident")).toBe(false);
    expect(undone.points.find((point) => point.id === dragged.id)!.x).toBe(10);

    useSketchStore.getState().redo();
    expect(activeSketch().constraints.some((constraint) => constraint.kind === "coincident")).toBe(true);
  });

  it("a drag that changes nothing (a fixed point) pushes nothing", () => {
    const store = useSketchStore.getState();
    store.drawPoint({ x: 10, y: 0 });
    const point = pointAt(10, 0);
    store.setSelection([point.id]);
    expect(store.applyConstraint("fix")).toBe(true);
    const baseline = useSketchStore.getState().past.length;

    // A drag on a fixed point can't move it — the gesture must leave the history alone.
    store.beginDrag();
    store.dragPoint(point.id, { x: 20, y: 0 });
    store.commitDragSnap(point.id);
    expect(useSketchStore.getState().past.length).toBe(baseline);
    expect(pointAt(10, 0).id).toBe(point.id);

    // And the stack is not corrupted: undo still removes the *fix* on that point, not a
    // ghost step. (The sketch's own origin fix always remains — it belongs to the sketch,
    // not this test's edit history.)
    useSketchStore.getState().undo();
    const constraintsAfterUndo = activeSketch().constraints;
    expect(constraintsAfterUndo.some((c) => c.kind === "fix" && c.points.includes(point.id))).toBe(false);
    expect(constraintsAfterUndo.some((c) => c.kind === "fix" && !c.points.includes(point.id))).toBe(true);
  });

  it("dragging a dimension label is one undo step and is undoable", () => {
    const store = useSketchStore.getState();
    store.drawLine({ x: 0, y: 5 }, { x: 20, y: 5 });
    const line = activeSketch().entities.find((entity) => entity.kind === "line")!;

    // Propose-then-commit a Smart Dimension, the way the tool's own flow creates one.
    store.pickForSmartDimension(line.id);
    expect(useSketchStore.getState().pendingDimension).not.toBeNull();
    store.commitPendingDimension({ x: 10, y: 12 });
    const dimension = activeSketch().dimensions[activeSketch().dimensions.length - 1]!;
    const originalOffset = { ...dimension.labelOffset };
    const baseline = useSketchStore.getState().past.length;

    store.beginDrag();
    store.setDimensionLabelOffset(dimension.id, { x: 1, y: 1 });
    store.setDimensionLabelOffset(dimension.id, { x: 2, y: 2 });
    store.endDrag();

    expect(useSketchStore.getState().past.length).toBe(baseline + 1);
    expect(activeSketch().dimensions[activeSketch().dimensions.length - 1]!.labelOffset).toEqual({ x: 2, y: 2 });

    // Undo restores the label — previously a label drag wasn't undoable at all, and Ctrl+Z
    // after one surprisingly undid the last unrelated sketch edit instead.
    useSketchStore.getState().undo();
    expect(activeSketch().dimensions[activeSketch().dimensions.length - 1]!.labelOffset).toEqual(originalOffset);

    // Outside a gesture, a discrete offset change is still its own single step — pushing
    // the just-undone state and undoing again returns to it, not into the gesture's frames.
    store.setDimensionLabelOffset(dimension.id, { x: 3, y: 3 });
    expect(useSketchStore.getState().past.length).toBe(baseline + 1);
    useSketchStore.getState().undo();
    expect(activeSketch().dimensions[activeSketch().dimensions.length - 1]!.labelOffset).toEqual(originalOffset);
  });
});
