import { describe, expect, it } from "vitest";

import {
  buildEntityMap,
  buildLayout,
  evaluateResiduals,
  packVariables,
  residualSources,
} from "./residuals";
import { jacobian } from "./solver";
import { anchorsOf, arc, circle, dim, gc, line, p, sketch } from "./testFixtures";
import type { Sketch } from "./types";

/**
 * Proves the sparse Jacobian (each residual block perturbed only along its own variables)
 * reproduces the dense one (every column perturbed against the full residual vector) on
 * every constraint/dimension kind — the guarantee that a drift between a residual and its
 * dependency table in `residuals.ts` fails loudly instead of silently producing a solver
 * that converges to the wrong geometry.
 */

const DERIVATIVE_STEP = 1e-7;

/** The reference build: perturb every variable against the *full* residual vector. */
function denseJacobian(
  sk: Sketch,
  layout: ReturnType<typeof buildLayout>,
  values: Float64Array,
  anchors: Map<string, { x: number; y: number }>,
  entities: Map<string, Sketch["entities"][number]>,
): number[][] {
  const rows = evaluateResiduals(sk, layout, values, anchors, entities, entities).length;
  const matrix: number[][] = Array.from({ length: rows }, () => new Array(layout.size).fill(0));
  const probe = Float64Array.from(values);

  for (let column = 0; column < layout.size; column += 1) {
    const original = probe[column];
    const step = DERIVATIVE_STEP * Math.max(1, Math.abs(original));

    probe[column] = original + step;
    const forward = evaluateResiduals(sk, layout, probe, anchors, entities, entities);

    probe[column] = original - step;
    const backward = evaluateResiduals(sk, layout, probe, anchors, entities, entities);

    probe[column] = original;

    for (let row = 0; row < rows; row += 1) {
      matrix[row][column] = (forward[row] - backward[row]) / (2 * step);
    }
  }

  return matrix;
}

interface Compared {
  sparse: number[][];
  dense: number[][];
  layout: ReturnType<typeof buildLayout>;
}

function compare(sk: Sketch): Compared {
  const anchors = anchorsOf(sk);
  const entities = buildEntityMap(sk);
  const layout = buildLayout(sk);
  const values = packVariables(sk, layout);

  const sources = residualSources(sk, layout, values, anchors, entities, entities);
  const rows = evaluateResiduals(sk, layout, values, anchors, entities, entities).length;
  return {
    sparse: jacobian(sources, layout, values, rows),
    dense: denseJacobian(sk, layout, values, anchors, entities),
    layout,
  };
}

function assertMatches(actual: number[][], expected: number[][], label: string) {
  // On-support entries are computed from identical arithmetic, so they agree to machine
  // precision; off-support entries are genuinely ~0 in the dense build (a finite-difference
  // derivative of a constant function is FD noise, a few parts in 1e-9 at most, and sparse
  // leaves them exactly zero). Relative tolerance covers both, and the degenerate-scaled
  // rows (dividing by the MIN_LENGTH clamp pushes a few entries into the 1e9 range) would
  // defeat any absolute precision argument.
  expect(actual.length, label).toBe(expected.length);
  for (let row = 0; row < expected.length; row += 1) {
    expect(actual[row].length, `${label} width`).toBe(expected[row].length);
    for (let column = 0; column < expected[row].length; column += 1) {
      const a = actual[row][column];
      const b = expected[row][column];
      const scale = Math.max(1, Math.abs(a), Math.abs(b));
      expect(Math.abs(a - b), `${label}[${row}][${column}]`).toBeLessThan(1e-6 * scale);
    }
  }
}

function expectMatches(sk: Sketch, label: string) {
  const compared = compare(sk);
  assertMatches(compared.sparse, compared.dense, label);

  // The sparse build must never *invent* support: a cell it wrote is either the block's own
  // derivative (dense agrees, covered above) or a zero it stored from a variable outside the
  // block's set — the dense reference should see that same dependency as genuine, i.e. the
  // sparse zero columns (no source references the variable) stay zero in dense too.
  const zeroColumns = Array.from({ length: compared.layout.size }, (_, i) =>
    compared.sparse.every((row) => row[i] === 0),
  );
  for (let column = 0; column < zeroColumns.length; column += 1) {
    if (!zeroColumns[column]) continue;
    for (let row = 0; row < compared.dense.length; row += 1) {
      expect(Math.abs(compared.dense[row][column])).toBeLessThan(1e-7);
    }
  }
}

