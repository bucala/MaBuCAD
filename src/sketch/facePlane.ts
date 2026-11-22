import { Vector3 } from "three";

import type { FeatureParameters } from "@/types/document";

import { planeBasis, planeFrame, type PlaneFeature } from "./planeBasis";

const DEFAULT_PLANE_IDS = ["plane-front", "plane-top", "plane-right"] as const;

/** A face counts as parallel to a default plane only when it genuinely is (float noise
 * only) — an almost-aligned face gets an exact frozen frame instead of being snapped. */
const ALIGNED_DOT = 1 - 1e-6;

/** Relative planarity tolerance: vertex distance from the fitted plane, as a fraction of
 * the face's own size. */
const PLANARITY_TOLERANCE = 1e-4;

export interface FacePlane {
  /** A point on the face (its vertex centroid), world space. */
  point: Vector3;
  /** Unit outward normal, world space. */
  normal: Vector3;
}

interface FaceMesh {
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  indices: ArrayLike<number>;
  faceGroups: readonly { id: number; start: number; count: number }[];
}

/**
 * The plane of one kernel face from the tessellated mesh, or null when the face is not
 * planar (a cylinder, a fillet). The normal is the area-weighted triangle normal, oriented
 * to agree with the mesh's own vertex normals so it points out of the material.
 */
export function facePlaneFromMesh(mesh: FaceMesh, faceId: number): FacePlane | null {
  const group = mesh.faceGroups.find((candidate) => candidate.id === faceId);
  if (!group || group.count < 3) return null;

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const areaNormal = new Vector3();
  const vertexNormal = new Vector3();
  const centroid = new Vector3();
  const vertices = new Set<number>();

  const at = (index: number, target: Vector3) =>
    target.set(mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!);

  for (let i = group.start; i + 2 < group.start + group.count; i += 3) {
    const ia = mesh.indices[i]!;
    const ib = mesh.indices[i + 1]!;
    const ic = mesh.indices[i + 2]!;
    at(ia, a);
    at(ib, b);
    at(ic, c);
    areaNormal.add(new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)));
    for (const index of [ia, ib, ic]) vertices.add(index);
  }

  if (areaNormal.lengthSq() < 1e-18 || vertices.size < 3) return null;
  const normal = areaNormal.clone().normalize();

  const point = new Vector3();
  let extent = 0;
  for (const index of vertices) {
    centroid.add(at(index, point));
    vertexNormal.x += mesh.normals[index * 3] ?? 0;
    vertexNormal.y += mesh.normals[index * 3 + 1] ?? 0;
    vertexNormal.z += mesh.normals[index * 3 + 2] ?? 0;
  }
  centroid.divideScalar(vertices.size);
  for (const index of vertices) extent = Math.max(extent, at(index, point).distanceTo(centroid));

  const tolerance = Math.max(extent * PLANARITY_TOLERANCE, 1e-6);
  for (const index of vertices) {
    if (Math.abs(at(index, point).sub(centroid).dot(normal)) > tolerance) return null;
  }

  if (vertexNormal.lengthSq() > 0 && vertexNormal.dot(normal) < 0) normal.negate();
  return { point: centroid, normal };
}

/** What a reference plane flush with a face needs: its `parents` and `parameters`. */
export interface FacePlaneSpec {
  parents: string[];
  parameters: FeatureParameters;
}

/**
 * Describes a reference plane lying on `face`, facing out of the material (so a sketch on
 * it extrudes a boss outward). A face parallel to a default plane becomes a parametric
 * offset of it (`distance` along that plane's normal, `flipped` when the face looks the
 * other way); any other planar face gets its frame frozen into `parameters.frame`, with the
 * sketch's "up" as close to world +Y as the face allows.
 */
export function facePlaneSpec(face: FacePlane): FacePlaneSpec {
  for (const id of DEFAULT_PLANE_IDS) {
    const baseNormal = planeBasis(id).normal;
    const dot = baseNormal.dot(face.normal);
    if (Math.abs(dot) >= ALIGNED_DOT) {
      return {
        parents: [id],
        parameters: { distance: roundMm(face.point.dot(baseNormal)), flipped: dot < 0, fromFace: true },
      };
    }
  }

  const normal = face.normal.clone().normalize();
  const worldUp = Math.abs(normal.y) < 0.99 ? new Vector3(0, 1, 0) : new Vector3(0, 0, -1);
  const up = worldUp.addScaledVector(normal, -worldUp.dot(normal)).normalize();
  const xDir = new Vector3().crossVectors(up, normal).normalize();
  return {
    parents: [],
    parameters: {
      distance: 0,
      fromFace: true,
      frame: {
        origin: face.point.toArray() as [number, number, number],
        xDir: xDir.toArray() as [number, number, number],
        normal: normal.toArray() as [number, number, number],
      },
    },
  };
}

/** Snap float noise off a measured offset (1e-6 mm) so a face at 20 mm reads as 20. */
function roundMm(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * An existing, unsuppressed reference plane already lying where `spec` would put one
 * (same placement and facing), so sketching on the same face twice reuses one plane
 * instead of stacking duplicates in the tree.
 */
export function findMatchingPlane(
  features: readonly (PlaneFeature & { suppressed?: boolean })[],
  spec: FacePlaneSpec,
): string | null {
  const probe: PlaneFeature = { id: "__probe__", kind: "reference-plane", parents: spec.parents, parameters: spec.parameters };
  const wanted = planeFrame(probe.id, [...features, probe]);
  for (const feature of features) {
    if (feature.kind !== "reference-plane" || feature.suppressed) continue;
    const frame = planeFrame(feature.id, features);
    if (
      frame.origin.clone().sub(wanted.origin).dot(wanted.normal) ** 2 < 1e-12 &&
      frame.normal.dot(wanted.normal) > ALIGNED_DOT &&
      frame.xDir.dot(wanted.xDir) > ALIGNED_DOT
    ) {
      return feature.id;
    }
  }
  return null;
}
