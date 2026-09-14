import { describe, expect, it } from "vitest";

import type { EdgeGroup } from "@/kernel/rebuild";

import { nearestEdgeGroupId } from "./edgePicking";

/**
 * Unit tests for the point-to-segment edge resolver behind Fillet/Chamfer picking,
 * Measure's edge picks and the picked-edge highlight (`SolidModel.tsx`).
 *
 * The one behaviour that matters most is pinned first: a click in the middle of a long
 * edge must resolve to *that* edge. The previous vertex-only comparison let every edge
 * sharing the clicked edge's endpoints compete on distance-to-endpoint, so mid-edge picks
 * landed on whichever neighbouring edge's endpoint sat a hair closer — or on plain
 * iteration order, the exact-tie case below.
 */

/** A mesh-shaped stand-in carrying only what `nearestEdgeGroupId` reads. */
function meshWith(edges: number[], groups: EdgeGroup[]) {
  return { edges: Float32Array.from(edges), edgeGroups: groups };
}

/**
 * `edges` for an edge tessellated into its vertex pairs, the layout replicad's `meshEdges()`
 * actually produces: one pair per segment, shared tessellation vertices repeated between
 * pairs (a polyline p0..p3 becomes [p0,p1, p1,p2, p2,p3]) — so a polyline of N points spans
 * 2(N-1) vertices, and `EdgeGroup.start`/`count` are in exactly those vertex units (see
 * `EdgeGroup`'s doc comment).
 */
function pairedEdge(polyline: [number, number, number][]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < polyline.length; i += 1) {
    out.push(...polyline[i], ...polyline[i + 1]);
  }
  return out;
}

/** Groups for a series of `pairedEdge` polylines, laid out back to back with sequential ids. */
function groupsFor(polylines: [number, number, number][][]): EdgeGroup[] {
  const groups: EdgeGroup[] = [];
  let vertexCursor = 0;
  polylines.forEach((polyline, index) => {
    groups.push({ start: vertexCursor, count: (polyline.length - 1) * 2, id: index });
    vertexCursor += (polyline.length - 1) * 2;
  });
  return groups;
}

describe("nearestEdgeGroupId", () => {
  it("resolves a mid-edge click on a long edge to that edge, not a shared-corner neighbour", () => {
    // Edge 0: a 100-long straight edge. Edge 1: a short one sharing its far endpoint,
    // placed FIRST in the group list — so a vertex-only resolver ties on the shared
    // endpoint (distance 50) and hands the pick to edge 1 by iteration order.
    const long: [number, number, number][] = [
      [0, 0, 0],
      [100, 0, 0],
    ];
    const short: [number, number, number][] = [
      [100, 0, 0],
      [100, 50, 0],
    ];
    const mesh = meshWith([...pairedEdge(short), ...pairedEdge(long)], [
      { start: 2, count: 2, id: 0 }, // the long edge, listed second — the tie-breaker trap
      { start: 0, count: 2, id: 1 }, // the short neighbour, listed first
    ]);

    // Exactly on the long edge's midpoint: the neighbour's best vertex distance ties at
    // 50, the long edge's segment distance is 0 — only the segment measurement can land
    // this pick on the edge that was actually clicked.
    expect(nearestEdgeGroupId(mesh, [50, 0, 0])).toBe(0);

    // Slightly off the midpoint (a raycaster hit lands a fraction away, never exactly on
    // the curve): still the clicked edge by a wide margin.
    expect(nearestEdgeGroupId(mesh, [50, 0.4, 0])).toBe(0);
    expect(nearestEdgeGroupId(mesh, [50, -0.4, 0.2])).toBe(0);
  });

  it("still resolves correctly when the click is near the shared corner itself", () => {
    // Two edges meeting at (100, 0, 0). A click near the corner but along one of them
    // must stay on that one — the corner is the one place both are plausible, and the
    // perpendicular distance is what separates them.
    const edgeA: [number, number, number][] = [
      [0, 0, 0],
      [100, 0, 0],
    ];
    const edgeB: [number, number, number][] = [
      [100, 0, 0],
      [100, 50, 0],
    ];
    const mesh = meshWith([...pairedEdge(edgeA), ...pairedEdge(edgeB)], groupsFor([edgeA, edgeB]));

    expect(nearestEdgeGroupId(mesh, [99.5, 0, 0])).toBe(0); // along A, near the corner
    expect(nearestEdgeGroupId(mesh, [100, 0.5, 0])).toBe(1); // along B, near the corner
    expect(nearestEdgeGroupId(mesh, [100, 0, 0])).toBe(0); // exactly on the corner: A, iterated first
  });

  it("measures a tessellated curve by its segments, so a click on the arc resolves to the arc", () => {
    // A straight edge and a tessellated quarter-arc edge side by side, the way `meshEdges`
    // reports a rounded corner next to a flat edge.
    const straight: [number, number, number][] = [
      [0, 20, 0],
      [40, 20, 0],
    ];
    const arc: [number, number, number][] = [
      [40, 20, 0],
      [40, 16, 2],
      [38, 14, 5],
      [35, 13, 8],
    ];
    const mesh = meshWith(
      [...pairedEdge(straight), ...pairedEdge(arc)],
      groupsFor([straight, arc]),
    );

    // Mid-arc click: closer to the arc's own segments than to anything on the straight
    // edge — the vertex-only resolver could only see the four tessellation vertices.
    expect(nearestEdgeGroupId(mesh, [39.9, 14.8, 3.4])).toBe(1);
    // A click mid-straight-edge still stays straight.
    expect(nearestEdgeGroupId(mesh, [20, 20.3, 0])).toBe(0);
  });

  it("handles a single-vertex (degenerate) group without measuring a phantom segment", () => {
    // A group can only hold a lone vertex in degenerate input, but the loop must not read
    // past the group's slice into someone else's data: the lone vertex is measured as the
    // point it is, never as a segment formed with the *next* group's first vertex.
    const edgeA: [number, number, number][] = [
      [0, 0, 0],
      [10, 0, 0],
    ];
    const mesh = meshWith([...pairedEdge(edgeA), 100, 100, 100], [
      { start: 0, count: 2, id: 0 }, // a real segment pair
      { start: 2, count: 1, id: 9 }, // one stray vertex, no pair to form a segment
    ]);

    // Mid-A still resolves to A, and the degenerate group never invents geometry for it.
    expect(nearestEdgeGroupId(mesh, [5, 0.1, 0])).toBe(0);
    // A click exactly at the lone vertex resolves to that group, the same point-distance
    // the vertex-only resolver always gave it.
    expect(nearestEdgeGroupId(mesh, [100, 100, 100])).toBe(9);
  });

  it("returns null only when there are no groups to resolve against", () => {
    const mesh = meshWith([], []);
    expect(nearestEdgeGroupId(mesh, [0, 0, 0])).toBeNull();

    const single = meshWith([0, 0, 0, 10, 0, 0], [{ start: 0, count: 2, id: 3 }]);
    expect(nearestEdgeGroupId(single, [7, 9, 9])).toBe(3); // nearest group, however far
  });
});
