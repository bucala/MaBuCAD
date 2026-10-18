import { beforeEach, describe, expect, it } from "vitest";

import type { DrawingViewData } from "@/types/document";

import { createDocument, useDocumentStore } from "./documentStore";

const FRONT: DrawingViewData = {
  id: "front",
  label: "FRONT",
  projection: "front",
  x: 100,
  y: 60,
  scale: 1,
  width: 40,
  height: 30,
  visiblePaths: [],
  hiddenPaths: [],
};
const RIGHT: DrawingViewData = { ...FRONT, id: "right", label: "RIGHT", projection: "right", x: 220 };
const TOP: DrawingViewData = { ...FRONT, id: "top", label: "TOP", projection: "top", y: 10 };
const SECTION: DrawingViewData = {
  ...FRONT,
  id: "section",
  label: "SECTION A-A",
  kind: "section",
  x: 300,
  section: {
    sourceViewId: "right",
    axis: "y",
    offset: 0,
    keepPositiveSide: true,
    orientation: "vertical",
    localScreenPosition: 10,
    letter: "A",
  },
};

function drawing() {
  return useDocumentStore.getState().document.drawing!;
}

function view(id: string) {
  return drawing().views.find((candidate) => candidate.id === id)!;
}

beforeEach(() => {
  const store = useDocumentStore.getState();
  store.loadDocument(createDocument("drawing", "Sheet1"));
  // Reverse dependency order proves propagation does not depend on insertion order.
  store.setDrawingSheet({ ...drawing(), views: [SECTION, TOP, RIGHT, FRONT] });
});

