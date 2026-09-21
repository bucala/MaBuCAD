import { describe, expect, it } from "vitest";

import type { DrawingHoleCalloutMetadata, DrawingViewData } from "@/types/document";

import { createDocument, useDocumentStore } from "./documentStore";

const METADATA: DrawingHoleCalloutMetadata = {
  sourceFeatureId: "hole-1",
  holeType: "tapped",
  diameter: 5,
  holeDepth: 12,
  endCondition: "through-all",
  designation: "M6x1",
  threadClass: "6H",
  threadDirection: "right",
  fullDepthThread: true,
};

const VIEW: DrawingViewData = {
  id: "view-1",
  label: "FRONT",
  projection: "front",
  x: 100,
  y: 100,
  scale: 1,
  visiblePaths: [],
  hiddenPaths: [],
  width: 50,
  height: 50,
};

function freshDrawing() {
  useDocumentStore.getState().loadDocument(createDocument("drawing", "Sheet1"));
}

describe("drawing hole callouts", () => {
  it("adds, edits, deletes and restores a callout through undo", () => {
    freshDrawing();
    const store = useDocumentStore.getState();

    const id = store.addDrawingHoleCallout({
      parentViewId: "view-1",
      sourceTargetId: "front-hole-1",
      anchorX: 10,
      anchorY: 20,
      labelX: 25,
      labelY: 10,
      metadata: METADATA,
    });
    expect(useDocumentStore.getState().document.drawing?.holeCallouts).toHaveLength(1);

    store.updateDrawingHoleCallout(id, { labelX: 30, labelY: 12 });
    expect(useDocumentStore.getState().document.drawing?.holeCallouts?.[0]).toMatchObject({
      id,
      labelX: 30,
      labelY: 12,
      metadata: METADATA,
    });

    store.deleteDrawingHoleCallout(id);
    expect(useDocumentStore.getState().document.drawing?.holeCallouts).toEqual([]);

    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.drawing?.holeCallouts?.[0]?.id).toBe(id);
  });

  it("moves a bound callout with its view by the same delta", () => {
    freshDrawing();
    const store = useDocumentStore.getState();
    store.addDrawingView(VIEW);
    const boundId = store.addDrawingHoleCallout({
      parentViewId: "view-1",
      sourceTargetId: "front-hole-1",
      anchorX: 10,
      anchorY: 20,
      labelX: 25,
      labelY: 10,
      metadata: METADATA,
    });
    const unboundId = store.addDrawingHoleCallout({
      sourceTargetId: "elsewhere",
      anchorX: 200,
      anchorY: 200,
      labelX: 220,
      labelY: 190,
      metadata: METADATA,
    });

    store.moveDrawingView("view-1", 115, 90);

    const callouts = useDocumentStore.getState().document.drawing?.holeCallouts ?? [];
    expect(callouts.find((callout) => callout.id === boundId)).toMatchObject({
      anchorX: 25,
      anchorY: 10,
      labelX: 40,
      labelY: 0,
    });
    expect(callouts.find((callout) => callout.id === unboundId)).toMatchObject({
      anchorX: 200,
      anchorY: 200,
      labelX: 220,
      labelY: 190,
    });
  });
});
