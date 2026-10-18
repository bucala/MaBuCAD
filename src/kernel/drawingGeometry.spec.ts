import { describe, expect, it } from "vitest";

import type { DrawingViewData } from "@/types/document";

import { nearestVertex, sheetPointFromClientRect, viewPointToSheet, viewVertices } from "./drawingGeometry";

function makeView(overrides: Partial<DrawingViewData>): DrawingViewData {
  return {
    id: "view-1",
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

describe("sheetPointFromClientRect", () => {
  const sheet = { width: 420, height: 297 };

  it("maps an unzoomed, unpanned rect linearly", () => {
    // The sheet <svg> is rendered at SHEET_SCALE px per mm: 420 mm → 1050 px wide.
    const rect = { left: 50, top: 20, width: 1050, height: 742.5 };
    const point = sheetPointFromClientRect(50 + 1050 / 2, 20 + 742.5 / 2, rect, sheet.width, sheet.height);
    expect(point.x).toBeCloseTo(210);
    expect(point.y).toBeCloseTo(148.5);
  });

  it("stays correct when CSS zoom/pan has shrunk and shifted the rendered rect", () => {
    // 83% zoom: rect.width shrinks proportionally and pan moves the origin — the very
    // combination that must remain independent of the sheet's CSS transform.
    const rect = { left: 120, top: 40, width: 1050 * 0.83, height: 742.5 * 0.83 };
    const point = sheetPointFromClientRect(120, 40, rect, sheet.width, sheet.height);
    expect(point.x).toBeCloseTo(0);
    expect(point.y).toBeCloseTo(0);
    const centre = sheetPointFromClientRect(120 + rect.width / 2, 40 + rect.height / 2, rect, sheet.width, sheet.height);
    expect(centre.x).toBeCloseTo(210);
    expect(centre.y).toBeCloseTo(148.5);
  });
});

describe("viewPointToSheet", () => {
  it("flips a standard view's raw Y-negative paths into its own frame", () => {
    const view = makeView({});
    // Raw paths live in [-height, 0]; raw y = 0 lands at the frame's bottom edge after the
    // +height shift (the frame's own top is view.y - height/2 = 45).
    expect(viewPointToSheet(view, { x: 0, y: 0 })).toEqual({ x: 80, y: 75 });
    expect(viewPointToSheet(view, { x: 40, y: -30 })).toEqual({ x: 120, y: 45 });
  });

  it("maps a detail view's source-space paths around the detail centre", () => {
    const view = makeView({
      id: "detail-1",
      kind: "detail",
      scale: 2,
      width: 10,
      height: 10,
      detailOf: { sourceViewId: "view-1", cx: 10, cy: 20, radius: 5, sourceHeight: 40 },
    });
    // The source-local point at the detail centre (raw y = cy - sourceHeight) must land
    // exactly on the detail view's own centre.
    expect(viewPointToSheet(view, { x: 10, y: -20 })).toEqual({ x: 100, y: 60 });
  });

  it("maps a crop view's source-space paths around the crop window centre", () => {
    const view = makeView({
      id: "crop-1",
      kind: "crop",
      width: 20,
      height: 10,
      cropOf: { sourceViewId: "view-1", x: 5, y: 10, width: 20, height: 10, sourceHeight: 40, letter: "A" },
    });
    // Window centre in flipped space is (15, 15) → raw (15, 15 - 40) = (15, -25).
    expect(viewPointToSheet(view, { x: 15, y: -25 })).toEqual({ x: 100, y: 60 });
  });
});

describe("nearestVertex", () => {
  const views = [
    makeView({ id: "near", x: 0, y: 0, visiblePaths: ["M 0 0 L 1 0"] }),
    makeView({ id: "far", x: 500, y: 500, visiblePaths: ["M 0 0 L 1 0"] }),
  ];

  // The "far" view's raw endpoint (1, 0) renders at (500 - 20 + 1, 500 - 15 + 30) =
  // (481, 515), so a click at (482, 513) is ~2.2 mm away from it.
  it("picks across every view by default", () => {
    const hit = nearestVertex(views, { x: 482, y: 513 }, 5);
    expect(hit?.viewId).toBe("far");
  });

  it("honours the same-view restriction used by the second dimension pick", () => {
    const hit = nearestVertex(views, { x: 482, y: 513 }, 5, "near");
    expect(hit).toBeNull();
    const ownView = nearestVertex(views, { x: 482, y: 513 }, 5, "far");
    expect(ownView?.viewId).toBe("far");
  });

  it("reads vertices from a detail view at its rendered position, not its raw cache", () => {
    const detail = makeView({
      id: "detail-1",
      kind: "detail",
      x: 300,
      y: 200,
      scale: 2,
      width: 10,
      height: 10,
      visiblePaths: ["M 10 -20 L 12 -20"],
      detailOf: { sourceViewId: "view-1", cx: 10, cy: 20, radius: 5, sourceHeight: 40 },
    });
    const vertices = viewVertices(detail);
    // The path's own centre point (10, -20) renders at the view centre.
    expect(vertices).toContainEqual({ x: 300, y: 200, viewId: "detail-1" });
  });
});

describe("clipped view vertices", () => {
  it("excludes source endpoints outside a detail circle", () => {
    const detail = makeView({
      kind: "detail", width: 10, height: 10,
      visiblePaths: ["M 10 -20 L 14 -20 L 18 -20"],
      detailOf: { sourceViewId: "source", cx: 10, cy: 20, radius: 5, sourceHeight: 40 },
    });
    expect(viewVertices(detail)).toEqual([
      { x: 100, y: 60, viewId: detail.id },
      { x: 104, y: 60, viewId: detail.id },
    ]);
    expect(nearestVertex([detail], { x: 108, y: 60 }, 1)).toBeNull();
  });

  it("excludes source endpoints outside a crop window, retaining boundary endpoints", () => {
    const crop = makeView({
      kind: "crop", width: 20, height: 10,
      visiblePaths: ["M 5 -30 L 15 -25 L 25 -20 L 30 -20 L 15 -15"],
      cropOf: { sourceViewId: "source", x: 5, y: 10, width: 20, height: 10, sourceHeight: 40, letter: "A" },
    });
    expect(viewVertices(crop)).toEqual([
      { x: 90, y: 55, viewId: crop.id },
      { x: 100, y: 60, viewId: crop.id },
      { x: 110, y: 65, viewId: crop.id },
    ]);
  });

  it.each(["vertical", "horizontal"] as const)("excludes endpoints masked by a %s broken band", (orientation) => {
    const broken = makeView({
      kind: "broken",
      visiblePaths: orientation === "vertical" ? ["M 0 -15 L 15 -15 L 40 -15"] : ["M 20 -30 L 20 -15 L 20 0"],
      brokenOf: { sourceViewId: "source", orientation, start: 10, end: 20, letter: "A" },
    });
    expect(viewVertices(broken)).toHaveLength(2);
    expect(nearestVertex([broken], viewPointToSheet(broken, { x: orientation === "vertical" ? 15 : 20, y: -15 }), 1)).toBeNull();
  });
});
