import { describe, expect, it } from "vitest";

import { resolveTapDrill } from "@/data/holeResolution";
import type { Sketch } from "@/sketch/types";
import type { CadDocument, Feature } from "@/types/document";

import { auxiliaryCamera, rebuildAndProjectAuxiliary, rebuildAndProjectPart } from "./drawingProjection";
import { initKernel } from "./occ";
import { __clearRebuildCacheForTesting } from "./rebuild";

/** A 20 mm block on the Front plane with one tapped Hole Wizard point at its centre —
 * Front, not Top: `rebuildPartShape`'s raw kernel shape feeds straight into replicad's own
 * Front/Top/Right projection cameras with no adjustment for which of *this app's* reference
 * planes (`REFERENCE_PLANES`) the sketch was actually drawn on, and only the Front plane's
 * own normal (world +Z) lines up with the axis replicad's "top" camera (looking down world
 * −Z) expects a hole target to run along; this fixture needs a circle in the "top" drawing
 * view, so it has to be built on the plane that actually produces one, not the
 * similarly-named reference plane that doesn't. `seat` splices extra parameters (a
 * counterbore seat, …) into the hole feature. */
function tappedHoleDocument(
  seat?: Feature["parameters"],
): { document: CadDocument; sketches: Record<string, Sketch> } {
  const basePoints = [
    { id: "bp1", x: 0, y: 0 },
    { id: "bp2", x: 20, y: 0 },
    { id: "bp3", x: 20, y: 20 },
    { id: "bp4", x: 0, y: 20 },
  ];
  const sketches: Record<string, Sketch> = {
    "sketch-base": {
      id: "sketch-base",
      planeId: "plane-front",
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
      planeId: "plane-front",
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
  const tap = resolveTapDrill("iso-metric", "M6x1");
  if (!tap) throw new Error("M6x1 must exist in the tapped-hole standard");

  const features: Feature[] = [
    feature("sketch-base", "sketch", ["plane-front"], {}),
    feature("extrude-base", "extrude", ["sketch-base"], { depth: 8, endCondition: "blind", operation: "join" }),
    feature("sketch-hole", "sketch", ["plane-front"], {}),
    feature("hole-1", "hole", ["sketch-hole"], {
      radius: tap.tapDrill / 2,
      depth: 8,
      endCondition: "through-all",
      holeType: "tapped",
      holeStandard: "iso-metric",
      holeSize: "M6x1",
      threadDesignation: "M6x1 (6H)",
      threadDirection: "left",
      fullDepthThread: true,
      ...(seat ?? {}),
    }),
  ];

  return {
    document: {
      id: "doc-tapped-hole",
      name: "Tapped hole",
      kind: "part",
      features,
      rollbackIndex: features.length,
      variables: {},
      sensors: [],
    },
    sketches,
  };
}

describe("drawing projection hole targets", () => {
  it(
    "projects a tapped Hole Wizard circle with its structured callout metadata",
    async () => {
      await initKernel();
      __clearRebuildCacheForTesting();
      const { document, sketches } = tappedHoleDocument();

      const projected = await rebuildAndProjectPart(document, sketches);
      expect(projected?.errors).toEqual({});

      const top = projected?.views.top;
      expect(top?.holeTargets).toHaveLength(1);
      expect(top?.threadPaths).toHaveLength(1);
      expect(top?.holeTargets?.[0]).toMatchObject({
        radius: 2.5,
        metadata: {
          sourceFeatureId: "hole-1",
          holeType: "tapped",
          diameter: 5,
          holeDepth: 8,
          endCondition: "through-all",
          designation: "M6x1",
          threadClass: "6H",
          threadDirection: "left",
          fullDepthThread: true,
        },
      });
    },
    120_000,
  );

  it(
    "snapshots a counterbore seat without mistaking the seat circle for a hole target",
    async () => {
      await initKernel();
      __clearRebuildCacheForTesting();
      const { document, sketches } = tappedHoleDocument({
        seatType: "counterbore",
        seatDiameter: 11,
        seatDepthOrAngle: 6.8,
      });

      const projected = await rebuildAndProjectPart(document, sketches);
      expect(projected?.errors).toEqual({});

      // The seat's own wider circle (⌀11) is real projected geometry but not a *hole*
      // circle, so it must not become a pickable target — only the drilled cylinder is.
      const top = projected?.views.top;
      expect(top?.holeTargets).toHaveLength(1);
      expect(top?.holeTargets?.[0]).toMatchObject({
        radius: 2.5,
        metadata: {
          seatType: "counterbore",
          seatDiameter: 11,
          seatDepthOrAngle: 6.8,
        },
      });
    },
    120_000,
  );
});

describe("auxiliary drawing projection", () => {
  it(
    "tilts a standard camera and returns real projected geometry",
    async () => {
      await initKernel();
      __clearRebuildCacheForTesting();
      const { document, sketches } = tappedHoleDocument();

      const base = auxiliaryCamera("front", "horizontal", 0).direction.toTuple();
      const tilted = auxiliaryCamera("front", "horizontal", 30).direction.toTuple();
      expect(tilted).not.toEqual(base);

      const projected = await rebuildAndProjectAuxiliary(document, sketches, "front", "horizontal", 30);
      expect(projected).not.toBeNull();
      expect(projected?.width).toBeGreaterThan(0);
      expect(projected?.height).toBeGreaterThan(0);
      expect(projected?.visiblePaths.length).toBeGreaterThan(0);
    },
    120_000,
  );
});