describe("sparse Jacobian matches the dense build", () => {
  it("coincident", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 3, 4), p("c", 9, 1)],
      [],
      [gc("c", "coincident", [], ["a", "b"]), gc("c2", "coincident", [], ["b", "c"])],
    );
    expectMatches(sk, "coincident");
  });

  it("horizontal and vertical", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 4), p("c", 2, 3), p("d", 7, 9)],
      [line("l1", "a", "b"), line("l2", "c", "d")],
      [gc("h", "horizontal", ["l1"]), gc("v", "vertical", ["l2"])],
    );
    expectMatches(sk, "horizontal/vertical");
  });

  it("parallel and perpendicular", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 7, 3), p("c", 1, 9), p("d", -2, 4), p("e", 5, 1), p("f", 11, 6)],
      [line("l1", "a", "b"), line("l2", "c", "d"), line("l3", "e", "f")],
      [gc("par", "parallel", ["l1", "l2"]), gc("per", "perpendicular", ["l1", "l3"])],
    );
    expectMatches(sk, "parallel/perpendicular");
  });

  it("point-on-line, point-on-circle, point-on-spline", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0), p("c", 5, 2), p("d", 4, 3), p("s0", 0, 0), p("s1", 5, 2), p("s2", 9, 0), p("t", 6, 0.5)],
      [line("l", "a", "b"), circle("k", "c", 3), { id: "sp", kind: "spline", points: ["s0", "s1", "s2"], construction: false }],
      [
        gc("pol", "point-on-line", ["l"], ["d"]),
        gc("poc", "point-on-circle", ["k"], ["d"]),
        gc("pos", "point-on-spline", ["sp"], ["t"]),
      ],
    );
    expectMatches(sk, "point-on-*");
  });

  it("fix on a plain point", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 5, 2)],
      [],
      [gc("f", "fix", [], ["a"])],
    );
    expectMatches(sk, "fix plain");
  });

  it("fix on the centre of a circle and an arc pins their radii too (the fix-radius edge)", () => {
    // The extra radius rows are dynamic: every circle/arc sharing the fixed centre point
    // gains a residual row. The sparse build must include those radii in the fix block's
    // dependency set or the consistency check fails.
    const sk = sketch(
      [p("c", 0, 0), p("s", 5, 0), p("e", 0, 5), p("far", 9, 9)],
      [circle("k", "c", 5), arc("a", "c", "s", "e", 5)],
      [gc("f", "fix", [], ["c"])],
    );
    expectMatches(sk, "fix on circle+arc centre");
  });

  it("fix-line", () => {
    const sk = sketch(
      [p("a", 1, 2), p("b", 8, 5)],
      [line("l", "a", "b")],
      [gc("fl", "fix-line", ["l"])],
    );
    expectMatches(sk, "fix-line");
  });

  it("midpoint", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 4), p("m", 6, 2)],
      [line("l", "a", "b")],
      [gc("m", "midpoint", ["l"], ["m"])],
    );
    expectMatches(sk, "midpoint");
  });

  it("colinear", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0), p("c", 2, 1), p("d", 9, 3)],
      [line("l1", "a", "b"), line("l2", "c", "d")],
      [gc("co", "colinear", ["l1", "l2"])],
    );
    expectMatches(sk, "colinear");
  });

  it("equal on two lines", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0), p("c", 1, 1), p("d", 5, 1)],
      [line("l1", "a", "b"), line("l2", "c", "d")],
      [gc("e", "equal", ["l1", "l2"])],
    );
    expectMatches(sk, "equal lines");
  });

  it("equal on two circles", () => {
    const sk = sketch(
      [p("c1", 0, 0), p("c2", 8, 2)],
      [circle("k1", "c1", 5), circle("k2", "c2", 3)],
      [gc("e", "equal", ["k1", "k2"])],
    );
    expectMatches(sk, "equal circles");
  });

  it("equal and concentric on a circle/arc pair", () => {
    const sk = sketch(
      [p("c1", 0, 0), p("c2", 8, 2), p("s", 8, 5), p("e", 11, 2)],
      [circle("k", "c1", 5), arc("a", "c2", "s", "e", 3)],
      [gc("eq", "equal", ["k", "a"]), gc("co", "concentric", ["k", "a"])],
    );
    expectMatches(sk, "equal+concentric circle/arc");
  });

  it("concentric on two arcs", () => {
    const sk = sketch(
      [p("c1", 0, 0), p("s1", 5, 0), p("e1", 0, 5), p("c2", 8, 2), p("s2", 11, 2), p("e2", 8, 5)],
      [arc("a1", "c1", "s1", "e1", 5), arc("a2", "c2", "s2", "e2", 3)],
      [gc("co", "concentric", ["a1", "a2"])],
    );
    expectMatches(sk, "concentric arcs");
  });

  it("arc-radius and tangent", () => {
    const sk = sketch(
      [p("c", 0, 0), p("s", 4, 0), p("e", 0, 4), p("a", 2, 6), p("b", 9, 6)],
      [arc("ar", "c", "s", "e", 4), line("l", "a", "b")],
      [gc("r", "arc-radius", ["ar"], ["s"]), gc("t", "tangent", ["l", "ar"])],
    );
    expectMatches(sk, "arc-radius+tangent");
  });

  describe("dimensions", () => {
    it("distance and point-line-distance", () => {
      const sk = sketch(
        [p("a", 0, 0), p("b", 6, 8), p("c", 3, 9)],
        [line("l", "a", "b")],
        [],
        [dim("d", "distance", 10, ["a", "b"]), dim("pld", "point-line-distance", 5, ["c"], ["l"])],
      );
      expectMatches(sk, "distance dims");
    });

    it("horizontal/vertical/ordinate distances are signed", () => {
      const sk = sketch(
        [p("a", 0, 0), p("b", 10, 0), p("c", 4, 3), p("d", 9, 7)],
        [],
        [],
        [
          dim("hd", "horizontal-distance", 10, ["a", "b"]),
          dim("vd", "vertical-distance", 4, ["b", "c"]),
          dim("ox", "ordinate-x", 4, ["a", "c"]),
          dim("oy", "ordinate-y", 3, ["a", "c"]),
        ],
      );
      expectMatches(sk, "ordinate dims");
    });

    it("radius and diameter", () => {
      const sk = sketch(
        [p("c", 0, 0)],
        [circle("k", "c", 3)],
        [],
        [dim("r", "radius", 3, [], ["k"]), dim("d", "diameter", 6, [], ["k"])],
      );
      expectMatches(sk, "radius/diameter dims");
    });

    it("angle", () => {
      const sk = sketch(
        [p("a", 0, 0), p("b", 5, 0), p("c", 1, 1), p("d", 3, 4)],
        [line("l1", "a", "b"), line("l2", "c", "d")],
        [],
        [dim("ang", "angle", 45, [], ["l1", "l2"])],
      );
      expectMatches(sk, "angle dim");
    });
  });

  it("a mixed sketch touching most kinds at once", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0), p("c", 10, 6), p("d", 0, 6), p("e", 5, 3), p("k", 12, 12), p("s", 14, 12), p("t", 12, 14)],
      [
        line("l1", "a", "b"),
        line("l2", "b", "c"),
        line("l3", "c", "d"),
        line("l4", "d", "a"),
        line("diag", "a", "c"),
        circle("cir", "k", 3),
        arc("a1", "k", "s", "t", 3),
      ],
      [
        gc("fx", "fix", [], ["a"]),
        gc("h", "horizontal", ["l1"]),
        gc("v", "vertical", ["l2"]),
        gc("par", "parallel", ["l1", "l3"]),
        gc("per", "perpendicular", ["l1", "l4"]),
        gc("mid", "midpoint", ["diag"], ["e"]),
        gc("col", "colinear", ["l4", "l3"]),
        gc("eq2", "equal", ["l1", "l3"]),
        gc("eqc", "equal", ["cir", "a1"]),
        gc("conc", "concentric", ["cir", "a1"]),
        gc("ar", "arc-radius", ["a1"], ["s"]),
        gc("pol", "point-on-line", ["l1"], ["e"]),
      ],
      [
        dim("d1", "distance", 10, ["a", "b"]),
        dim("d2", "horizontal-distance", 6, ["a", "c"]),
        dim("d3", "vertical-distance", 6, ["a", "c"]),
        dim("ang2", "angle", 90, [], ["l1", "l2"]),
        dim("rad", "radius", 3, [], ["cir"]),
        dim("pld2", "point-line-distance", 3, ["e"], ["l1"]),
      ],
    );
    expectMatches(sk, "mixed");
  });
});
