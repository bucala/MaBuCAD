import { describe, expect, it } from "vitest";

import { angleDimensionGeometry } from "./sketchModel";
import { dim, line, p, sketch } from "./testFixtures";

describe("angleDimensionGeometry", () => {
  it("uses the shared endpoint as the vertex and spans the drawn sector", () => {
    // Two lines meeting at the origin: one along +X, one at 60° above it.
    const sk = sketch(
      [p("v", 0, 0), p("a", 20, 0), p("b", 10, 10 * Math.tan(Math.PI / 3))],
      [line("la", "v", "a"), line("lb", "v", "b")],
      [],
      [dim("d", "angle", 60, [], ["la", "lb"])],
    );
    const geometry = angleDimensionGeometry(sk, sk.dimensions[0]);
    expect(geometry).not.toBeNull();
    expect(geometry!.vertex.x).toBeCloseTo(0);
    expect(geometry!.vertex.y).toBeCloseTo(0);
    expect(geometry!.rayA).toEqual({ x: 1, y: 0 });
    expect(geometry!.sweep).toBeCloseTo(Math.PI / 3);
    expect(geometry!.spanA.far).toBeCloseTo(20);
  });

  it("intersects non-touching lines to find the vertex", () => {
    // A horizontal line at y=0 and a vertical line at x=5, neither touching (5, 0).
    const sk = sketch(
      [p("a1", 0, 0), p("a2", 4, 0), p("b1", 5, 3), p("b2", 5, 8)],
      [line("la", "a1", "a2"), line("lb", "b1", "b2")],
      [],
      [dim("d", "angle", 90, [], ["la", "lb"])],
    );
    const geometry = angleDimensionGeometry(sk, sk.dimensions[0]);
    expect(geometry).not.toBeNull();
    expect(geometry!.vertex.x).toBeCloseTo(5);
    expect(geometry!.vertex.y).toBeCloseTo(0);
    expect(Math.abs(geometry!.sweep)).toBeCloseTo(Math.PI / 2);
    // Line A's ray points toward its farther endpoint a1 (-X): the segment then covers
    // projections 1..5 along it — the gap between the vertex and the segment is exactly
    // what the witness-line rule reads off `near`.
    expect(geometry!.rayA.x).toBeCloseTo(-1);
    expect(geometry!.spanA.near).toBeCloseTo(1);
    expect(geometry!.spanA.far).toBeCloseTo(5);
  });

  it("flips ray B when the stored value is the supplement (Flip)", () => {
    const sk = sketch(
      [p("v", 0, 0), p("a", 20, 0), p("b", 10, 10 * Math.tan(Math.PI / 3))],
      [line("la", "v", "a"), line("lb", "v", "b")],
      [],
      [dim("d", "angle", 120, [], ["la", "lb"])],
    );
    const geometry = angleDimensionGeometry(sk, sk.dimensions[0]);
    expect(geometry).not.toBeNull();
    expect(Math.abs(geometry!.sweep)).toBeCloseTo((120 * Math.PI) / 180);
    // The flipped ray points back down the opposite way along line B (60° + 180°).
    expect(geometry!.rayB.x).toBeCloseTo(Math.cos((240 * Math.PI) / 180));
    expect(geometry!.rayB.y).toBeCloseTo(Math.sin((240 * Math.PI) / 180));
  });

  it("returns null for parallel lines, matching the renderer's label-only fallback", () => {
    const sk = sketch(
      [p("a1", 0, 0), p("a2", 10, 0), p("b1", 0, 5), p("b2", 10, 5)],
      [line("la", "a1", "a2"), line("lb", "b1", "b2")],
      [],
      [dim("d", "angle", 0, [], ["la", "lb"])],
    );
    expect(angleDimensionGeometry(sk, sk.dimensions[0])).toBeNull();
  });
});
