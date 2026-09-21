import { beforeEach, describe, expect, it } from "vitest";

import { sketchStatusFromDiagnostics } from "@/sketch/solver";

import { useSettingsStore } from "./settingsStore";
import { selectActiveSketch, useSketchStore } from "./sketchStore";

/**
 * Driven/reference dimensions through the real store actions — the flows the UI runs:
 * the right-click toggle, the Smart Dimension commit that auto-drives a dimension which
 * would over-define an already-pinned sketch, and the live value refresh during a drag.
 */

function activeSketch() {
  const sketch = selectActiveSketch(useSketchStore.getState());
  if (!sketch) throw new Error("no active sketch — beginSketch must run first");
  return sketch;
}

function pointAt(x: number, y: number) {
  const point = activeSketch().points.find((candidate) => candidate.x === x && candidate.y === y);
  if (!point) throw new Error(`no point at ${x},${y}`);
  return point;
}

/** Fixes one endpoint and smart-dimensions the span — leaves one dimension to work with. */
function fixStartAndDimensionSpan() {
  const store = useSketchStore.getState();
  store.drawLine({ x: 0, y: 0 }, { x: 10, y: 0 });
  const start = pointAt(0, 0);
  const end = pointAt(10, 0);

  store.setSelection([start.id]);
  store.applyConstraint("fix");
  store.setTool("smart-dimension");
  store.pickForSmartDimension(start.id);
  store.pickForSmartDimension(end.id);
  store.commitPendingDimension({ x: 12, y: 3 });

  return { start, end };
}

beforeEach(() => {
  useSettingsStore.setState({ smartConstraintEnabled: false, snapTolerance: 2.5 });
  useSketchStore.getState().beginSketch("driven-spec", "plane-front");
});

describe("driven dimensions (store)", () => {
  it("toggling driven frees the geometry the dimension was pinning", () => {
    const { start } = fixStartAndDimensionSpan();
    expect(pointAt(0, 0).id).toBe(start.id);

    const dimension = activeSketch().dimensions[0];
    // A merely under-defined sketch keeps the committed dimension driving (auto-driven
    // only fires when the dimension would be the conflict).
    expect(dimension.driven).toBeFalsy();
    expect(useSketchStore.getState().diagnostics.dof).toBe(1);

    const store = useSketchStore.getState();
    store.toggleDimensionDriving(dimension.id);
    expect(activeSketch().dimensions[0].driven).toBe(true);
    expect(useSketchStore.getState().diagnostics.dof).toBe(2); // only the fix remains

    store.toggleDimensionDriving(dimension.id);
    expect(activeSketch().dimensions[0].driven).toBeFalsy();
    expect(useSketchStore.getState().diagnostics.dof).toBe(1);
  });

  it("a committed dimension that would over-define the sketch lands as driven", () => {
    const store = useSketchStore.getState();
    store.drawLine({ x: 0, y: 0 }, { x: 10, y: 0 });
    const start = pointAt(0, 0);
    const end = pointAt(10, 0);

    // Pin both endpoints — fully defined.
    store.setSelection([start.id]);
    store.applyConstraint("fix");
    store.setSelection([end.id]);
    store.applyConstraint("fix");
    expect(useSketchStore.getState().diagnostics.dof).toBe(0);

    // Smart-dimension the pinned span: driving it would be a redundant fifth row over
    // four pinned variables, so it commits as a reference dimension and the sketch
    // stays clean instead of going over-defined red.
    store.setTool("smart-dimension");
    store.pickForSmartDimension(start.id);
    store.pickForSmartDimension(end.id);
    store.commitPendingDimension({ x: 12, y: 3 });

    const dimension = activeSketch().dimensions[0];
    expect(dimension.driven).toBe(true);
    expect(dimension.value).toBeCloseTo(10, 4);
    expect(useSketchStore.getState().diagnostics.dof).toBe(0);
    expect(useSketchStore.getState().conflictingIds).toEqual([]);
    expect(sketchStatusFromDiagnostics(useSketchStore.getState().diagnostics)).toBe("fully-defined");
  });

  it("a driven dimension's value follows a live drag", () => {
    const { end } = fixStartAndDimensionSpan();
    const store = useSketchStore.getState();

    const dimension = activeSketch().dimensions[0];
    store.toggleDimensionDriving(dimension.id);

    store.beginDrag();
    store.dragPoint(end.id, { x: 25, y: 0 });
    store.commitDragSnap(end.id);

    const settled = activeSketch().dimensions[0];
    expect(settled.driven).toBe(true);
    expect(settled.value).toBeCloseTo(25, 4);
  });
});
