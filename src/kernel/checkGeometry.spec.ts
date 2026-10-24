import { beforeEach, describe, expect, it, vi } from "vitest";

/** See `measure.spec.ts`'s own doc comment — same regression, same mechanism, for Check
 * Geometry's own kernel calls. */
vi.mock("replicad", () => ({
  measureArea: vi.fn(() => {
    throw new Error("kernel measurement failed");
  }),
  measureLength: vi.fn(() => {
    throw new Error("kernel measurement failed");
  }),
}));

vi.mock("./rebuild", () => ({
  getCurrentShape: vi.fn(),
}));

import { getCurrentShape } from "./rebuild";
import { computeGeometryCheck } from "./checkGeometry";

const fakeShape = { faces: [{}], edges: [{}] } as never;

describe("checkGeometry.ts: a kernel-call failure degrades to null instead of throwing", () => {
  beforeEach(() => {
    vi.mocked(getCurrentShape).mockReturnValue(fakeShape);
  });

  it("computeGeometryCheck", () => {
    expect(() => computeGeometryCheck()).not.toThrow();
    expect(computeGeometryCheck()).toBeNull();
  });
});
