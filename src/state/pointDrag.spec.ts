import { beforeEach, describe, expect, it } from "vitest";

import type { SketchEntity } from "@/sketch/types";

import { useSettingsStore } from "./settingsStore";
import { selectActiveSketch, useSketchStore } from "./sketchStore";

/**
 * Point-drag behaviour through the real store action — the flow `SketchCanvas.tsx` runs on
 * every pointermove of a point drag.
 *
 * The regression this suite exists for: `solveSketch`'s pre-drag anchoring (introduced to
 * keep real Fix/Fix-Line constraints from following a drag) also anchored the drag's own
 * pin to the dragged point's *pre-drag* position, so every drag solved straight back to
 * where it started — a silent no-op drag. The pin now carries its own cursor target
 * (`GeometricConstraint.at`), so both behaviours coexist: real fixes stay anchored
 * pre-drag, the pin pulls to the cursor.
 */

function activeSketch() {
  const sketch = selectActiveSketch(useSketchStore.getState());
  if (!sketch) throw new Error("no active sketch — beginSketch must run first");
  return sketch;
}

beforeEach(() => {
  useSettingsStore.setState({ smartConstraintEnabled: false, snapTolerance: 2.5 });
  useSketchStore.getState().beginSketch("drag-spec", "plane-front");
});

describe("dragPoint", () => {
  it("moves a free point to the cursor", () => {
    const store = useSketchStore.getState();
    store.drawPoint({ x: 10, y: 0 });
    const dragged = activeSketch().points.find((point) => point.x === 10 && point.y === 0)!;

    store.beginDrag();
    store.dragPoint(dragged.id, { x: 28.5, y: 3 });
    store.commitDragSnap(dragged.id);

    const settled = activeSketch().points.find((point) => point.id === dragged.id)!;
    expect(settled.x).toBeCloseTo(28.5, 4);
    expect(settled.y).toBeCloseTo(3, 4);
  });

  it("still keeps a Fix-Line's own extension fixed while its endpoint slides along it", () => {
    const store = useSketchStore.getState();
    store.drawLine({ x: 0, y: 0 }, { x: 10, y: 0 });
    const sketch = activeSketch();
    const line = sketch.entities.find((entity) => entity.kind === "line")!;
    const endpoint = sketch.points.find((point) => point.x === 10 && point.y === 0)!;

    // Fix on a line dispatches to `fix-line` — pins the infinite extension, not the
    // endpoints, so they stay free to slide along it.
    store.setSelection([line.id]);
    expect(store.applyConstraint("fix")).toBe(true);
    expect(activeSketch().constraints.some((constraint) => constraint.kind === "fix-line")).toBe(true);

    // Drag the endpoint off to the side: the pin wants the cursor, the fix-line wants the
    // line to stay put — the point must land on the line's own extension, not anywhere.
    // (The pin's residual is weighted down by design, so the constraint holds to better
    // than a micron while the point slides freely along the open direction.)
    store.beginDrag();
    store.dragPoint(endpoint.id, { x: 30, y: 5 });
    store.commitDragSnap(endpoint.id);

    const settled = activeSketch();
    const settledEndpoint = settled.points.find((point) => point.id === endpoint.id)!;
    expect(settledEndpoint.y).toBeCloseTo(0, 3);
    expect(settledEndpoint.x).toBeCloseTo(30, 3);
    // The line's other end and its direction are untouched — the pre-drag anchoring the
    // fix-line residual reads is exactly the behaviour the anchor map still provides.
    // (Sub-micron drift on both ends is the weighted pin's least-squares footprint; what
    // the assertion pins is that neither end left the line's fixed extension.)
    const settledLine = settled.entities.find(
      (entity): entity is Extract<SketchEntity, { kind: "line" }> => entity.id === line.id && entity.kind === "line",
    )!;
    const start = settled.points.find((point) => point.id === settledLine.start)!;
    expect(start.x).toBeCloseTo(0, 3);
    expect(start.y).toBeCloseTo(0, 3);
  });

  it("does not resize a circle whose centre is dragged — the radius pins to pre-drag", () => {
    const store = useSketchStore.getState();
    store.drawCircle({ x: 10, y: 0 }, 5);
    const circle = activeSketch().entities.find((entity) => entity.kind === "circle")!;

    store.beginDrag();
    store.dragPoint(circle.center, { x: 20, y: 0 });
    store.commitDragSnap(circle.center);

    const settled = activeSketch();
    const centre = settled.points.find((point) => point.id === circle.center)!;
    expect(centre.x).toBeCloseTo(20, 4);
    expect(centre.y).toBeCloseTo(0, 4);
    const settledCircle = settled.entities.find((entity) => entity.id === circle.id)!;
    if (settledCircle.kind !== "circle") throw new Error("expected the dragged circle to stay a circle");
    expect(settledCircle.radius).toBeCloseTo(5, 6);
  });

  it("refuses to move a directly fixed point at all", () => {
    const store = useSketchStore.getState();
    store.drawPoint({ x: 10, y: 0 });
    const dragged = activeSketch().points.find((point) => point.x === 10 && point.y === 0)!;
    store.setSelection([dragged.id]);
    expect(store.applyConstraint("fix")).toBe(true);

    store.beginDrag();
    store.dragPoint(dragged.id, { x: 40, y: 0 });
    store.commitDragSnap(dragged.id);

    const settled = activeSketch().points.find((point) => point.id === dragged.id)!;
    expect(settled.x).toBe(10);
    expect(settled.y).toBe(0);
  });
});
