import { describe, expect, it } from "vitest";

import {
  buildEntityMap,
  buildLayout,
  evaluateResiduals,
  packVariables,
} from "./residuals";
import { anchorsOf, arc, circle, dim, gc, line, p, sketch } from "./testFixtures";

/** Residual vector of a sketch at its own stored positions — what the solver starts from. */
function evaluateAtRest(sk: ReturnType<typeof sketch>): number[] {
  const layout = buildLayout(sk);
  const values = packVariables(sk, layout);
  return evaluateResiduals(sk, layout, values, anchorsOf(sk), buildEntityMap(sk), buildEntityMap(sk));
}

describe("residual equations", () => {
  it("a coincidence between two points reports their offset", () => {
    const sk = sketch([p("a", 0, 0), p("b", 3, 4)], [], [gc("c", "coincident", [], ["a", "b"])]);
    expect(evaluateAtRest(sk)).toEqual([expect.closeTo(-3, 1e-9), expect.closeTo(-4, 1e-9)]);
  });

  it("horizontal and vertical relations report the coordinate mismatch", () => {
    const horizontal = sketch(
      [p("a", 0, 0), p("b", 2, 5)],
      [line("l", "a", "b")],
      [gc("h", "horizontal", ["l"])],
    );
    expect(evaluateAtRest(horizontal)).toEqual([expect.closeTo(-5, 1e-9)]);

    const vertical = sketch(
      [p("a", 1, 0), p("b", 7, 2)],
      [line("l", "a", "b")],
      [gc("v", "vertical", ["l"])],
    );
    expect(evaluateAtRest(vertical)).toEqual([expect.closeTo(-6, 1e-9)]);
  });

  it("an equal relation between two lines reports the length difference", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0), p("c", 0, 1), p("d", 4, 1)],
      [line("l1", "a", "b"), line("l2", "c", "d")],
      [gc("e", "equal", ["l1", "l2"])],
    );
    expect(evaluateAtRest(sk)).toEqual([expect.closeTo(6, 1e-9)]);
  });

  it("an equal relation between a circle and an arc compares their radii (the 2026-09 audit fix)", () => {
    // Before the fix an arc fell through to the line branch and the constraint silently
    // contributed nothing — this residual would be an empty vector, not 3.
    const sk = sketch(
      [p("c1", 0, 0), p("c2", 8, 2), p("s", 8, 5), p("e", 11, 2)],
      [circle("k", "c1", 5), arc("a", "c2", "s", "e", 3)],
      [gc("e", "equal", ["k", "a"])],
    );
    expect(evaluateAtRest(sk)).toEqual([expect.closeTo(2, 1e-9)]);
  });

  it("a concentric relation between a circle and an arc compares their centres (the 2026-09 audit fix)", () => {
    const sk = sketch(
      [p("c1", 0, 0), p("c2", 8, 2), p("s", 8, 5), p("e", 11, 2)],
      [circle("k", "c1", 5), arc("a", "c2", "s", "e", 3)],
      [gc("c", "concentric", ["k", "a"])],
    );
    expect(evaluateAtRest(sk)).toEqual([expect.closeTo(-8, 1e-9), expect.closeTo(-2, 1e-9)]);
  });

  it("an arc-radius relation reports how far a rim point sits off the arc's own circle", () => {
    const sk = sketch(
      [p("c", 0, 0), p("s", 3, 4)],
      [arc("a", "c", "s", "s", 2)],
      [gc("r", "arc-radius", ["a"], ["s"])],
    );
    expect(evaluateAtRest(sk)).toEqual([expect.closeTo(3, 1e-9)]);
  });

  it("a tangent relation reports the gap between the line's distance to the centre and the radius", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0), p("c", 5, 7)],
      [line("l", "a", "b"), circle("k", "c", 3)],
      [gc("t", "tangent", ["l", "k"])],
    );
    expect(evaluateAtRest(sk)).toEqual([expect.closeTo(4, 1e-9)]);
  });

  it("a right-angle dimension between a horizontal and a vertical line is satisfied at rest", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0), p("c", 0, 0), p("d", 0, 8)],
      [line("l1", "a", "b"), line("l2", "c", "d")],
      [],
      [dim("ang", "angle", 90, [], ["l1", "l2"])],
    );
    expect(evaluateAtRest(sk)).toEqual([expect.closeTo(0, 1e-9)]);
  });

  it("an angle dimension on a zero-length line contributes no equation (the 2026-09 audit fix)", () => {
    // atan2(0, 0) is noise and its finite-difference derivative poisons the Jacobian;
    // the guard makes the dimension sit out until the line has actual extent.
    const sk = sketch(
      [p("a", 0, 0), p("b", 0, 0), p("c", 0, 0), p("d", 10, 0)],
      [line("l1", "a", "b"), line("l2", "c", "d")],
      [],
      [dim("ang", "angle", 90, [], ["l1", "l2"])],
    );
    expect(evaluateAtRest(sk)).toEqual([]);
  });

  it("a diameter dimension reports twice the radius minus the target", () => {
    const sk = sketch(
      [p("c", 0, 0)],
      [circle("k", "c", 3)],
      [],
      [dim("d", "diameter", 10, [], ["k"])],
    );
    expect(evaluateAtRest(sk)).toEqual([expect.closeTo(-4, 1e-9)]);
  });
});
