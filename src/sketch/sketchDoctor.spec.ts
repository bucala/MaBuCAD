import { describe, expect, it } from "vitest";

import { findConflictingConstraints, solveSketch } from "./solver";
import { diagnoseSketch, RELATION_LABEL } from "./sketchDoctor";
import { circle, dim, gc, line, p, sketch } from "./testFixtures";

/**
 * The Sketch Doctor's diagnosis — the pure reinterpretation of solver output
 * (`diagnostics` + `conflictingIds` + `underDefinedEntityIds`) that feeds the panel's
 * Doctor section. These pins hold the contracts the section renders against: per-kind
 * ordinals ("Line 2", "Circle 1"), construction geometry excluded from the free list
 * (it never turns blue, so "select the blue ones" must not name it), point-only
 * relations reporting no targets, dimension conflicts carrying their kind and value,
 * and the over-defined state with no singly-responsible relation still being reported
 * honestly as over-defined.
 */
describe("diagnoseSketch", () => {
  it("lists free entities with per-kind ordinals, skipping construction geometry", () => {
    const sk = sketch(
      [
        p("a", 0, 0),
        p("b", 10, 0),
        p("c", 0, 5),
        p("d", 8, 5),
        p("e", 0, 10),
        p("f", 0, 20),
        p("g", 6, 10),
      ],
      [
        line("fixed", "a", "b"),
        line("free", "c", "d"),
        { ...line("constr", "e", "g"), construction: true },
        circle("c1", "f", 2),
      ],
      [gc("fa", "fix", [], ["a"]), gc("fb", "fix", [], ["b"])],
    );
    const outcome = solveSketch(sk);

    const health = diagnoseSketch(sk, outcome.diagnostics, [], [...outcome.underDefinedEntityIds]);

    expect(health.status).toBe("under-defined");
    expect(health.freeEntities).toEqual([
      { id: "free", kind: "line", ordinal: 2 },
      { id: "c1", kind: "circle", ordinal: 1 },
    ]);
  });

  it("reports a fully-defined sketch with no conflicts and no free entities", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0)],
      [line("l", "a", "b")],
      [gc("fa", "fix", [], ["a"]), gc("h", "horizontal", ["l"])],
      [dim("d", "distance", 10, ["a", "b"])],
    );
    const outcome = solveSketch(sk);
    expect(outcome.diagnostics.dof).toBe(0);

    const health = diagnoseSketch(sk, outcome.diagnostics, [], [...outcome.underDefinedEntityIds]);

    expect(health.status).toBe("fully-defined");
    expect(health.conflicts).toEqual([]);
    expect(health.freeEntities).toEqual([]);
  });

  it("reports a dimension conflict with its kind and driving value", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0)],
      [line("l", "a", "b")],
      [gc("fa", "fix", [], ["a"]), gc("fb", "fix", [], ["b"])],
      [dim("d", "distance", 10, ["a", "b"])],
    );
    const outcome = solveSketch(sk);
    expect(outcome.diagnostics.redundant).toBe(true);

    const health = diagnoseSketch(sk, outcome.diagnostics, [...findConflictingConstraints(sk)], []);

    expect(health.status).toBe("over-defined");
    // Point-only fix relations report no entity targets; the dimension reports kind+value.
    expect(health.conflicts).toEqual([
      { id: "fa", source: "constraint", kind: "fix", targets: [] },
      { id: "fb", source: "constraint", kind: "fix", targets: [] },
      { id: "d", source: "dimension", kind: "distance", targets: [], value: 10 },
    ]);
  });

  it("names the entities a relation conflict acts on", () => {
    // Two identical horizontal relations on the same line: the second row duplicates the
    // first, so redundancy is guaranteed by rank rather than left to non-convergence.
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0), p("c", 0, 5), p("d", 8, 5)],
      [line("l1", "a", "b"), line("l2", "c", "d")],
      [gc("p", "parallel", ["l1", "l2"]), gc("h1", "horizontal", ["l1"]), gc("h2", "horizontal", ["l1"])],
    );

    const health = diagnoseSketch(sk, solveSketch(sk).diagnostics, [...findConflictingConstraints(sk)], []);

    expect(health.status).toBe("over-defined");
    expect(health.conflicts.map((conflict) => conflict.kind)).toEqual(["horizontal", "horizontal"]);
    expect(health.conflicts[0].targets).toEqual([{ id: "l1", kind: "line", ordinal: 1 }]);
    expect(health.conflicts[1].targets).toEqual([{ id: "l1", kind: "line", ordinal: 1 }]);
  });

  it("reports over-defined even when no single relation is singly to blame", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0)],
      [line("l", "a", "b")],
      [gc("fa", "fix", [], ["a"]), gc("fb", "fix", [], ["b"])],
      [dim("d", "distance", 10, ["a", "b"])],
    );

    const health = diagnoseSketch(sk, solveSketch(sk).diagnostics, [], []);

    expect(health.status).toBe("over-defined");
    expect(health.conflicts).toEqual([]);
  });

  it("never surfaces a driven dimension as a conflict", () => {
    const sk = sketch(
      [p("a", 0, 0), p("b", 10, 0)],
      [line("l", "a", "b")],
      [gc("fa", "fix", [], ["a"]), gc("fb", "fix", [], ["b"])],
      [
        dim("d", "distance", 10, ["a", "b"]),
        { ...dim("dr", "distance", 11, ["a", "b"]), driven: true },
      ],
    );

    const health = diagnoseSketch(sk, solveSketch(sk).diagnostics, [...findConflictingConstraints(sk)], []);

    expect(health.conflicts.map((conflict) => conflict.id)).toContain("d");
    expect(health.conflicts.map((conflict) => conflict.id)).not.toContain("dr");
  });
});

describe("RELATION_LABEL", () => {
  it("covers the internal kinds the glyph map skips", () => {
    expect(RELATION_LABEL["arc-radius"]).toBe("Arc radius");
    expect(RELATION_LABEL["point-on-spline"]).toBe("Point on spline");
    expect(RELATION_LABEL["fix-line"]).toBe("Fix line (extendable)");
  });
});
