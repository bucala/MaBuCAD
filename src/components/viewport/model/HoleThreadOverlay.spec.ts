import { describe, expect, it } from "vitest";
import { Vector3 } from "three";

import { threadMeshTransform } from "./HoleThreadOverlay";

/**
 * The cosmetic thread used to be positioned in the Front plane's frame and rely on a
 * whole-mesh display rotation to land; since `kernel/rebuild.ts` builds every hole in its
 * own plane's true world space, that rotation is gone and a thread on the Top or Right
 * plane would float beside its hole. These pin the world placement per reference plane:
 * the cylinder's midpoint sits half its depth along the plane's own normal from the hole
 * point, and its axis (three.js `CylinderGeometry`'s local Y) runs along that normal.
 */
function axisOf(quaternion: ReturnType<typeof threadMeshTransform>["quaternion"]): [number, number, number] {
  const axis = new Vector3(0, 1, 0).applyQuaternion(quaternion);
  return [axis.x, axis.y, axis.z];
}

function expectClose(actual: [number, number, number], expected: [number, number, number]): void {
  for (let i = 0; i < 3; i++) expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThan(1e-9);
}

describe("threadMeshTransform", () => {
  it("Front plane: normal +Z, local (x, y) unchanged", () => {
    const { position, quaternion } = threadMeshTransform("plane-front", { x: 10, y: 10 }, 0, 4, 1);
    expectClose(position, [10, 10, 2]);
    expectClose(axisOf(quaternion).map(Math.abs) as [number, number, number], [0, 0, 1]);
  });

  it("Top plane: normal +Y, local (x, y) -> world (x, 0, -y)", () => {
    const { position, quaternion } = threadMeshTransform("plane-top", { x: 10, y: 10 }, 0, 4, 1);
    expectClose(position, [10, 2, -10]);
    expectClose(axisOf(quaternion).map(Math.abs) as [number, number, number], [0, 1, 0]);
  });

  it("Right plane: normal +X, local (x, y) -> world (0, y, -x)", () => {
    const { position, quaternion } = threadMeshTransform("plane-right", { x: 10, y: 10 }, 0, 4, 1);
    expectClose(position, [2, 10, -10]);
    expectClose(axisOf(quaternion).map(Math.abs) as [number, number, number], [1, 0, 0]);
  });

  it("a reversed hole's thread runs the other way along the normal", () => {
    const { position } = threadMeshTransform("plane-top", { x: 10, y: 10 }, 0, 4, -1);
    expectClose(position, [10, -2, -10]);
  });
});
