import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for "Mass Properties activates and the app gets stuck": these four
 * compute functions (here, plus `computeGeometryCheck` in `checkGeometry.spec.ts`) are
 * each called from an unguarded `useMemo` in `InspectPanel.tsx`, with no React error
 * boundary above them before this round. An OCCT measurement call throwing (a picked
 * sub-shape momentarily backed by a disposed/degenerate kernel handle) used to propagate
 * straight out of the `useMemo` and unmount the whole panel — including its own Close
 * button and Escape handler — mid-render. These pins force that throw and assert it
 * degrades to the section's existing "nothing to show" `null` instead.
 */
vi.mock("replicad", () => ({
  measureArea: vi.fn(() => {
    throw new Error("kernel measurement failed");
  }),
  measureDistanceBetween: vi.fn(() => {
    throw new Error("kernel measurement failed");
  }),
  measureLength: vi.fn(() => {
    throw new Error("kernel measurement failed");
  }),
  measureShapeSurfaceProperties: vi.fn(() => {
    throw new Error("kernel measurement failed");
  }),
  measureShapeVolumeProperties: vi.fn(() => {
    throw new Error("kernel measurement failed");
  }),
}));

vi.mock("./rebuild", () => ({
  getCurrentShape: vi.fn(),
}));

import { getCurrentShape } from "./rebuild";
import { computeMassProperties, computeMeasureSummary, computeSectionProperties } from "./measure";

// A minimal truthy "shape" — the mocked measurement functions throw regardless of what's
// actually passed to them, so this only needs to look non-empty to resolveSubShape/the
// faceId lookup.
const fakeShape = { faces: [{}], edges: [{}] } as never;

describe("measure.ts: a kernel-call failure degrades to null instead of throwing", () => {
  beforeEach(() => {
    vi.mocked(getCurrentShape).mockReturnValue(fakeShape);
  });

  it("computeMassProperties", () => {
    expect(() => computeMassProperties()).not.toThrow();
    expect(computeMassProperties()).toBeNull();
  });

  it("computeMeasureSummary", () => {
    const picks = [{ kind: "face" as const, id: 0 }];
    expect(() => computeMeasureSummary(picks)).not.toThrow();
    expect(computeMeasureSummary(picks)).toBeNull();
  });

  it("computeSectionProperties", () => {
    expect(() => computeSectionProperties(0)).not.toThrow();
    expect(computeSectionProperties(0)).toBeNull();
  });
});