describe("drawing view alignment", () => {
  it("constrains linked view dragging in the store, including legacy standard views", () => {
    const store = useDocumentStore.getState();
    store.moveDrawingView("right", 240, 90);
    expect(view("right")).toMatchObject({ x: 240, y: 60 });
    store.moveDrawingView("top", 150, 20);
    expect(view("top")).toMatchObject({ x: 100, y: 20 });
  });

  it("moves descendants along the shared axis and leaves their free coordinates alone", () => {
    useDocumentStore.getState().moveDrawingView("front", 110, 80);
    expect(view("front")).toMatchObject({ x: 110, y: 80 });
    expect(view("right")).toMatchObject({ x: 220, y: 80 });
    expect(view("top")).toMatchObject({ x: 110, y: 10 });
    expect(view("section")).toMatchObject({ x: 300, y: 80 });
  });

  it("shifts every bound annotation by its own view's delta and restores one whole drag", () => {
    const store = useDocumentStore.getState();
    store.addDrawingDimension({
      parentViewId: "right", kind: "horizontal", x1: 200, y1: 60, x2: 240, y2: 60,
      value: 40, offsetX: 0, offsetY: -8,
    });
    store.addDrawingOrdinateChain({
      parentViewId: "section", axis: "x", datumX: 280, datumY: 60,
      points: [{ x: 320, y: 60, value: 40 }],
    });
    const leader = { parentViewId: "right", anchorX: 220, anchorY: 60, labelX: 230, labelY: 50 };
    store.addDrawingDatum({ ...leader, letter: "A" });
    store.addDrawingGdt({ ...leader, symbol: "position", tolerance: "0.1", datums: [] });
    store.addDrawingSurfaceFinish({ ...leader, roughness: "Ra 1.6" });
    store.addDrawingWeld({
      ...leader, arrowSide: { symbol: "fillet", size: "6" }, otherSide: null,
      allAround: false, fieldWeld: false,
    });
    store.addDrawingHoleCallout({
      ...leader, sourceTargetId: "hole",
      metadata: { sourceFeatureId: "hole", holeType: "simple", diameter: 6, holeDepth: 12, endCondition: "through-all" },
    });
    const unbound = store.addDrawingDatum({ letter: "B", anchorX: 10, anchorY: 10, labelX: 20, labelY: 0 });
    const before = drawing();
    const history = useDocumentStore.getState().past.length;

    store.beginDragEdit();
    store.moveDrawingView("front", 105, 70);
    store.moveDrawingView("front", 110, 80);
    store.endDragEdit();

    expect(useDocumentStore.getState().past).toHaveLength(history + 1);
    expect(drawing().dimensions![0]).toMatchObject({ x1: 200, y1: 80, x2: 240, y2: 80, value: 40 });
    expect(drawing().ordinateChains![0]).toMatchObject({
      datumX: 280, datumY: 80, points: [expect.objectContaining({ x: 320, y: 80, value: 40 })],
    });
    for (const annotation of [
      drawing().datums![0], drawing().gdtFrames![0], drawing().surfaceFinishes![0],
      drawing().welds![0], drawing().holeCallouts![0],
    ]) {
      expect(annotation).toMatchObject({ anchorX: 220, anchorY: 80, labelX: 230, labelY: 70 });
    }
    expect(drawing().datums!.find((datum) => datum.id === unbound)).toMatchObject({
      anchorX: 10, anchorY: 10, labelX: 20, labelY: 0,
    });
    store.undo();
    expect(drawing()).toEqual(before);
    store.redo();
    expect(view("section").y).toBe(80);
  });

  it("leaves unlinked views independent while their own linked descendants still follow", () => {
    const store = useDocumentStore.getState();
    store.updateDrawingView("right", { alignmentUnlocked: true });
    store.moveDrawingView("front", 110, 80);
    expect(view("right")).toMatchObject({ x: 220, y: 60, alignmentUnlocked: true });
    expect(view("section").y).toBe(60);
    store.moveDrawingView("right", 230, 90);
    expect(view("right")).toMatchObject({ x: 230, y: 90 });
    expect(view("section")).toMatchObject({ x: 300, y: 90 });
  });

  it("re-links, snaps and moves descendants in one undo step", () => {
    const store = useDocumentStore.getState();
    store.updateDrawingView("right", { alignmentUnlocked: true });
    store.moveDrawingView("right", 230, 90);
    const before = drawing();
    const history = useDocumentStore.getState().past.length;
    store.moveDrawingView("right", 230, 90, { alignmentUnlocked: false });
    expect(view("right")).toMatchObject({ x: 230, y: 60, alignmentUnlocked: false });
    expect(view("section").y).toBe(60);
    expect(useDocumentStore.getState().past).toHaveLength(history + 1);
    store.undo();
    expect(drawing()).toEqual(before);
    store.redo();
    expect(view("right").alignmentUnlocked).toBe(false);
  });

  it("does not add undo entries when a drag only requests movement on the locked axis", () => {
    const before = useDocumentStore.getState();
    before.moveDrawingView("right", 220, 90);
    const after = useDocumentStore.getState();
    expect(after.document).toBe(before.document);
    expect(after.past).toHaveLength(before.past.length);
  });

  it("relayouts linked descendants and annotations with the projection method in one undo step", () => {
    const store = useDocumentStore.getState();
    const horizontal = {
      ...SECTION, id: "horizontal", x: RIGHT.x, y: 140,
      section: { ...SECTION.section!, orientation: "horizontal" as const },
    };
    const auxiliary: DrawingViewData = {
      ...FRONT, id: "auxiliary", kind: "auxiliary", x: RIGHT.x, y: 180,
      auxiliaryOf: { sourceViewId: "horizontal", baseProjection: "right", tiltAxis: "horizontal", angle: 30, letter: "B" },
    };
    store.setDrawingSheet({ ...drawing(), views: [auxiliary, horizontal, TOP, RIGHT, FRONT] });
    store.layoutDrawingViews("ISO-E");
    const right = view("right");
    store.addDrawingDimension({
      parentViewId: "right", kind: "horizontal", x1: right.x - 20, y1: right.y,
      x2: right.x + 20, y2: right.y, value: 40, offsetX: 0, offsetY: -8,
    });
    store.addDrawingDatum({
      parentViewId: "auxiliary", letter: "A",
      anchorX: right.x, anchorY: 180, labelX: right.x + 10, labelY: 170,
    });
    const before = drawing();
    const history = useDocumentStore.getState().past.length;

    store.layoutDrawingViews("ISO-A");
    const dx = view("right").x - right.x;
    expect(dx).not.toBe(0);
    expect(view("horizontal")).toMatchObject({ x: view("right").x, y: 140 });
    expect(view("auxiliary")).toMatchObject({ x: view("right").x, y: 180 });
    expect(drawing().dimensions![0].x1).toBeCloseTo(before.dimensions![0].x1 + dx);
    expect(drawing().datums![0].labelX).toBeCloseTo(before.datums![0].labelX + dx);
    expect(drawing().projectionMethod).toBe("ISO-A");
    expect(useDocumentStore.getState().past).toHaveLength(history + 1);
    const after = drawing();
    store.layoutDrawingViews("ISO-A");
    expect(drawing()).toBe(after);
    expect(useDocumentStore.getState().past).toHaveLength(history + 1);
    store.undo();
    expect(drawing()).toEqual(before);
    store.redo();
    expect(drawing()).toEqual(after);
  });

  it("adds a projected standard view and relayouts the existing sheet as one undo step", () => {
    const store = useDocumentStore.getState();
    store.layoutDrawingViews("ISO-E");
    store.moveDrawingView("top", view("top").x, view("top").y + 12);
    const top = view("top");
    store.addDrawingView({
      ...SECTION, id: "top-section", y: top.y,
      section: { ...SECTION.section!, sourceViewId: "top" },
    });
    store.addDrawingDimension({
      parentViewId: "top", kind: "horizontal",
      x1: 80, y1: top.y, x2: 120, y2: top.y, value: 40, offsetX: 0, offsetY: -8,
    });
    const before = drawing();
    const history = useDocumentStore.getState().past.length;

    store.addDrawingView({ ...FRONT, id: "left", kind: "standard", projection: "left", width: 120, height: 160 });
    const dy = view("top").y - top.y;
    expect(dy).not.toBe(0);
    expect(view("top-section").y).toBe(view("top").y);
    expect(drawing().dimensions![0].y1).toBeCloseTo(before.dimensions![0].y1 + dy);
    expect(useDocumentStore.getState().past).toHaveLength(history + 1);
    store.undo();
    expect(drawing()).toEqual(before);
    store.redo();
    expect(view("left").kind).toBe("standard");
    expect(view("top-section").y).toBe(view("top").y);
  });
});
