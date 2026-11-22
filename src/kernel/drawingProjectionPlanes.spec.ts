import { describe, expect, it } from "vitest";

import type { Sketch } from "@/sketch/types";
import type { CadDocument, Feature, StandardProjectionKind } from "@/types/document";

import { rebuildAndProjectPart, sectionArrowSign, sectionAxisAndOffset } from "./drawingProjection";
import { initKernel } from "./occ";
import { __clearRebuildCacheForTesting } from "./rebuild";

/**
 * Regression coverage for the Front/Top/Right drawing-view axis mismatch: replicad's own
 * named projection cameras (`"front"|"top"|"bottom"|"left"|"right"|"back"`) are a fixed,
 * Z-up rig (its own doc comment: Front looks down world −Y, Top down world −Z, Right down
 * world −X) that has nothing to do with this app's own Y-up `REFERENCE_PLANES` (Front's
 * normal is world +Z, Top's is world +Y, Right's is world +X). Before `drawingProjection.ts`
 * gained `APP_TO_REPLICAD_PLANE`, a feature built on this app's Top plane projected edge-on
 * under replicad's own `"top"` camera and only showed up correctly under its `"front"`/
 * `"back"` — i.e. it appeared in this app's *Front* drawing view, not its *Top* one. These
 * specs build a hole on each reference plane in turn and assert it lands as a circle in the
 * drawing view of the *same name*, and nowhere else among the other two axes' views.
 */

function blockWithHoleDocument(planeId: string): { document: CadDocument; sketches: Record<string, Sketch> } {
  const basePoints = [
    { id: "bp1", x: 0, y: 0 },
    { id: "bp2", x: 20, y: 0 },
    { id: "bp3", x: 20, y: 20 },
    { id: "bp4", x: 0, y: 20 },
  ];
  const sketches: Record<string, Sketch> = {
    "sketch-base": {
      id: "sketch-base",
      planeId,
      points: basePoints,
      entities: [
        { id: "bl1", kind: "line", start: "bp1", end: "bp2", construction: false },
        { id: "bl2", kind: "line", start: "bp2", end: "bp3", construction: false },
        { id: "bl3", kind: "line", start: "bp3", end: "bp4", construction: false },
        { id: "bl4", kind: "line", start: "bp4", end: "bp1", construction: false },
      ],
      constraints: [],
      dimensions: [],
    },
    "sketch-hole": {
      id: "sketch-hole",
      planeId,
      points: [{ id: "hp1", x: 10, y: 10 }],
      entities: [{ id: "hole-point", kind: "point", at: "hp1", construction: false }],
      constraints: [],
      dimensions: [],
    },
  };

  const feature = (id: string, kind: Feature["kind"], parents: string[], parameters: Feature["parameters"]): Feature => ({
    id,
    kind,
    name: id,
    suppressed: false,
    isDefault: false,
    parents,
    parameters,
  });

  const features: Feature[] = [
    feature("sketch-base", "sketch", [planeId], {}),
    feature("extrude-base", "extrude", ["sketch-base"], { depth: 8, endCondition: "blind", operation: "join" }),
    feature("sketch-hole", "sketch", [planeId], {}),
    feature("hole-1", "hole", ["sketch-hole"], { radius: 2.5, depth: 8, endCondition: "through-all" }),
  ];

  return {
    document: {
      id: `doc-${planeId}`,
      name: planeId,
      kind: "part",
      features,
      rollbackIndex: features.length,
      variables: {},
      sensors: [],
    },
    sketches,
  };
}

describe("drawing projection: Front/Top/Right views match REFERENCE_PLANES, not replicad's raw camera names", () => {
  const cases: { planeId: string; matchingView: StandardProjectionKind; otherViews: StandardProjectionKind[] }[] = [
    { planeId: "plane-front", matchingView: "front", otherViews: ["top", "right"] },
    { planeId: "plane-top", matchingView: "top", otherViews: ["front", "right"] },
    { planeId: "plane-right", matchingView: "right", otherViews: ["front", "top"] },
  ];

  for (const { planeId, matchingView, otherViews } of cases) {
    it(
      `a hole on ${planeId} projects as a circle in the "${matchingView}" view, not ${otherViews.join("/")}`,
      async () => {
        await initKernel();
        __clearRebuildCacheForTesting();
        const { document, sketches } = blockWithHoleDocument(planeId);

        const projected = await rebuildAndProjectPart(document, sketches);
        expect(projected?.errors).toEqual({});

        expect(projected?.views[matchingView].holeTargets).toHaveLength(1);
        expect(projected?.views[matchingView].holeTargets?.[0]).toMatchObject({ radius: 2.5 });

        for (const other of otherViews) {
          expect(projected?.views[other].holeTargets ?? []).toHaveLength(0);
        }
      },
      30_000,
    );
  }
});

describe("sectionAxisAndOffset / sectionArrowSign: every (projection, orientation) is a bare, unflipped axis", () => {
  it("maps each view's own (u, v) straight onto its world axis with no sign flip", () => {
    expect(sectionAxisAndOffset("front", "vertical", 7, 3)).toEqual({ axis: "x", offset: 7 });
    expect(sectionAxisAndOffset("front", "horizontal", 7, 3)).toEqual({ axis: "y", offset: 3 });
    expect(sectionAxisAndOffset("top", "vertical", 7, 3)).toEqual({ axis: "x", offset: 7 });
    expect(sectionAxisAndOffset("top", "horizontal", 7, 3)).toEqual({ axis: "z", offset: 3 });
    expect(sectionAxisAndOffset("right", "vertical", 7, 3)).toEqual({ axis: "y", offset: 7 });
    expect(sectionAxisAndOffset("right", "horizontal", 7, 3)).toEqual({ axis: "z", offset: 3 });
  });

  it("is projection-independent now that every axis mapping shares one sign convention", () => {
    expect(sectionArrowSign("vertical", true)).toBe(1);
    expect(sectionArrowSign("vertical", false)).toBe(-1);
    expect(sectionArrowSign("horizontal", true)).toBe(-1);
    expect(sectionArrowSign("horizontal", false)).toBe(1);
  });
});
