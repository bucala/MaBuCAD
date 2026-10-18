import { describe, expect, it } from "vitest";

import type { DrawingHoleCalloutMetadata, DrawingViewData } from "@/types/document";

import { formatHoleCallout, holeTargetSheetPoint, nearestHoleTarget } from "./holeCallout";

const TAPPED: DrawingHoleCalloutMetadata = {
  sourceFeatureId: "hole-1",
  holeType: "tapped",
  diameter: 5,
  holeDepth: 12,
  endCondition: "blind",
  designation: "M6x1",
  threadClass: "6H",
  threadDirection: "right",
  fullDepthThread: true,
};

const VIEW: DrawingViewData = {
  id: "view-front",
  label: "FRONT",
  projection: "front",
  x: 200,
  y: 100,
  scale: 2,
  visiblePaths: [],
  hiddenPaths: [],
  width: 100,
  height: 50,
  holeTargets: [
    {
      id: "front-hole-1",
      cx: 25,
      cy: -25,
      radius: 5,
      metadata: TAPPED,
    },
  ],
};

describe("formatHoleCallout", () => {
  it("formats a full-depth left-hand thread with its class", () => {
    expect(
      formatHoleCallout(
        { ...TAPPED, endCondition: "through-all", threadDirection: "left" },
        "en",
      ),
    ).toEqual(["M6×1 - 6H - LH", "THRU"]);
  });

  it("never annotates the default right-hand direction", () => {
    expect(formatHoleCallout({ ...TAPPED }, "en")).toEqual(["M6×1 - 6H", "FULL THREAD ↧ 12 mm"]);
  });

  it("formats a full-depth blind thread in Slovak through the dictionary", () => {
    expect(formatHoleCallout({ ...TAPPED }, "sk")).toEqual(["M6×1 - 6H", "PLNÝ ZÁVIT ↧ 12 mm"]);
  });

  it("formats a shortened thread in Slovak", () => {
    expect(
      formatHoleCallout(
        { ...TAPPED, fullDepthThread: false, threadDepth: 8 },
        "sk",
      ),
    ).toEqual(["M6×1 - 6H", "HĽBKA ZÁVITU ↧ 8 mm"]);
  });

  it("reports the drilled depth instead of inventing a missing shortened-thread depth", () => {
    const lines = formatHoleCallout({ ...TAPPED, fullDepthThread: false }, "en");
    expect(lines).toEqual(["M6×1 - 6H", "↧ 12 mm"]);
    // The old fallback fabricated holeDepth * 0.55 — it must never reappear.
    expect(lines.join(" ")).not.toContain("6.6");
  });

  it("spells a counterbore seat out above the thread line", () => {
    expect(
      formatHoleCallout(
        {
          ...TAPPED,
          endCondition: "through-all",
          seatType: "counterbore",
          seatDiameter: 11,
          seatDepthOrAngle: 6.8,
        },
        "en",
      ),
    ).toEqual(["⌴⌀11 ↧ 6.8 mm", "M6×1 - 6H", "THRU"]);
  });

  it("spells a countersink seat out with its included angle", () => {
    expect(
      formatHoleCallout(
        {
          sourceFeatureId: "hole-3",
          holeType: "clearance",
          diameter: 6.6,
          holeDepth: 10,
          endCondition: "through-all",
          designation: "M6",
          holeFit: "normal",
          seatType: "countersink",
          seatDiameter: 12.6,
          seatDepthOrAngle: 90,
        },
        "sk",
      ),
    ).toEqual(["⌵⌀12.6 90°", "⌀6.6 M6 NORMAL", "CEZ"]);
  });

  it("drops a seat token whose number was never snapshotted rather than inventing one", () => {
    expect(
      formatHoleCallout(
        {
          sourceFeatureId: "hole-4",
          holeType: "clearance",
          diameter: 6.6,
          holeDepth: 10,
          endCondition: "through-all",
          designation: "M6",
          holeFit: "normal",
          seatType: "spotface",
          seatDiameter: 18,
        },
        "en",
      ),
    ).toEqual(["⌴⌀18", "⌀6.6 M6 NORMAL", "THRU"]);
  });

  it("formats a clearance hole with its nominal size and fit", () => {
    expect(
      formatHoleCallout(
        {
          sourceFeatureId: "hole-2",
          holeType: "clearance",
          diameter: 6.6,
          holeDepth: 10,
          endCondition: "through-all",
          designation: "M6",
          holeFit: "normal",
        },
        "sk",
      ),
    ).toEqual(["⌀6.6 M6 NORMAL", "CEZ"]);
  });
});

describe("nearestHoleTarget", () => {
  it("maps a raw projected target through the view's scale and Y shift", () => {
    expect(holeTargetSheetPoint(VIEW, VIEW.holeTargets![0]!)).toEqual({ x: 150, y: 100, radius: 10 });
  });

  it("picks by distance to the circumference, not distance to the centre", () => {
    const nearCentreWrongEdge: DrawingViewData = {
      ...VIEW,
      id: "view-decoy",
      holeTargets: [
        {
          id: "decoy",
          cx: 25.4,
          cy: -25,
          radius: 0.5,
          metadata: TAPPED,
        },
      ],
    };

    const match = nearestHoleTarget([nearCentreWrongEdge, VIEW], { x: 160, y: 100 }, 2);
    expect(match?.viewId).toBe("view-front");
    expect(match?.target.id).toBe("front-hole-1");
  });

  it("rejects a click farther than the picker tolerance from every circle edge", () => {
    expect(nearestHoleTarget([VIEW], { x: 163.1, y: 100 }, 3)).toBeNull();
  });

  it("rejects a masked hole rim in a broken view", () => {
    const broken: DrawingViewData = {
      ...VIEW, kind: "broken",
      brokenOf: { sourceViewId: "source", orientation: "vertical", start: 20, end: 35, letter: "A" },
    };
    expect(nearestHoleTarget([broken], { x: 160, y: 100 }, 2)).toBeNull();
  });

  it("allows only the visible part of a hole rim in a crop view", () => {
    const crop: DrawingViewData = {
      ...VIEW, kind: "crop", width: 5, height: 10,
      cropOf: { sourceViewId: "source", x: 25, y: 20, width: 5, height: 10, sourceHeight: 50, letter: "A" },
    };
    const sheet = holeTargetSheetPoint(crop, crop.holeTargets![0]);
    expect(nearestHoleTarget([crop], { x: sheet.x + sheet.radius, y: sheet.y }, 2)?.viewId).toBe(crop.id);
    expect(nearestHoleTarget([crop], { x: sheet.x - sheet.radius, y: sheet.y }, 2)).toBeNull();
  });
});
