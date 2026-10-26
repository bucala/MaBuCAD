import { describe, expect, it } from "vitest";

import { highestIdSuffix } from "./idSuffix";

describe("highestIdSuffix", () => {
  it("returns 0 for a value with no matching ids", () => {
    expect(highestIdSuffix({ name: "box", count: 3 })).toBe(0);
    expect(highestIdSuffix(null)).toBe(0);
    expect(highestIdSuffix(undefined)).toBe(0);
    expect(highestIdSuffix("no-suffix-here")).toBe(0);
  });

  it("reads the numeric suffix off a single id string", () => {
    expect(highestIdSuffix("feature-7")).toBe(7);
    expect(highestIdSuffix("sketch-42")).toBe(42);
  });

  it("finds the highest suffix across sibling fields", () => {
    expect(highestIdSuffix({ id: "feature-3", other: "feature-9" })).toBe(9);
  });

  it("recurses into nested objects and arrays", () => {
    const value = {
      features: [{ id: "feature-5" }, { id: "feature-12", children: [{ id: "feature-8" }] }],
      meta: { createdBy: "feature-1" },
    };
    expect(highestIdSuffix(value)).toBe(12);
  });

  it("ignores strings longer than the candidate length cap", () => {
    const long = `${"x".repeat(250)}-99`;
    expect(highestIdSuffix({ blob: long, id: "feature-4" })).toBe(4);
  });

  it("ignores a suffix that isn't a trailing numeric group", () => {
    expect(highestIdSuffix("feature-4-draft")).toBe(0);
  });
});
