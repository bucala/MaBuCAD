import type { MeshData } from "@/kernel/rebuild";

/**
 * Nearest `EdgeGroup.id` to a point in the mesh's own un-rotated local space — shared by
 * the Fillet/Chamfer picked-edge highlight (`SolidModel.tsx`'s
 * `pickedEdgeHighlightGeometry`), edge picking itself (`handleEdgeClick`) and Inspect >
 * Measure's edge pick, all of which only have a raycaster hit point to start from, not a
 * kernel edge id.
 *
 * Measured against each group's *segments*, not its vertices: a click lands in the middle
 * of a long edge as often as anywhere, and vertex-only comparison let every edge sharing
 * that edge's endpoints compete on distance-to-endpoint — so a mid-edge pick resolved to
 * whichever neighbouring edge's endpoint happened to sit a hair closer (or to iteration
 * order on an exact tie), landing the pick — and its highlight — on the edge *next* to the
 * one clicked. Point-to-segment distance makes the edge the point actually lies on win by
 * construction: its distance is the perpendicular one, while every other group's is at
 * least as large.
 */
export function nearestEdgeGroupId(
  mesh: Pick<MeshData, "edges" | "edgeGroups">,
  point: readonly [number, number, number],
): number | null {
  let bestId: number | null = null;
  let bestDistanceSq = Infinity;
  for (const group of mesh.edgeGroups) {
    const startFloat = group.start * 3;
    const endFloat = startFloat + group.count * 3;
    // `mesh.edges` holds segment endpoint pairs (see `EdgeGroup`'s doc comment), and one
    // group's slice tessellates one edge — so every consecutive vertex pair within it is
    // one of that edge's segments (with shared tessellation vertices repeated between
    // pairs, whose degenerate zero-length turn is a no-op below).
    let measured = false;
    for (let i = startFloat; i + 3 < endFloat; i += 3) {
      measured = true;
      const ax = mesh.edges[i];
      const ay = mesh.edges[i + 1];
      const az = mesh.edges[i + 2];
      const ux = mesh.edges[i + 3] - ax;
      const uy = mesh.edges[i + 4] - ay;
      const uz = mesh.edges[i + 5] - az;
      const vx = point[0] - ax;
      const vy = point[1] - ay;
      const vz = point[2] - az;
      const lengthSq = ux * ux + uy * uy + uz * uz;
      // Clamped projection of the point onto the segment — the distance to the segment,
      // never past its end onto the infinite line through it.
      const t = lengthSq > 0 ? Math.min(1, Math.max(0, (vx * ux + vy * uy + vz * uz) / lengthSq)) : 0;
      const dx = vx - t * ux;
      const dy = vy - t * uy;
      const dz = vz - t * uz;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestId = group.id;
      }
    }
    // A group holding a single vertex has no segment to measure; the vertex is still
    // measurable as the point it is — the one case the old vertex-only resolver covered
    // that segments cannot, kept so no input can resolve *worse* than it used to.
    if (!measured && endFloat > startFloat) {
      const dx = mesh.edges[startFloat] - point[0];
      const dy = mesh.edges[startFloat + 1] - point[1];
      const dz = mesh.edges[startFloat + 2] - point[2];
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestId = group.id;
      }
    }
  }
  return bestId;
}
