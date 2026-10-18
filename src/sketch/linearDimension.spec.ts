import { describe, expect, it } from "vitest";

import { linearDimensionLeader } from "./sketchModel";

describe("linearDimensionLeader", () => {
  it.each([
    ["horizontal", { x: 0, y: 6 }, { x: 40, y: 6 }, { x: 15, y: 9 }],
    ["vertical", { x: 6, y: 0 }, { x: 6, y: 30 }, { x: 9, y: 15 }],
    ["aligned", { x: 0, y: 0 }, { x: 40, y: 30 }, { x: 20, y: 15 }],
  ] as const)("needs no extra leader for text within a %s span", (_, start, end, label) => {
    expect(linearDimensionLeader(start, end, label)).toBeNull();
  });

  it.each([
    ["horizontal", { x: 0, y: 6 }, { x: 40, y: 6 }, { x: -20, y: 9 }, "start"],
    ["horizontal", { x: 0, y: 6 }, { x: 40, y: 6 }, { x: 60, y: 9 }, "end"],
    ["vertical", { x: 6, y: 0 }, { x: 6, y: 30 }, { x: 9, y: -20 }, "start"],
    ["vertical", { x: 6, y: 0 }, { x: 6, y: 30 }, { x: 9, y: 50 }, "end"],
    ["aligned", { x: 0, y: 0 }, { x: 40, y: 30 }, { x: -40, y: -30 }, "start"],
    ["aligned", { x: 0, y: 0 }, { x: 40, y: 30 }, { x: 80, y: 60 }, "end"],
  ] as const)("joins text outside a %s span to the nearest endpoint", (_, start, end, label, endpoint) => {
    expect(linearDimensionLeader(start, end, label)).toEqual([endpoint === "start" ? start : end, label]);
  });

  it("handles reversed measured endpoints", () => {
    const start = { x: 40, y: 6 };
    const end = { x: 0, y: 6 };
    const label = { x: 60, y: 9 };
    expect(linearDimensionLeader(start, end, label)).toEqual([start, label]);
  });

  it("connects a label outside a zero-length span without dividing by zero", () => {
    const endpoint = { x: 4, y: 8 };
    const label = { x: 9, y: 15 };
    expect(linearDimensionLeader(endpoint, endpoint, label)).toEqual([endpoint, label]);
  });

  it("does not render a zero-length connector", () => {
    const endpoint = { x: 4, y: 8 };
    expect(linearDimensionLeader(endpoint, endpoint, endpoint)).toBeNull();
  });
});
