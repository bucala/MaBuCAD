import { describe, expect, it } from "vitest";

import { findConflictingConstraints, sketchStatusFromDiagnostics, solveSketch } from "./solver";
import { circle, dim, gc, line, p, sketch } from "./testFixtures";
import type { Dimension } from "./types";

/** The `driven: true` twin of the `dim` fixture — a reference dimension. */
function ref(dimension: Dimension): Dimension {
  return { ...dimension, driven: true };
}

/**
 * Driven (reference) dimensions — SolidWorks' "driven", Inventor's/Onshape's "reference":
 * a dimension that measures the geometry instead of constraining it. These pins hold the
 * three contracts everything else leans on: no equations (the DOF readout and conflict
 * scans ignore it entirely), a value that follows the solved geometry (the label never
 * lies), and the driving/driven contrast (the same dimension flips the sketch's status
 * the moment it does constrain).
 */
describe("driven dimensions", () => {
  it("adds no equations: a fully-defined sketch stays fully-defined with one", () => {
    const points = [p("a", 0, 0), p("b", 10, 0)];
    const entities = [line("l", "a", "b")];
    const constraints = [gc("fa", "fix", [], ["a"]), gc("fb", "fix", [], ["b"])];

    const driven = solveSketch(
      sketch(points, entities, constraints, [ref(dim("d", "distance", 10, ["a", "b"]))]),
    );
    expect(driven.diagnostics.dof).toBe(0);
    expect(sketchStatusFromDiagnostics(driven.diagnostics)).toBe("fully-defined");
    expect(driven.underDefinedEntityIds.size).toBe(0);

    // The same dimension driving: a fifth row over four pinned variables — redundant,
    // which is exactly the over-defined state the auto-driven commit path looks for.
    const driving = solveSketch(
      sketch(points, entities, constraints, [dim("d", "distance", 10, ["a", "b"])]),
    );
    expect(sketchStatusFromDiagnostics(driving.diagnostics)).toBe("over-defined");
  });

  it("never shows up as the conflict offender", () => {
    const points = [p("a", 0, 0), p("b", 10, 0)];
    const entities = [line("l", "a", "b")];
    const constraints = [gc("fa", "fix", [], ["a"]), gc("fb", "fix", [], ["b"])];

    // Driving: the offender scan flags every relation whose removal alone clears the
    // over-defined flags — here all three (either fix, or the dimension), the same
    // "a minimal pair reports both" rule `findConflictingConstraints`'s own doc comment
    // documents. What matters for the contrast is that the dimension is among them.
    const driving = findConflictingConstraints(
      sketch(points, entities, constraints, [dim("d", "distance", 10, ["a", "b"])]),
    );
    expect(driving.has("d")).toBe(true);

    // Driven: the sketch isn't over-defined at all (the dimension contributes no rows),
    // so the scan has nothing to report — a reference dimension can never be an offender.
    const driven = findConflictingConstraints(
      sketch(points, entities, constraints, [ref(dim("d", "distance", 10, ["a", "b"]))]),
    );
    expect(driven).toEqual(new Set());
  });

  it("a driven length follows the solved geometry", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0)],
      [line("l", "a", "b")],
      [gc("f", "fix", [], ["a"])],
      [
        dim("drive", "distance", 20, ["a", "b"]), // pulls b out to 20 mm from a
        ref(dim("ref", "distance", 999, ["a", "b"])),
      ],
    );

    const outcome = solveSketch(sk);
    const refreshed = outcome.sketch.dimensions.find((d) => d.id === "ref")!;
    expect(refreshed.value).toBeCloseTo(20, 6);
  });

  it("a driven radius follows the solved circle", () => {
    const sk = sketch(
      [p("o", 0, 0), p("c", 5, 3)],
      [circle("k", "c", 4)],
      [gc("f", "fix", [], ["o"])],
      [
        dim("dx", "ordinate-x", 5, ["o", "c"]),
        dim("dy", "ordinate-y", 3, ["o", "c"]),
        dim("r", "radius", 6, [], ["k"]),
        ref(dim("ref", "radius", 99, [], ["k"])),
      ],
    );

    const outcome = solveSketch(sk);
    expect(outcome.diagnostics.dof).toBe(0);
    const refreshed = outcome.sketch.dimensions.find((d) => d.id === "ref")!;
    expect(refreshed.value).toBeCloseTo(6, 6);
  });

  it("a driven angle follows the solved geometry, in degrees", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0), p("c", 3, 1), p("d", 3, 6)],
      [line("l1", "a", "b"), line("l2", "c", "d")],
      [
        gc("fa", "fix", [], ["a"]),
        gc("fb", "fix", [], ["b"]),
        gc("fc", "fix", [], ["c"]),
        gc("v", "vertical", ["l2"]),
      ],
      [
        dim("len", "distance", 5, ["c", "d"]),
        ref(dim("ref", "angle", 45, [], ["l1", "l2"])),
      ],
    );

    const outcome = solveSketch(sk);
    expect(outcome.diagnostics.dof).toBe(0);
    const refreshed = outcome.sketch.dimensions.find((d) => d.id === "ref")!;
    expect(refreshed.value).toBeCloseTo(90, 6);
  });

  it("keeps its last value when the geometry has nothing to measure yet", () => {
    // A degenerate (zero-length) line has no angle — the refresh must keep the stored
    // value rather than inventing 0. This also covers the solver's no-equations early
    // path: the sketch's only dimension contributes no rows at all.
    const sk = sketch(
      [p("a", 0, 0), p("b", 0, 0), p("c", 0, 0), p("d", 10, 0)],
      [line("l1", "a", "b"), line("l2", "c", "d")],
      [],
      [ref(dim("ref", "angle", 33, [], ["l1", "l2"]))],
    );

    const outcome = solveSketch(sk);
    const kept = outcome.sketch.dimensions.find((d) => d.id === "ref")!;
    expect(kept.value).toBe(33);
  });
});
