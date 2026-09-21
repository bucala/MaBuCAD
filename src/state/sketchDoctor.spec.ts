import { beforeEach, describe, expect, it } from "vitest";

import { diagnoseSketch } from "@/sketch/sketchDoctor";
import { sketchStatusFromDiagnostics } from "@/sketch/solver";

import { useSettingsStore } from "./settingsStore";
import { selectActiveSketch, useSketchStore } from "./sketchStore";

/**
 * The Sketch Doctor through the real store — the flow the panel runs: an over-defined
 * sketch's state surfaces the offending relation's id, the Doctor section renders it as a
 * delete row, and `deleteConstraint` removes exactly that relation (one undo step), which
 * re-solves the sketch out of the conflict.
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

beforeEach(() => {
  useSettingsStore.setState({ smartConstraintEnabled: false, snapTolerance: 2.5 });
  useSketchStore.getState().beginSketch("doctor-spec", "plane-front");
});

describe("sketch doctor (store)", () => {
  it("deleteConstraint removes exactly the relation the Doctor flags, and undo restores it", () => {
    const store = useSketchStore.getState();
    store.drawLine({ x: 0, y: 0 }, { x: 10, y: 0 });
    const lineId = activeSketch().entities[0].id;
    const start = pointAt(0, 0);
    const end = pointAt(10, 0);

    // Pin both endpoints, then impose a direction the pins already force — the
    // horizontal row is identically satisfied, so it is redundant: over-defined, with
    // the horizontal relation among the singly-responsible offenders the panel lists.
    store.setSelection([start.id]);
    store.applyConstraint("fix");
    store.setSelection([end.id]);
    store.applyConstraint("fix");
    store.setSelection([lineId]);
    store.applyConstraint("horizontal");

    expect(sketchStatusFromDiagnostics(useSketchStore.getState().diagnostics)).toBe("over-defined");
    const horizontal = activeSketch().constraints.find((constraint) => constraint.kind === "horizontal");
    expect(horizontal).toBeDefined();
    expect(useSketchStore.getState().conflictingIds).toContain(horizontal!.id);

    // The Doctor section's own view of the same store data names the row to delete.
    const { diagnostics, conflictingIds, underDefinedEntityIds } = useSketchStore.getState();
    const health = diagnoseSketch(activeSketch(), diagnostics, conflictingIds, underDefinedEntityIds);
    const doctorRow = health.conflicts.find((conflict) => conflict.id === horizontal!.id);
    expect(doctorRow).toEqual({
      id: horizontal!.id,
      source: "constraint",
      kind: "horizontal",
      targets: [{ id: lineId, kind: "line", ordinal: 1 }],
    });

    useSketchStore.getState().deleteConstraint(horizontal!.id);

    expect(activeSketch().constraints.map((constraint) => constraint.kind)).toEqual(["fix", "fix"]);
    expect(useSketchStore.getState().conflictingIds).toEqual([]);
    expect(sketchStatusFromDiagnostics(useSketchStore.getState().diagnostics)).toBe("fully-defined");

    useSketchStore.getState().undo();

    expect(activeSketch().constraints.map((constraint) => constraint.kind)).toEqual([
      "fix",
      "fix",
      "horizontal",
    ]);
    expect(sketchStatusFromDiagnostics(useSketchStore.getState().diagnostics)).toBe("over-defined");
    expect(useSketchStore.getState().conflictingIds).toContain(horizontal!.id);
  });
});
