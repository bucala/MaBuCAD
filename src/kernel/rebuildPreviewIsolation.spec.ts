import { describe, expect, it } from "vitest";
import { measureVolume } from "replicad";

import type { Sketch } from "@/sketch/types";
import type { Feature } from "@/types/document";

import { __clearRebuildCacheForTesting, getCurrentShape, rebuildDocument } from "./rebuild";
import { initKernel } from "./occ";

/**
 * Regression coverage for WP01 ("a preview rebuild during Fillet/Chamfer edge-pick could
 * overwrite the confirmed tree's shape, so Export/Measure/drawing projection read the
 * preview instead"): `geometryStore.ts`'s `rebuildPreview` — fired continuously for as long
 * as edge-pick mode stays open, with one feature forced `suppressed` to show the body as it
 * was before the feature being edited — called the exact same `rebuildDocument` a real,
 * confirmed rebuild uses, writing through the same shared `currentShape`/`checkpoints`.
 * `rebuildDocument`/`rebuildDocumentSync` now take an optional `persist` (default `true`);
 * `rebuildPreview` passes `false`, which skips the three lines that write `checkpoints`/
 * `currentShape` back out, so a preview can never leak into what every other consumer of
 * `getCurrentShape()` reads.
 */

function squareSketch(id: string, points: [number, number][]): Sketch {
  const p = (pid: string, px: number, py: number) => ({ id: pid, x: px, y: py });
  const ids = points.map((_, i) => `${id}-p${i}`);
  return {
    id,
    planeId: "plane-front",
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

describe("rebuildDocument(persist=false): a preview never leaks into the confirmed shape", () => {
  it("a suppressed-feature preview rebuild does not change getCurrentShape()'s confirmed result", async () => {
    await initKernel();
    __clearRebuildCacheForTesting();

    const sketches: Record<string, Sketch> = {
      s1: squareSketch("s1", [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ]),
      s2: squareSketch("s2", [
        [25, 5],
        [35, 5],
        [35, 15],
        [25, 15],
      ]),
    };
    const features: Feature[] = [
      feature("f0", "extrude", ["s1"], { depth: 10, endCondition: "blind", operation: "join" }),
      feature("f1", "extrude", ["s2"], { depth: 5, endCondition: "blind", operation: "join" }),
    ];

    const confirmed = await rebuildDocument(features, sketches);
    expect(confirmed.errors).toEqual({});
    const confirmedShape = getCurrentShape();
    expect(confirmedShape).not.toBeNull();
    const confirmedVolume = measureVolume(confirmedShape as unknown as never);
    const confirmedVertexCount = confirmed.mesh!.positions.length;

    // The preview Fillet/Chamfer edge-pick would run: the same two features, but with f1
    // forced suppressed — a materially different, smaller body (just the base block). Its
    // own volume has to come from the `RebuildResult` it returns directly, not
    // `getCurrentShape()` — that function is exactly what `persist=false` must leave
    // untouched, so reading the preview's own shape through it would defeat the test.
    const withoutF1 = features.map((f) => (f.id === "f1" ? { ...f, suppressed: true } : f));
    const preview = await rebuildDocument(withoutF1, sketches, false);
    expect(preview.errors).toEqual({});
    expect(preview.mesh).not.toBeNull();

    // The preview's own result really is different (proves the preview call itself worked
    // and isn't a no-op this assertion would trivially pass against) — fewer vertices, since
    // it built only the base block, not the base block fused with the second one.
    expect(preview.mesh!.positions.length).toBeLessThan(confirmedVertexCount);

    // But getCurrentShape() must still be exactly the confirmed body — persist=false means
    // the preview never wrote through to it.
    expect(getCurrentShape()).toBe(confirmedShape);
    expect(measureVolume(getCurrentShape() as unknown as never)).toBeCloseTo(confirmedVolume, 1);
  }, 30_000);

  it("a confirmed rebuild after a preview still reflects the real tree, not the preview's", async () => {
    await initKernel();
    __clearRebuildCacheForTesting();

    const sketches: Record<string, Sketch> = {
      s1: squareSketch("s1", [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
    };
    const features: Feature[] = [
      feature("f0", "extrude", ["s1"], { depth: 10, endCondition: "blind", operation: "join" }),
    ];

    await rebuildDocument(features, sketches);

    // A preview run with everything suppressed — the degenerate "nothing built" case.
    const allSuppressed = features.map((f) => ({ ...f, suppressed: true }));
    const preview = await rebuildDocument(allSuppressed, sketches, false);
    expect(preview.mesh).toBeNull();

    // getCurrentShape() must still be the real body, not null from the preview's own
    // "nothing built" result.
    expect(getCurrentShape()).not.toBeNull();

    // And a real confirmed rebuild of the same document afterward still works correctly.
    const confirmedAgain = await rebuildDocument(features, sketches);
    expect(confirmedAgain.errors).toEqual({});
    expect(getCurrentShape()).not.toBeNull();
  }, 30_000);
});
