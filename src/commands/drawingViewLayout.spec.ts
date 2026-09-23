import { describe, expect, it } from "vitest";

import { clampBrokenBand, clampCropRegion } from "./drawingViewLayout";

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
