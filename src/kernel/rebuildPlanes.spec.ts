import { describe, expect, it } from "vitest";
import { measureVolume } from "replicad";

import type { Sketch } from "@/sketch/types";
import type { Feature } from "@/types/document";

import { getCurrentShape, rebuildDocument, type Solid } from "./rebuild";
import { initKernel } from "./occ";
import { __clearRebuildCacheForTesting } from "./rebuild";

/**
 * Regression coverage for WP02 ("a feature sketched on a plane other than Front — or two
 * features on different planes composed by a boolean — produced wrong geometry"): every
 * sketch-based feature builder (`buildFeatureSolid`, `buildRevolveSolid`, `buildHoleSolid`,
 * `buildRibSolid`, `buildLoftSolid`) used to embed its profile via the kernel's literal
 * "XY" plane regardless of the sketch's own declared `planeId`, relying on a single
 * whole-mesh *cosmetic display* rotation (the last-built feature's own plane) to make the
 * *viewport* look right — which only ever happened to produce correct underlying kernel
 * geometry (`getCurrentShape()`, what export and every boolean actually operate on) when
 * every feature in the document shared one plane that was also the kernel's literal "XY"
 * (`REFERENCE_PLANES`'s Front plane). A lone feature on the Top or Right plane was already
 * wrong in the kernel's own B-Rep even by itself; two features on different planes combined
 * by `fuse`/`cut` combined geometry each built as if *both* were on Front, not their own
 * actual plane. `rebuild.ts` now embeds every sketch-based feature via its own true
 * world-space `Plane` (`replicadPlaneFor`), so these specs assert against `getCurrentShape()`
 * directly — the raw kernel solid, not the display layer that used to mask this.
 */

function squareSketch(id: string, planeId: string, points: [number, number][]): Sketch {
  const p = (pid: string, px: number, py: number) => ({ id: pid, x: px, y: py });
  const ids = points.map((_, i) => `${id}-p${i}`);
  return {
    id,
    planeId,
    points: points.map((pt, i) => p(ids[i]!, pt[0], pt[1])),
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

/** OCCT's own bounding box is a fast, deliberately loose over-estimate, not an exact
 * geometric bound — a flat extrude's comes within ~1e-7mm of the analytical box, but a
 * curved (revolved) face's can overshoot by a few hundredths of a mm, so `precision` is
 * widened per-assertion rather than everywhere using `toEqual`'s exact-equality. */
function expectBoundsClose(actual: [number, number, number], expected: [number, number, number], precision = 4): void {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], precision);
}

async function build(features: Feature[], sketches: Record<string, Sketch>): Promise<Solid> {
  await initKernel();
  __clearRebuildCacheForTesting();
  const result = await rebuildDocument(features, sketches);
  expect(result.errors).toEqual({});
  const shape = getCurrentShape();
  if (!shape) throw new Error("rebuild produced no shape");
  return shape;
}

describe("rebuild: sketch-based features embed via their own true plane", () => {
  it(
    "an extrude on the Top plane lands in Top's own world orientation, not Front's",
    async () => {
      const sketches: Record<string, Sketch> = {
        s1: squareSketch("s1", "plane-top", [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ]),
      };
      const features: Feature[] = [
        feature("f0", "extrude", ["s1"], { depth: 5, endCondition: "blind", operation: "join" }),
      ];

      const shape = await build(features, sketches);
      const [min, max] = shape.boundingBox.bounds;

      // Top's own basis (REFERENCE_PLANES: rotation [-π/2, 0, 0]) maps a local sketch point
      // (x, y) to world (x, 0, -y), and the local-Z extrude direction to world +Y — so this
      // 10×10 square extruded by 5 should span world X[0,10], Y[0,5], Z[-10,0]. The old,
      // plane-blind code instead built this in the kernel's literal XY (as if it were on
      // Front), landing at world X[0,10], Y[0,10], Z[0,5] — a different box on every axis.
      expectBoundsClose(min, [0, 0, -10]);
      expectBoundsClose(max, [10, 5, 0]);
    },
    30_000,
  );

  it(
    "a revolve on the Top plane sweeps around Top's own mapped axis, not a raw local one",
    async () => {
      // No explicit axis line: `revolveAxis`'s fallback is the sketch's own local Y axis
      // through its local origin — which Top's basis maps to the world Z axis through the
      // world origin, not world Y. A 5×5 profile offset from that axis (local X 5..10,
      // local Y 0..5, i.e. world X 5..10, world Z -5..0) revolved 360° around it sweeps out
      // a ring: full X/Y extent ±10 (the outer radius), Z confined to the profile's own
      // mapped -5..0 band. The old plane-blind code revolved the *same local coordinates*
      // around the *unmapped* local-Y-as-world-Y axis instead, sweeping out a ring with the
      // X/Z and Y roles swapped — a different shape on every axis, not just rotated.
      const sketches: Record<string, Sketch> = {
        s1: squareSketch("s1", "plane-top", [
          [5, 0],
          [10, 0],
          [10, 5],
          [5, 5],
        ]),
      };
      const features: Feature[] = [feature("f0", "revolve", ["s1"], { angle: 360 })];

      const shape = await build(features, sketches);
      const [min, max] = shape.boundingBox.bounds;

      expectBoundsClose(min, [-10, -10, -5], 1);
      expectBoundsClose(max, [10, 10, 0], 1);
    },
    30_000,
  );

  it(
    "a cut-extrude on the Top plane removes material at Top's own world location, not Front's",
    async () => {
      // A 20mm cube on Front (world X/Y/Z all [0, 20]), then a through-all square tunnel
      // cut from a sketch on Top at local X [5,15], local Y [-15,-5] — Top's basis maps
      // that to world X [5,15] (unchanged), world Z [5,15] (= -localY), extruded through
      // all along world Y: a 10×20×10 tunnel (2000 mm³) fully inside the cube's footprint,
      // leaving 8000 - 2000 = 6000 mm³. The old plane-blind code instead cut at the *local*
      // coordinates read straight as world X/Y (X [5,15], Y [-15,-5]) extruded through all
      // along world Z — entirely outside the cube's own Y [0, 20] range, removing nothing
      // and leaving the full 8000 mm³: a sharp, unmistakable difference, not a rounding one.
      const sketches: Record<string, Sketch> = {
        base: squareSketch("base", "plane-front", [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ]),
        cutter: squareSketch("cutter", "plane-top", [
          [5, -15],
          [15, -15],
          [15, -5],
          [5, -5],
        ]),
      };
      const features: Feature[] = [
        feature("f0", "extrude", ["base"], { depth: 20, endCondition: "blind", operation: "join" }),
        feature("f1", "cut-extrude", ["cutter"], { endCondition: "through-all", operation: "cut" }),
      ];

      const shape = await build(features, sketches);
      expect(measureVolume(shape as never)).toBeCloseTo(6000, 1);
    },
    30_000,
  );

  it(
    "a plain extrude on the Front plane is unaffected (Front IS the kernel's literal XY)",
    async () => {
      const sketches: Record<string, Sketch> = {
        s1: squareSketch("s1", "plane-front", [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ]),
      };
      const features: Feature[] = [
        feature("f0", "extrude", ["s1"], { depth: 5, endCondition: "blind", operation: "join" }),
      ];

      const shape = await build(features, sketches);
      const [min, max] = shape.boundingBox.bounds;
      expectBoundsClose(min, [0, 0, 0]);
      expectBoundsClose(max, [10, 10, 5]);
    },
    30_000,
  );
});
