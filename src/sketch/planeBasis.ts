import { Euler, Quaternion, Vector3 } from "three";

import { REFERENCE_PLANES } from "@/components/viewport/constants";

/**
 * Maps between a sketch's local 2D coordinates and world space.
 *
 * The rotations come straight from `REFERENCE_PLANES`, so the basis a sketch uses is by
 * construction the same one the plane is drawn with — there is no second definition of
 * "where the Front plane is" to drift out of step.
 */
export interface PlaneBasis {
  quaternion: Quaternion;
  /** Plane normal in world space. */
  normal: Vector3;
  /** Local +Y in world space, used as the camera up vector in sketch mode. */
  up: Vector3;
  rotation: readonly [number, number, number];
}

const BASIS_CACHE = new Map<string, PlaneBasis>();

export function planeBasis(planeId: string): PlaneBasis {
  const cached = BASIS_CACHE.get(planeId);
  if (cached) return cached;

  const plane = REFERENCE_PLANES.find((candidate) => candidate.id === planeId) ?? REFERENCE_PLANES[0];
  const quaternion = new Quaternion().setFromEuler(new Euler(...plane.rotation));

  const basis: PlaneBasis = {
    quaternion,
    normal: new Vector3(0, 0, 1).applyQuaternion(quaternion),
    up: new Vector3(0, 1, 0).applyQuaternion(quaternion),
    rotation: plane.rotation,
  };

  BASIS_CACHE.set(planeId, basis);
  return basis;
}

/** Sketch coordinates to world space. */
export function sketchToWorld(planeId: string, x: number, y: number, target = new Vector3()): Vector3 {
  return target.set(x, y, 0).applyQuaternion(planeBasis(planeId).quaternion);
}

/** World space to sketch coordinates; the out-of-plane component is discarded. */
export function worldToSketch(planeId: string, world: Vector3): { x: number; y: number } {
  const local = world.clone().applyQuaternion(planeBasis(planeId).quaternion.clone().invert());
  return { x: local.x, y: local.y };
}
