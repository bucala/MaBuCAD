import { describe, expect, it } from "vitest";

import { solveSketch, sketchStatusFromDiagnostics } from "./solver";
import { circle, dim, gc, line, p, sketch } from "./testFixtures";

/**
 * The under-defined id sets `solveSketch` returns drive the viewport's blue/black entity
 * colouring — blue for anything that can still move, black for anything the constraints
 * pin outright. These pins are what keep that colouring honest: each case is a sketch
 * whose per-entity freedom a user could check by hand, including the subtle ones (a
 * point pinned only *through* another, a coupled pair that moves together).
 */
describe("solveSketch under-defined sets", () => {
  it("a free line and both its endpoints are under-defined", () => {
    const outcome = solveSketch(sketch([p("a", 0, 0), p("b", 10, 4)], [line("l", "a", "b")]));

    expect(outcome.diagnostics.dof).toBe(4);
    expect(outcome.underDefinedEntityIds).toEqual(new Set(["l"]));
    expect(outcome.underDefinedPointIds).toEqual(new Set(["a", "b"]));
  });

  it("a fully-defined line flags nothing", () => {
    const sk = sketch(
      [p("p1", 0, 0), p("p2", 12, 3)],
      [line("l", "p1", "p2")],
      [gc("f", "fix", [], ["p1"]), gc("h", "horizontal", ["l"])],
      [dim("d", "distance", 10, ["p1", "p2"])],
    );
    const outcome = solveSketch(sk);

    expect(sketchStatusFromDiagnostics(outcome.diagnostics)).toBe("fully-defined");
    expect(outcome.underDefinedEntityIds).toEqual(new Set());
    expect(outcome.underDefinedPointIds).toEqual(new Set());
  });

  it("a line pinned at both ends is fully defined while a neighbour stays free", () => {
    // Two independent lines: "fixed" has both endpoints fix-pinned, "free" has nothing.
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0), p("c", 0, 5), p("d", 8, 5)],
      [line("fixed", "a", "b"), line("free", "c", "d")],
      [gc("fa", "fix", [], ["a"]), gc("fb", "fix", [], ["b"])],
    );
    const outcome = solveSketch(sk);

    expect(outcome.underDefinedEntityIds).toEqual(new Set(["free"]));
    expect(outcome.underDefinedPointIds).toEqual(new Set(["c", "d"]));
  });

  it("a coincident point pinned only through its partner is fully defined", () => {
    // p1 is fix-pinned; p2 is coincident with p1, so p2 cannot move either — dragging it
    // would have to drag the fixed p1, which the pin forbids.
    const sk = sketch(
      [p("p1", 0, 0), p("p2", 4, 0)],
      [],
      [gc("f", "fix", [], ["p1"]), gc("c", "coincident", [], ["p1", "p2"])],
    );
    const outcome = solveSketch(sk);

    expect(outcome.diagnostics.dof).toBe(0);
    expect(outcome.underDefinedPointIds).toEqual(new Set());
  });

  it("a coincident pair with nothing else moves together — both points under-defined", () => {
    // The regression the mobility analysis exists for: the elimination pivots p1's own
    // columns (they look "pinned" column-by-column), but p1 co-moves with the free p2 —
    // dragging either point drags both. Counting free columns alone would have called
    // p1 fully defined and coloured it black while it visibly slides around the screen.
    const sk = sketch(
      [p("p1", 0, 0), p("p2", 4, 0)],
      [],
      [gc("c", "coincident", [], ["p1", "p2"])],
    );
    const outcome = solveSketch(sk);

    expect(outcome.diagnostics.dof).toBe(2);
    expect(outcome.underDefinedPointIds).toEqual(new Set(["p1", "p2"]));
  });

  it("a circle fixed at its centre (which also pins its radius) is fully defined", () => {
    const sk = sketch(
      [p("c", 5, 3)],
      [circle("k", "c", 4)],
      [gc("f", "fix", [], ["c"])],
    );
    const outcome = solveSketch(sk);

    expect(outcome.diagnostics.dof).toBe(0);
    expect(outcome.underDefinedEntityIds).toEqual(new Set());
    expect(outcome.underDefinedPointIds).toEqual(new Set());
  });

  it("a centre pinned by dimensions but an undimensioned radius leaves the circle blue and its centre dot black", () => {
    // The sharpest split the colouring can express: the centre point's own x/y columns
    // are pinned by the two ordinate dimensions, so the dot renders black, while the
    // radius column is free, so the circle's stroke renders blue.
    const sk = sketch(
      [p("o", 0, 0), p("c", 5, 3)],
      [circle("k", "c", 4)],
      [gc("f", "fix", [], ["o"])],
      [dim("dx", "horizontal-distance", 5, ["o", "c"]), dim("dy", "vertical-distance", 3, ["o", "c"])],
    );
    const outcome = solveSketch(sk);

    expect(outcome.diagnostics.dof).toBe(1);
    expect(outcome.underDefinedEntityIds).toEqual(new Set(["k"]));
    expect(outcome.underDefinedPointIds).toEqual(new Set());
  });

  it("a horizontal line keeps both endpoints under-defined (y coupled, x free)", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 4)],
      [line("l", "a", "b")],
      [gc("h", "horizontal", ["l"])],
    );
    const outcome = solveSketch(sk);

    expect(outcome.diagnostics.dof).toBe(3);
    expect(outcome.underDefinedEntityIds).toEqual(new Set(["l"]));
    expect(outcome.underDefinedPointIds).toEqual(new Set(["a", "b"]));
  });
});
