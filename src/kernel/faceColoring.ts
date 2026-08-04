import type { MeshData } from "./rebuild";

const AXIS_VECTORS: Record<"x" | "y" | "z", [number, number, number]> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

/**
 * Average unit normal of one face's own triangles, straight from the mesh's per-vertex
 * normals — good enough for a visual angle-to-axis classification (Draft Analysis) even
 * though it is not the kernel's own exact surface normal the way `kernel/measure.ts`'s
 * Face-based functions are exact. A curved face's average tilts toward however it's more
 * curved; fine for colouring a face green/red, not something to build geometry from.
 */
function averageFaceNormal(mesh: MeshData, faceId: number): [number, number, number] | null {
  const group = mesh.faceGroups.find((candidate) => candidate.id === faceId);
  if (!group) return null;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = group.start; i < group.start + group.count; i += 1) {
    const vertexIndex = mesh.indices[i] * 3;
    nx += mesh.normals[vertexIndex];
    ny += mesh.normals[vertexIndex + 1];
    nz += mesh.normals[vertexIndex + 2];
  }
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-9) return null;
  return [nx / length, ny / length, nz / length];
}

/** Angle in degrees (0-180) between a face's average normal and a pull axis — 0 means the
 * face points straight along the axis, 90 means it runs parallel to it (a wall with no
 * draft at all along this axis). */
export function faceAngleToAxis(mesh: MeshData, faceId: number, axis: "x" | "y" | "z"): number | null {
  const normal = averageFaceNormal(mesh, faceId);
  if (!normal) return null;

  const [ax, ay, az] = AXIS_VECTORS[axis];
  const dot = Math.max(-1, Math.min(1, normal[0] * ax + normal[1] * ay + normal[2] * az));
  return (Math.acos(dot) * 180) / Math.PI;
}

/**
 * Builds a per-vertex RGB colour buffer for the whole mesh — every triangle of a face gets
 * the colour `colorForFaceId` returns for it, or `fallback` where that returns `null`.
 * Shared by Draft Analysis (colour by angle-to-axis) and Appearance (colour by user pick),
 * the two Inspect tools that need to recolour the body without touching its geometry.
 */
export function buildFaceColorAttribute(
  mesh: MeshData,
  colorForFaceId: (faceId: number) => [number, number, number] | null,
  fallback: [number, number, number],
): Float32Array {
  const colors = new Float32Array(mesh.positions.length);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = fallback[0];
    colors[i + 1] = fallback[1];
    colors[i + 2] = fallback[2];
  }

  for (const group of mesh.faceGroups) {
    const color = colorForFaceId(group.id) ?? fallback;
    for (let i = group.start; i < group.start + group.count; i += 1) {
      const vertexIndex = mesh.indices[i] * 3;
      colors[vertexIndex] = color[0];
      colors[vertexIndex + 1] = color[1];
      colors[vertexIndex + 2] = color[2];
    }
  }

  return colors;
}
