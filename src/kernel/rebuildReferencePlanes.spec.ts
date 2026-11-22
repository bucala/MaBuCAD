import { describe, expect, it } from "vitest";
import { measureVolume } from "replicad";

import type { Sketch } from "@/sketch/types";
import type { Feature } from "@/types/document";

import { __clearRebuildCacheForTesting, getCurrentShape, rebuildDocument, type Solid } from "./rebuild";
import { initKernel } from "./occ";

/**
 * Sketches on user reference planes: offset, flipped, chained and frozen-frame planes all
 * resolve through `sketch/planeBasis.ts`'s `planeFrame`, and the kernel has to place the
 * resulting solids exactly where the viewport draws the plane.
 */

function rectSketch(id: string, planeId: string, x0: number, y0: number, x1: number, y1: number): Sketch {
  const corners: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const ids = corners.map((_, i) => `${id}-p${i}`);
  return {
    id,
    planeId,
    points: corners.map(([x, y], i) => ({ id: ids[i]!, x, y })),
    entities: ids.map((pid, i) => ({
      id: `${id}-l${i}`,
      kind: "line" as const,
      start: pid,
      end: ids[(i + 1) % ids.length]!,
      construction: false,
    })),
    constraints: [],
    dimensions: [],
  };
}

function feature(id: string, kind: Feature["kind"], parents: string[], parameters: Feature["parameters"]): Feature {
  return { id, kind, name: id, suppressed: false, isDefault: false, parents, parameters };
}

function expectBoundsClose(actual: readonly number[], expected: readonly number[], precision = 4): void {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i]!, precision);
}

async function build(features: Feature[], sketches: Record<string, Sketch>, clear = true): Promise<Solid> {
  await initKernel();
  if (clear) __clearRebuildCacheForTesting();
  const result = await rebuildDocument(features, sketches);
  expect(result.errors).toEqual({});
  const shape = getCurrentShape();
  if (!shape) throw new Error("rebuild produced no shape");
  return shape;
}

describe("rebuild: sketches on reference planes", () => {
  it("extrudes from a Front plane offset 15 mm", async () => {
    const shape = await build(
      [
        feature("rp", "reference-plane", ["plane-front"], { distance: 15 }),
        feature("e", "extrude", ["s"], { depth: 5, endCondition: "blind", operation: "join" }),
      ],
      { s: rectSketch("s", "rp", 0, 0, 10, 10) },
    );
    const [min, max] = shape.boundingBox.bounds;
    expectBoundsClose(min, [0, 0, 15]);
    expectBoundsClose(max, [10, 10, 20]);
  }, 30_000);

  it("chains a reference plane off another one and off Top", async () => {
    const shape = await build(
      [
        feature("rp1", "reference-plane", ["plane-top"], { distance: 10 }),
        feature("rp2", "reference-plane", ["rp1"], { distance: 5 }),
        feature("e", "extrude", ["s"], { depth: 2, endCondition: "blind", operation: "join" }),
      ],
      { s: rectSketch("s", "rp2", 0, 0, 4, 4) },
    );
    const [min, max] = shape.boundingBox.bounds;
    // Top: local (x, y) -> world (x, 0, -y), normal +Y; origin at Y = 15.
    expectBoundsClose(min, [0, 15, -4]);
    expectBoundsClose(max, [4, 17, 0]);
  }, 30_000);

  it("a flipped plane extrudes the other way and mirrors local X", async () => {
    const shape = await build(
      [
        feature("rp", "reference-plane", ["plane-front"], { distance: -3, flipped: true }),
        feature("e", "extrude", ["s"], { depth: 5, endCondition: "blind", operation: "join" }),
      ],
      { s: rectSketch("s", "rp", 1, 0, 4, 2) },
    );
    const [min, max] = shape.boundingBox.bounds;
    // Origin Z = -3, normal -Z, local X -> world -X, local Y unchanged.
    expectBoundsClose(min, [-4, 0, -8]);
    expectBoundsClose(max, [-1, 2, -3]);
  }, 30_000);

  it("uses a frozen frame for a plane on a non-axis-aligned face", async () => {
    const s = Math.SQRT1_2;
    const shape = await build(
      [
        feature("rp", "reference-plane", [], {
          distance: 0,
          frame: { origin: [10, 0, 0], xDir: [0, 1, 0], normal: [s, 0, s] },
        }),
        feature("e", "extrude", ["sk"], { depth: 1, endCondition: "blind", operation: "join" }),
      ],
      { sk: rectSketch("sk", "rp", -1, -1, 1, 1) },
    );
    const centre = shape.boundingBox.center;
    // The 2×2 square is centred on the frame origin and pushed 0.5 mm along the normal.
    expect(centre[0]).toBeCloseTo(10 + 0.5 * s, 3);
    expect(centre[1]).toBeCloseTo(0, 3);
    expect(centre[2]).toBeCloseTo(0.5 * s, 3);
  }, 30_000);

  it("moves the feature when the plane's offset is edited, even with a warm cache", async () => {
    const sketches = { s: rectSketch("s", "rp", 0, 0, 10, 10) };
    const extrude = feature("e", "extrude", ["s"], { depth: 5, endCondition: "blind", operation: "join" });
    await build([feature("rp", "reference-plane", ["plane-front"], { distance: 15 }), extrude], sketches);

    // The plane now sits *after* the extrude (reordered), so only the resolved-plane part
    // of the extrude's cache key can notice the change.
    const moved = await build(
      [extrude, feature("rp", "reference-plane", ["plane-front"], { distance: 30 })],
      sketches,
      false,
    );
    const [min] = moved.boundingBox.bounds;
    expect(min[2]).toBeCloseTo(30, 4);
  }, 30_000);

  it("lofts between profiles on two parallel offset planes at their real positions", async () => {
    const shape = await build(
      [
        feature("rp", "reference-plane", ["plane-front"], { distance: 12 }),
        feature("l", "loft", ["a", "b"], { depth: 99 }),
      ],
      { a: rectSketch("a", "plane-front", -5, -5, 5, 5), b: rectSketch("b", "rp", -2, -2, 2, 2) },
    );
    // OCCT's bounding box is loose on the lofted (B-spline) side faces, so check the
    // frustum's exact volume plus a coarse extent: h/3·(A1 + A2 + √(A1·A2)) = 4·156 = 624.
    // The `depth` of 99 would have spread the profiles 99 mm apart if it were used.
    expect(measureVolume(shape as never)).toBeCloseTo(624, 1);
    const [min, max] = shape.boundingBox.bounds;
    expect(min[2]).toBeCloseTo(0, 0);
    expect(max[2]).toBeCloseTo(12, 0);
  }, 30_000);
});
