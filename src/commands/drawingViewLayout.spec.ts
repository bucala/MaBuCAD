import { describe, expect, it } from "vitest";

import type { DrawingViewData } from "@/types/document";

import {
  alignmentLinkFor,
  alignmentTargetFor,
  clampBrokenBand,
  clampCropRegion,
  layoutInitialViews,
  moveAlignedViews,
  positionDerivedView,
  projectableDirections,
  repositionStandardViews,
  SHEET_MARGIN,
  VIEW_GAP,
} from "./drawingViewLayout";

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
    const horizontal = { ...section, section: { ...section.section!, orientation: "horizontal" as const } };
    expect(alignmentLinkFor(horizontal, [front, horizontal])).toEqual({ axis: "x", coordinate: 100, sourceId: "front" });
  });

  it("locks an auxiliary view perpendicular to its tilt axis", () => {
    const auxiliary = makeView({
      id: "aux",
      kind: "auxiliary",
      auxiliaryOf: { sourceViewId: "front", baseProjection: "front", tiltAxis: "horizontal", angle: 30, letter: "A" },
    });
    expect(alignmentLinkFor(auxiliary, [front, auxiliary])).toEqual({ axis: "x", coordinate: 100, sourceId: "front" });
    const vertical = { ...auxiliary, auxiliaryOf: { ...auxiliary.auxiliaryOf!, tiltAxis: "vertical" as const } };
    expect(alignmentLinkFor(vertical, [front, vertical])).toEqual({ axis: "y", coordinate: 60, sourceId: "front" });
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
    expect(alignmentLinkFor(makeView({ kind: "crop" }), [front])).toBeNull();
  });

  it("alignmentTargetFor withholds the link exactly when the user unlinked the view", () => {
    const right = makeView({ id: "right", projection: "right", x: 220, y: 75 });
    expect(alignmentTargetFor(right, [front, right])).not.toBeNull();
    const unlinked = makeView({ id: "right", projection: "right", x: 220, y: 75, alignmentUnlocked: true });
    expect(alignmentTargetFor(unlinked, [front, unlinked])).toBeNull();
    // ...while the link itself still exists for a later re-link to snap back to.
    expect(alignmentLinkFor(unlinked, [front, unlinked])).toEqual({ axis: "y", coordinate: 60, sourceId: "front" });
  });

  it("does not link missing or self-referencing sources", () => {
    const auxiliary = makeView({
      id: "aux",
      kind: "auxiliary",
      auxiliaryOf: { sourceViewId: "missing", baseProjection: "front", tiltAxis: "vertical", angle: 30, letter: "A" },
    });
    expect(alignmentLinkFor(auxiliary, [front, auxiliary])).toBeNull();
    auxiliary.auxiliaryOf!.sourceViewId = auxiliary.id;
    expect(alignmentLinkFor(auxiliary, [front, auxiliary])).toBeNull();
  });

  it("keeps an unlinked standard view's position during a layout change", () => {
    const right = makeView({ id: "right", projection: "right", x: 240, y: 90, alignmentUnlocked: true });
    expect(repositionStandardViews([front, right], "ISO-A")[1]).toBe(right);
  });
});

describe("derived view placement", () => {
  const source = makeView({ x: 100, y: 60, scale: 2 });
  const size = { width: 60, height: 24, scale: 2 };

  it("starts horizontal projections in the source row with a clear gap", () => {
    expect(positionDerivedView(source, size, "horizontal")).toEqual({
      x: 100 + 40 + 60 + VIEW_GAP,
      y: 60,
    });
  });

  it("starts vertical projections in the source column with a clear gap", () => {
    expect(positionDerivedView(source, size, "vertical")).toEqual({
      x: 100,
      y: 60 + 30 + 24 + VIEW_GAP,
    });
  });
});

