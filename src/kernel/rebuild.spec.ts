import { makeBaseBox } from "replicad";
import { beforeAll, describe, expect, it } from "vitest";

import { initKernel } from "./occ";
import { nearestEdgeTo, pickedEdgeFilter, type Solid } from "./rebuild";
import { EdgeFinder } from "replicad";

/**
 * Regression coverage for the "selecting one edge also chamfers edges I didn't want" bug:
 * the old `pickedEdgeFilter` handed a plain `EdgeFinder.withinDistance` radius filter
 * straight to `fillet`/`chamfer`, which keeps *every* edge within that radius of a picked
 * point — and near a corner, several real edges routinely sit within `EDGE_PICK_TOLERANCE`
 * (0.75mm) of each other. These pins build a real box with the real OCCT kernel and assert
 * a pick near a corner resolves to exactly the one nearest edge, not every edge nearby.
 */
describe("nearestEdgeTo / pickedEdgeFilter: one click resolves to one edge", () => {
  beforeAll(async () => {
    await initKernel();
  }, 30_000);

  function box10(): Solid {
    return makeBaseBox(10, 10, 10) as unknown as Solid;
  }

  it("resolves a point at an edge's own midpoint to exactly that edge", () => {
    const solid = box10();
    const target = solid.edges[0]!;
    const midpoint = target.pointAt(0.5).toTuple();

    const resolved = nearestEdgeTo(solid, midpoint);
    expect(resolved).not.toBeNull();
    expect(resolved!.pointAt(0.5).toTuple()).toEqual(midpoint);
  });

  it("near a corner, where a neighbouring edge's endpoint also falls within tolerance, picks only the nearer edge", () => {
    const solid = box10();
    // `makeBaseBox(10,10,10)` is centred in X/Y and runs 0..10 in Z, so (5, 5, 0) is a
    // real shared corner of three edges. Find the one running along X through it, from
    // (-5, 5, 0) to (5, 5, 0).
    const alongX = solid.edges.find((edge) => {
      const a = edge.startPoint.toTuple();
      const b = edge.endPoint.toTuple();
      const atCorner = (p: [number, number, number]) => p[0] === 5 && p[1] === 5 && p[2] === 0;
      const atOpposite = (p: [number, number, number]) => p[0] === -5 && p[1] === 5 && p[2] === 0;
      return (atCorner(a) && atOpposite(b)) || (atCorner(b) && atOpposite(a));
    })!;
    expect(alongX).toBeDefined();

    // A point 0.3mm from the shared corner (5, 5, 0), along the edge itself — well within
    // `EDGE_PICK_TOLERANCE` (0.75mm) of BOTH this edge (it's almost on it) and every other
    // edge meeting at that same corner (their nearest point, the corner itself, is only
    // 0.3mm away) — exactly the ambiguous-near-a-corner geometry from the bug report.
    const point: [number, number, number] = [4.7, 5, 0];

    const resolved = nearestEdgeTo(solid, point);
    expect(resolved).not.toBeNull();
    expect(resolved!.startPoint.toTuple().concat(resolved!.endPoint.toTuple())).toEqual(
      alongX.startPoint.toTuple().concat(alongX.endPoint.toTuple()),
    );

    // And the filter built from that single pick must resolve to exactly one real edge —
    // the bug's own symptom was this count being 2 or more.
    const filter = pickedEdgeFilter(solid, [point]);
    expect(filter).toBeDefined();
    const matches = filter!(new EdgeFinder()).find(solid as never);
    expect(matches).toHaveLength(1);
  });

  it("returns undefined (meaning \"every edge\", replicad's own fillet/chamfer default) when no points are picked", () => {
    const solid = box10();
    expect(pickedEdgeFilter(solid, undefined)).toBeUndefined();
    expect(pickedEdgeFilter(solid, [])).toBeUndefined();
  });

  it("drops a stale pick that no longer resolves to any edge on the rebuilt solid", () => {
    const solid = box10();
    const farAway: [number, number, number] = [1000, 1000, 1000];
    expect(nearestEdgeTo(solid, farAway)).toBeNull();
    expect(pickedEdgeFilter(solid, [farAway])).toBeUndefined();
  });
});
