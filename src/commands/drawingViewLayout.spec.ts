import { describe, expect, it } from "vitest";

import type { DrawingViewData } from "@/types/document";

import { alignmentLinkFor, alignmentTargetFor, clampBrokenBand, clampCropRegion } from "./drawingViewLayout";

describe("derived drawing view regions", () => {
  it("keeps a crop inside the source view and preserves a usable window", () => {
    expect(clampCropRegion(100, 60, { x: 90, y: -10, width: 30, height: 2 })).toEqual({
      x: 70,
      y: 0,
      width: 30,
      height: 4,
    });
  });

  it("limits an oversized crop to the source view", () => {
    expect(clampCropRegion(12, 8, { x: -20, y: 20, width: 100, height: 100 })).toEqual({
      x: 0,
      y: 0,
      width: 12,
      height: 8,
    });
  });

  it("normalises a broken band and enforces its minimum width", () => {
    expect(clampBrokenBand(100, 70, 71)).toEqual({ start: 70, end: 74 });
    expect(clampBrokenBand(100, -20, 140)).toEqual({ start: 0, end: 100 });
  });
});

function makeView(overrides: Partial<DrawingViewData>): DrawingViewData {
  return {
    id: "view",
    label: "FRONT",
    projection: "front",
    kind: "standard",
    x: 100,
    y: 60,
    scale: 1,
    visiblePaths: [],
    hiddenPaths: [],
    width: 40,
    height: 30,
    ...overrides,
  };
}

describe("alignmentLinkFor", () => {
  const front = makeView({ id: "front", projection: "front", x: 100, y: 60 });

  it("locks a right/left/back view to Front's row and a top/bottom view to its column", () => {
    const right = makeView({ id: "right", projection: "right", x: 220, y: 60 });
    expect(alignmentLinkFor(right, [front, right])).toEqual({ axis: "y", coordinate: 60, sourceId: "front" });
    const top = makeView({ id: "top", projection: "top", x: 100, y: 10 });
    expect(alignmentLinkFor(top, [front, top])).toEqual({ axis: "x", coordinate: 100, sourceId: "front" });
  });

  it("leaves Front and Iso free, and any standard view free when no Front exists", () => {
    expect(alignmentLinkFor(front, [front])).toBeNull();
    const iso = makeView({ id: "iso", projection: "iso" });
    expect(alignmentLinkFor(iso, [front, iso])).toBeNull();
    const right = makeView({ id: "right", projection: "right" });
    expect(alignmentLinkFor(right, [right])).toBeNull();
  });

  it("locks a section perpendicular to its cut line's orientation", () => {
    const section = makeView({
      id: "section",
      kind: "section",
      section: {
        axis: "y",
        offset: 0,
        keepPositiveSide: true,
        sourceViewId: "front",
        orientation: "vertical",
        localScreenPosition: 10,
        letter: "A",
      },
    });
    expect(alignmentLinkFor(section, [front, section])).toEqual({ axis: "y", coordinate: 60, sourceId: "front" });
  });

  it("locks an auxiliary view perpendicular to its tilt axis", () => {
    const auxiliary = makeView({
      id: "aux",
      kind: "auxiliary",
      auxiliaryOf: { sourceViewId: "front", baseProjection: "front", tiltAxis: "horizontal", angle: 30, letter: "A" },
    });
    expect(alignmentLinkFor(auxiliary, [front, auxiliary])).toEqual({ axis: "x", coordinate: 100, sourceId: "front" });
  });

  it("leaves detail, crop, and broken views free — drafting places those arbitrarily", () => {
    const detail = makeView({
      id: "detail",
      kind: "detail",
      detailOf: { sourceViewId: "front", cx: 5, cy: 5, radius: 10, sourceHeight: 30 },
    });
    expect(alignmentLinkFor(detail, [front, detail])).toBeNull();
    const broken = makeView({
      id: "broken",
      kind: "broken",
      brokenOf: { sourceViewId: "front", orientation: "vertical", start: 10, end: 20, letter: "A" },
    });
    expect(alignmentLinkFor(broken, [front, broken])).toBeNull();
  });

  it("alignmentTargetFor withholds the link exactly when the user unlinked the view", () => {
    const right = makeView({ id: "right", projection: "right", x: 220, y: 75 });
    expect(alignmentTargetFor(right, [front, right])).not.toBeNull();
    const unlinked = makeView({ id: "right", projection: "right", x: 220, y: 75, alignmentUnlocked: true });
    expect(alignmentTargetFor(unlinked, [front, unlinked])).toBeNull();
    // ...while the link itself still exists for a later re-link to snap back to.
    expect(alignmentLinkFor(unlinked, [front, unlinked])).toEqual({ axis: "y", coordinate: 60, sourceId: "front" });
  });
});