describe("layoutInitialViews room reservation", () => {
  const front = { width: 40, height: 30, scale: 1, visiblePaths: [], hiddenPaths: [], originX: 0, originY: 0 };

  it("reserves no above/left room when roomSizes is omitted and only Front is placed", () => {
    // The orientation picker's single-view placement, with no foreknowledge of other
    // directions' sizes passed in — the pre-existing (pre-`roomSizes`) default behaviour.
    const [placed] = layoutInitialViews({ front }, "ISO-E");
    expect(placed.x).toBe(SHEET_MARGIN + front.width / 2);
    expect(placed.y).toBe(SHEET_MARGIN + front.height / 2);
  });

  it("reserves above/left room from roomSizes even though only Front is being placed", () => {
    // Under ISO-E, Right sits left of Front and Bottom sits above it — exactly the
    // directions `runPlaceModelView` passes every other projected size in as, so a
    // Projected View added later along either axis lands with room already waiting,
    // instead of pushing the group (and Front itself) off the sheet's own margin.
    const roomSizes = {
      right: { width: 20, height: 10, scale: 1 },
      bottom: { width: 16, height: 8, scale: 1 },
    };
    const [placed] = layoutInitialViews({ front }, "ISO-E", roomSizes);
    expect(placed.x).toBe(SHEET_MARGIN + (20 + VIEW_GAP) + front.width / 2);
    expect(placed.y).toBe(SHEET_MARGIN + (8 + VIEW_GAP) + front.height / 2);
  });
});

describe("projectableDirections", () => {
  it("offers Front's four cardinal neighbours, one per arrow, under ISO-E", () => {
    const candidates = projectableDirections("front", new Set(), "ISO-E");
    expect(new Set(candidates)).toEqual(
      new Set([
        { direction: "top", arrow: "down" },
        { direction: "bottom", arrow: "up" },
        { direction: "right", arrow: "left" },
        { direction: "left", arrow: "right" },
      ]),
    );
  });

  it("prefers the nearer direction when two candidates would share an arrow", () => {
    // Under ISO-E, Left (step 1) and Back (step 2) both sit to Front's own "right" arrow —
    // Left is the single-step neighbour, so Back must not win that slot.
    const candidates = projectableDirections("front", new Set(), "ISO-E");
    expect(candidates.filter((candidate) => candidate.arrow === "right")).toEqual([
      { direction: "left", arrow: "right" },
    ]);
  });

  it("excludes whatever is already placed, letting a farther view take a freed arrow", () => {
    // With Left excluded, Back (two steps out, same side as Left) takes over its "right"
    // arrow slot instead of that arrow disappearing.
    const candidates = projectableDirections("front", new Set(["top", "left"]), "ISO-E");
    expect(candidates).toEqual([
      { direction: "bottom", arrow: "up" },
      { direction: "right", arrow: "left" },
      { direction: "back", arrow: "right" },
    ]);
  });

  it("only offers a direction truly one axial step away — not every remaining standard view", () => {
    // From Top, Right/Left/Back are each a diagonal step away (differ from Top on both
    // axes), so only Front (straight back down) qualifies.
    expect(projectableDirections("top", new Set(), "ISO-E")).toEqual([{ direction: "front", arrow: "up" }]);
  });
});

describe("moveAlignedViews", () => {
  it("stops propagation through malformed source cycles", () => {
    const first = makeView({
      id: "a",
      kind: "auxiliary",
      auxiliaryOf: { sourceViewId: "b", baseProjection: "front", tiltAxis: "vertical", angle: 30, letter: "A" },
    });
    const second = makeView({
      id: "b",
      kind: "auxiliary",
      auxiliaryOf: { sourceViewId: "a", baseProjection: "front", tiltAxis: "vertical", angle: 30, letter: "B" },
    });
    const moved = moveAlignedViews([first, second], "a", 150, 90);
    expect(moved[0]).toMatchObject({ x: 150, y: 60 });
    expect(moved[1]).toBe(second);
  });

  it("leaves inputs unchanged and ignores unknown ids or invalid coordinates", () => {
    const view = makeView({});
    const views = [view];
    expect(moveAlignedViews(views, "missing", 150, 90)).toBe(views);
    expect(moveAlignedViews(views, view.id, Number.NaN, 90)).toBe(views);
    const moved = moveAlignedViews(views, view.id, 150, 90);
    expect(moved[0]).toMatchObject({ x: 150, y: 90 });
    expect(view).toMatchObject({ x: 100, y: 60 });
  });
});
