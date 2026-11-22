import { Euler, Matrix4, Quaternion, Vector3 } from "three";

import { REFERENCE_PLANES } from "@/components/viewport/constants";
import type { Feature } from "@/types/document";

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

/** Orientation of one of the three default planes (unknown ids fall back to Front). For a
 * plane that may be a user `reference-plane`, use `planeFrame` instead. */
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

/**
 * A sketch plane's full placement: orientation *and* origin.
 *
 * Default planes pass through the world origin. A user `reference-plane` sits `distance`
 * along its base plane's normal (its base being `parents[0]`: a default plane or another
 * reference plane, so offsets chain), optionally `flipped` to face the other way — which is
 * how a plane made flush with a downward-facing face still has its sketch normal pointing
 * out of the material. A plane made on a face that is not parallel to any default plane
 * stores its frame directly (`parameters.frame`) instead, since there is no persistent face
 * naming to re-derive it from on rebuild.
 */
export interface PlaneFrame {
  quaternion: Quaternion;
  normal: Vector3;
  up: Vector3;
  /** Local +X in world space. */
  xDir: Vector3;
  origin: Vector3;
}

/** The subset of `Feature` the resolver reads, so callers can pass any feature list. */
export type PlaneFeature = Pick<Feature, "id" | "kind" | "parents" | "parameters">;

const MAX_CHAIN_DEPTH = 32;

function frameFromBasis(quaternion: Quaternion, origin: Vector3): PlaneFrame {
  return {
    quaternion,
    normal: new Vector3(0, 0, 1).applyQuaternion(quaternion),
    up: new Vector3(0, 1, 0).applyQuaternion(quaternion),
    xDir: new Vector3(1, 0, 0).applyQuaternion(quaternion),
    origin,
  };
}

function isFiniteTriple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** Orthonormal frame from a stored origin/xDir/normal, or null when the data is unusable. */
export function frameFromVectors(
  origin: readonly [number, number, number],
  xDir: readonly [number, number, number],
  normal: readonly [number, number, number],
): PlaneFrame | null {
  const z = new Vector3(...normal);
  if (z.lengthSq() < 1e-12) return null;
  z.normalize();
  const x = new Vector3(...xDir);
  x.addScaledVector(z, -x.dot(z));
  if (x.lengthSq() < 1e-12) return null;
  x.normalize();
  const y = new Vector3().crossVectors(z, x);
  const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  return frameFromBasis(quaternion, new Vector3(...origin));
}

const FLIP = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);

function resolve(planeId: string, features: readonly PlaneFeature[], depth: number): PlaneFrame {
  const feature = depth < MAX_CHAIN_DEPTH ? features.find((candidate) => candidate.id === planeId) : undefined;

  if (feature?.kind === "reference-plane") {
    const stored = feature.parameters.frame;
    const base =
      stored && isFiniteTriple(stored.origin) && isFiniteTriple(stored.xDir) && isFiniteTriple(stored.normal)
        ? frameFromVectors(stored.origin, stored.xDir, stored.normal)
        : null;
    const parent = base ?? resolve(feature.parents[0] ?? REFERENCE_PLANES[0].id, features, depth + 1);

    const distance = Number.isFinite(feature.parameters.distance) ? (feature.parameters.distance ?? 0) : 0;
    const origin = parent.origin.clone().addScaledVector(parent.normal, distance);
    // Flipping turns the plane around its own local Y, so "up" in the sketch stays up and
    // only the normal (and with it local X) reverses — looking at the plane from behind.
    const quaternion = feature.parameters.flipped
      ? parent.quaternion.clone().multiply(FLIP)
      : parent.quaternion.clone();
    return frameFromBasis(quaternion, origin);
  }

  const basis = planeBasis(planeId);
  return frameFromBasis(basis.quaternion.clone(), new Vector3());
}

/** Resolves any sketchable plane id — default plane or user reference plane — to its frame. */
export function planeFrame(planeId: string, features: readonly PlaneFeature[] = []): PlaneFrame {
  return resolve(planeId, features, 0);
}

/** Frame-local 2D coordinates to world space. */
export function frameToWorld(frame: PlaneFrame, x: number, y: number, target = new Vector3()): Vector3 {
  return target.set(x, y, 0).applyQuaternion(frame.quaternion).add(frame.origin);
}

/** World space to frame-local 2D coordinates; the out-of-plane component is discarded. */
export function worldToFrame(frame: PlaneFrame, world: Vector3): { x: number; y: number } {
  const local = world.clone().sub(frame.origin).applyQuaternion(frame.quaternion.clone().invert());
  return { x: local.x, y: local.y };
}

/** Sketch coordinates to world space. */
export function sketchToWorld(
  planeId: string,
  x: number,
  y: number,
  features: readonly PlaneFeature[] = [],
  target = new Vector3(),
): Vector3 {
  return frameToWorld(planeFrame(planeId, features), x, y, target);
}

/** World space to sketch coordinates; the out-of-plane component is discarded. */
export function worldToSketch(
  planeId: string,
  world: Vector3,
  features: readonly PlaneFeature[] = [],
): { x: number; y: number } {
  return worldToFrame(planeFrame(planeId, features), world);
}

/** Whether `planeId` can carry a sketch: a default plane or a user reference plane. */
export function isSketchablePlane(planeId: string, features: readonly PlaneFeature[]): boolean {
  return (
    REFERENCE_PLANES.some((plane) => plane.id === planeId) ||
    features.some((feature) => feature.id === planeId && feature.kind === "reference-plane")
  );
}
