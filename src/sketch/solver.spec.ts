import { describe, expect, it } from "vitest";

import { evaluateResiduals, buildEntityMap, buildLayout, packVariables } from "./residuals";
import { solveSketch, findConflictingConstraints, sketchStatusFromDiagnostics } from "./solver";
import { anchorsOf, arc, dim, gc, line, p, sketch } from "./testFixtures";

/** Residual norm of a sketch at its own stored positions — the solver's starting error. */
function residualNormAtRest(sk: ReturnType<typeof sketch>): number {
  const layout = buildLayout(sk);
  const values = packVariables(sk, layout);
  const residuals = evaluateResiduals(sk, layout, values, anchorsOf(sk), buildEntityMap(sk), buildEntityMap(sk));
  return Math.hypot(...residuals);
}

describe("solveSketch", () => {
  it("a free line keeps all four degrees of freedom", () => {
    const outcome = solveSketch(sketch([p("a", 0, 0), p("b", 10, 4)], [line("l", "a", "b")]));

    expect(outcome.diagnostics.dof).toBe(4);
    expect(outcome.diagnostics.converged).toBe(true);
    expect(sketchStatusFromDiagnostics(outcome.diagnostics)).toBe("under-defined");
  });

  it("a horizontal relation removes one degree of freedom", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 4)],
      [line("l", "a", "b")],
      [gc("h", "horizontal", ["l"])],
    );
    expect(solveSketch(sk).diagnostics.dof).toBe(3);
  });

  it("fix + horizontal + length fully defines a line and solves it exactly", () => {
    // Deliberately perturbed input: p2 starts at (12, 3) where the constraints say (10, 0).
    const sk = sketch(
      [p("p1", 0, 0), p("p2", 12, 3)],
      [line("l", "p1", "p2")],
      [gc("f", "fix", [], ["p1"]), gc("h", "horizontal", ["l"])],
      [dim("d", "distance", 10, ["p1", "p2"])],
    );
    const outcome = solveSketch(sk);

    expect(outcome.diagnostics.converged).toBe(true);
    expect(outcome.diagnostics.dof).toBe(0);
    expect(sketchStatusFromDiagnostics(outcome.diagnostics)).toBe("fully-defined");

    const solvedP2 = outcome.sketch.points.find((point) => point.id === "p2");
    expect(solvedP2?.x).toBeCloseTo(10, 6);
    expect(solvedP2?.y).toBeCloseTo(0, 6);

    const solvedP1 = outcome.sketch.points.find((point) => point.id === "p1");
    expect(solvedP1?.x).toBeCloseTo(0, 6);
    expect(solvedP1?.y).toBeCloseTo(0, 6);
  });

  it("equal and concentric relations on arcs actually pull the arcs together (the 2026-09 audit fix)", () => {
    // Two arcs at different centres and radii, held circular by their own arc-radius
    // relations. Before the fix both constraints were silent no-ops on arcs: the solve
    // returned the sketch unchanged and the radii stayed 5 vs 3.
    const sk = sketch(
      [p("c1", 0, 0), p("s1", 5, 0), p("e1", 0, 5), p("c2", 8, 2), p("s2", 11, 2), p("e2", 8, 5)],
      [arc("a1", "c1", "s1", "e1", 5), arc("a2", "c2", "s2", "e2", 3)],
      [
        gc("r1", "arc-radius", ["a1"], ["s1"]),
        gc("r2", "arc-radius", ["a1"], ["e1"]),
        gc("r3", "arc-radius", ["a2"], ["s2"]),
        gc("r4", "arc-radius", ["a2"], ["e2"]),
        gc("eq", "equal", ["a1", "a2"]),
        gc("co", "concentric", ["a1", "a2"]),
      ],
    );
    const outcome = solveSketch(sk);

    expect(outcome.diagnostics.converged).toBe(true);
    expect(outcome.diagnostics.dof).toBe(7);

    const radiusOf = (id: string) => {
      const entity = outcome.sketch.entities.find((candidate) => candidate.id === id);
      return entity?.kind === "arc" || entity?.kind === "circle" ? entity.radius : Number.NaN;
    };
    expect(Math.abs(radiusOf("a1") - radiusOf("a2"))).toBeLessThan(1e-6);

    const centre = (id: string) => {
      const entity = outcome.sketch.entities.find((candidate) => candidate.id === id);
      if (entity?.kind !== "arc") return { x: NaN, y: NaN };
      return outcome.sketch.points.find((point) => point.id === entity.center)!;
    };
    const c1 = centre("a1");
    const c2 = centre("a2");
    expect(Math.hypot(c1.x - c2.x, c1.y - c2.y)).toBeLessThan(1e-6);
  });

  it("a conflicting system never returns less satisfying geometry than it was given (the 2026-09 audit fix)", () => {
    // p1 pinned at the origin, with two distance dimensions to p2 that want 10 mm and
    // 5 mm at once — unsatisfiable. The pre-fix solver accepted every finite step and
    // could wander off anywhere; now the result is at least as good as the input.
    const sk = sketch(
      [p("p1", 0, 0), p("p2", 3, 0)],
      [],
      [gc("f", "fix", [], ["p1"])],
      [dim("d1", "distance", 10, ["p1", "p2"]), dim("d2", "distance", 5, ["p1", "p2"])],
    );
    const inputNorm = residualNormAtRest(sk);
    expect(inputNorm).toBeGreaterThan(0);

    const outcome = solveSketch(sk);

    expect(outcome.diagnostics.converged).toBe(false);
    expect(outcome.diagnostics.redundant).toBe(true);
    expect(outcome.diagnostics.residualNorm).toBeLessThanOrEqual(inputNorm);
    for (const point of outcome.sketch.points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it("findConflictingConstraints reports exactly the two dimensions that conflict", () => {
    const sk = sketch(
      [p("p1", 0, 0), p("p2", 3, 0)],
      [],
      [gc("f", "fix", [], ["p1"])],
      [dim("d1", "distance", 10, ["p1", "p2"]), dim("d2", "distance", 5, ["p1", "p2"])],
    );
    expect(findConflictingConstraints(sk)).toEqual(new Set(["d1", "d2"]));
  });

  it("a zero-length line does not keep an angle dimension from solving the rest (the 2026-09 audit fix)", () => {
    // The angle dimension involves a degenerate line, so it sits out; the remaining
    // relations must still solve cleanly. Pre-fix, atan2(0, 0)'s noisy derivative
    // poisoned the Jacobian and dragged the iteration off course.
    const sk = sketch(
      [p("a", 0, 0), p("b", 0, 0), p("c", 0, 0), p("d", 10, 0)],
      [line("l1", "a", "b"), line("l2", "c", "d")],
      [gc("h", "horizontal", ["l2"])],
      [dim("ang", "angle", 90, [], ["l1", "l2"]), dim("len", "distance", 10, ["c", "d"])],
    );
    const outcome = solveSketch(sk);

    expect(outcome.diagnostics.converged).toBe(true);
    const solvedD = outcome.sketch.points.find((point) => point.id === "d");
    expect(solvedD?.x).toBeCloseTo(10, 6);
    expect(solvedD?.y).toBeCloseTo(0, 6);
    for (const point of outcome.sketch.points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it("status mapping follows the diagnostics flags", () => {
    expect(sketchStatusFromDiagnostics({ dof: 0, converged: true, redundant: false, residualNorm: 0, iterations: 1 })).toBe("fully-defined");
    expect(sketchStatusFromDiagnostics({ dof: 2, converged: true, redundant: false, residualNorm: 0, iterations: 1 })).toBe("under-defined");
    expect(sketchStatusFromDiagnostics({ dof: 0, converged: false, redundant: false, residualNorm: 1, iterations: 60 })).toBe("over-defined");
    expect(sketchStatusFromDiagnostics({ dof: 0, converged: true, redundant: true, residualNorm: 0, iterations: 1 })).toBe("over-defined");
  });
});
