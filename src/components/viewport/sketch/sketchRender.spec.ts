import { describe, expect, it } from "vitest";

import { arc, circle, largeSketchFixture, line, p } from "@/sketch/testFixtures";
import type { Sketch, SketchEntity, SketchPoint, SplineEntity } from "@/sketch/types";

import { entityPointVersion, resolveEntityPolyline, type PointReader } from "./sketchRender";

/**
 * Unit tests for the render-memoisation contract in `sketchRender.ts`: an entity's
 * polyline must only rebuild when a point *it references* (or, for circles/arcs, its
 * radius) actually changed — never because the sketch object was rewritten, which
 * `dragPoint` does on every pointer-move. The version key is what a large sketch's drag
 * performance hangs on, so its stability rules are pinned here rather than left implicit
 * in `EntityView`'s `useMemo`.
 */

/** Reader over a freshly built map, the way `SketchGeometry` builds one shared reader per
 * points-array identity and hands it to every `EntityView`. */
function reader(points: SketchPoint[]): PointReader {
  const map = new Map(points.map((point) => [point.id, point]));
  return (id) => map.get(id);
}

function spline(id: string, pointIds: string[]): SplineEntity {
  return { id, kind: "spline", points: pointIds, construction: false };
}

describe("entityPointVersion", () => {
  it("is unchanged when the point pool is rebuilt with identical coordinates", () => {
    const entity = line("l1", "a", "b");
    const before = entityPointVersion(entity, reader([p("a", 0, 0), p("b", 10, 5)]));

    // Fresh point objects at the same coordinates — what an immutable store update that
    // didn't touch this entity produces. Same content must mean same key, or every drag
    // frame would invalidate every entity's memo at once.
    const after = entityPointVersion(entity, reader([{ ...p("a", 0, 0) }, { ...p("b", 10, 5) }]));

    expect(after).toBe(before);
  });

  it("changes when one of the entity's own points moves", () => {
    const entity = line("l1", "a", "b");
    const before = entityPointVersion(entity, reader([p("a", 0, 0), p("b", 10, 5)]));
    const after = entityPointVersion(entity, reader([p("a", 0, 0), p("b", 12, 5)]));

    expect(after).not.toBe(before);
  });

  it("is unchanged when a point the entity doesn't reference moves", () => {
    const entity = line("l1", "a", "b");
    const before = entityPointVersion(entity, reader([p("a", 0, 0), p("b", 10, 5), p("c", 3, 3)]));
    const after = entityPointVersion(entity, reader([p("a", 0, 0), p("b", 10, 5), p("c", 99, 99)]));

    expect(after).toBe(before);
  });

  it("tracks the radius of circles and arcs", () => {
    const circleBefore = entityPointVersion(circle("c1", "o", 5), reader([p("o", 1, 2)]));
    const circleAfter = entityPointVersion(circle("c1", "o", 6), reader([p("o", 1, 2)]));
    expect(circleAfter).not.toBe(circleBefore);

    const arcBefore = entityPointVersion(
      arc("a1", "o", "s", "e", 5),
      reader([p("o", 0, 0), p("s", 5, 0), p("e", 0, 5)]),
    );
    const arcAfter = entityPointVersion(
      arc("a1", "o", "s", "e", 6),
      reader([p("o", 0, 0), p("s", 5, 0), p("e", 0, 5)]),
    );
    expect(arcAfter).not.toBe(arcBefore);
  });

  it("distinguishes a resolved point from a missing one, stably", () => {
    const entity = line("l1", "a", "ghost");
    const present = entityPointVersion(entity, reader([p("a", 0, 0), p("ghost", 4, 4)]));
    const missing = entityPointVersion(entity, reader([p("a", 0, 0)]));
    const stillMissing = entityPointVersion(entity, reader([p("a", 0, 0)]));

    expect(missing).not.toBe(present);
    // Two consecutive renders with the point still unresolved must agree — an unstable
    // "missing" encoding would flip the key (and re-tessellate) every frame.
    expect(stillMissing).toBe(missing);
  });
});

describe("resolveEntityPolyline", () => {
  it("returns a line's two endpoints in the sketch plane (z = 0)", () => {
    const points = resolveEntityPolyline(line("l1", "a", "b"), reader([p("a", 1, 2), p("b", 10, 5)]));

    expect(points).toEqual([
      [1, 2, 0],
      [10, 5, 0],
    ]);
  });

  it("tessellates a circle into 72 segments that close back on the start point", () => {
    const centre = p("o", 3, -2);
    const points = resolveEntityPolyline(circle("c1", "o", 7), reader([centre]));

    expect(points).toHaveLength(72 + 1);
    // First point sits at angle 0, i.e. radius to the +x side of the centre.
    expect(points[0]).toEqual([3 + 7, -2, 0]);
    // The tessellation is a closed loop: the extra 73rd point lands back on the start.
    expect(points[72]![0]).toBeCloseTo(3 + 7);
    expect(points[72]![1]).toBeCloseTo(-2);
    // Every sampled point sits exactly on the rim.
    for (const [x, y] of points) {
      expect(Math.hypot(x - 3, y + 2)).toBeCloseTo(7, 8);
    }
  });

  it("sweeps an arc counter-clockwise from start to end", () => {
    // start at angle 0, end at angle pi/2 — the quarter circle in the first quadrant.
    const points = resolveEntityPolyline(
      arc("a1", "o", "s", "e", 10),
      reader([p("o", 0, 0), p("s", 10, 0), p("e", 0, 10)]),
    );

    expect(points).toHaveLength(48 + 1);
    expect(points[0]).toEqual([10, 0, 0]);
    // The end sample sits at angle pi/2, where cos is trig roundoff rather than exact 0.
    expect(points[48]![0]).toBeCloseTo(0, 8);
    expect(points[48]![1]).toBeCloseTo(10, 8);
  });

  it("wraps an end angle at or behind the start angle a full turn forward", () => {
    // end angle 0 <= start angle pi/2, so the arc sweeps the long way round — through
    // 180° and 270°, not the short way back — matching `arcMidpoint`'s convention.
    const points = resolveEntityPolyline(
      arc("a1", "o", "s", "e", 10),
      reader([p("o", 0, 0), p("s", 0, 10), p("e", 10, 0)]),
    );

    expect(points).toHaveLength(48 + 1);
    // Same roundoff on the start sample (angle pi/2) and the closing one (angle 2pi).
    expect(points[0]![0]).toBeCloseTo(0, 8);
    expect(points[0]![1]).toBeCloseTo(10, 8);
    expect(points[48]![0]).toBeCloseTo(10, 8);
    expect(points[48]![1]).toBeCloseTo(0, 8);
    // Halfway through the samples the arc is at angle 5pi/4, in the third quadrant —
    // proof the sweep went forward (through 180°/270°) rather than backwards.
    expect(points[24]![0]).toBeCloseTo(-10 * Math.SQRT1_2, 4);
    expect(points[24]![1]).toBeCloseTo(-10 * Math.SQRT1_2, 4);
  });

  it("interpolates a spline through its own points as a smooth curve", () => {
    // Three collinear control points: the interpolating curve is the straight segment
    // through them, which makes the expected samples easy to assert exactly.
    const points = resolveEntityPolyline(
      spline("s1", ["a", "b", "c"]),
      reader([p("a", 0, 0), p("b", 10, 0), p("c", 20, 0)]),
    );

    // Sample count: max(24, points * 12) = 36 intervals, 37 samples.
    expect(points).toHaveLength(37);
    expect(points[0]).toEqual([0, 0, 0]);
    expect(points[36]).toEqual([20, 0, 0]);
    for (const [x, y] of points) {
      expect(y).toBeCloseTo(0, 8);
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(20 + 1e-9);
    }
  });

  it("degrades to fewer than two points when its own points are unresolved", () => {
    const pool = [p("a", 0, 0), p("o", 1, 1), p("s", 5, 0), p("e", 0, 5), p("only", 3, 3)];

    // Each of these renders as nothing in `EntityView` (its `points.length < 2` guard) —
    // a half-built entity stays invisible rather than throwing mid-tessellation.
    const halfLine: SketchEntity = line("l1", "a", "ghost");
    expect(resolveEntityPolyline(halfLine, reader(pool))).toEqual([[0, 0, 0]]);

    const centrelessCircle: SketchEntity = circle("c1", "ghost", 5);
    expect(resolveEntityPolyline(centrelessCircle, reader(pool))).toEqual([]);

    const rimlessArc: SketchEntity = arc("a1", "o", "s", "ghost", 5);
    expect(resolveEntityPolyline(rimlessArc, reader(pool))).toEqual([]);

    const lonelySpline: SketchEntity = spline("s1", ["only", "ghost"]);
    expect(resolveEntityPolyline(lonelySpline, reader(pool))).toEqual([]);
  });

  it("renders a standalone point entity as no polyline at all", () => {
    // Point entities ride the same pipeline as curves; a single resolved point falls
    // through to the spline branch's two-point minimum, so they stay invisible here and
    // are drawn by the point-dot layer instead — the same fall-through the inline
    // `EntityView` code had before the pipeline was extracted.
    const entity: SketchEntity = { id: "pt1", kind: "point", at: "a", construction: false };
    expect(resolveEntityPolyline(entity, reader([p("a", 4, -6)]))).toEqual([]);
  });
});

describe("large-sketch memoisation at scale", () => {
  // The scale the item targeted: 240 curve entities over a 600-point pool, dragged one
  // point per frame the way `dragPoint`'s immutable edit rewrites the sketch. Assertions
  // here are *call counts and object identities*, never timings — the measurement belongs
  // to the change log, and a count cannot flake on a slow CI machine.

  const FRAMES = 240;

  /** Runs the keyed pass over a simulated drag and reports what it did, frame by frame. */
  function runKeyedDrag() {
    const { sketch, draggedCircleId, draggedPointId } = largeSketchFixture();

    // One immutable sketch object per frame, exactly the shape the store hands the
    // renderer on every pointer-move: a fresh points array (fresh reader, as
    // `SketchGeometry` rebuilds one per points identity) with one moved point, entities
    // untouched by reference.
    const frames: Sketch[] = [];
    for (let frame = 0; frame < FRAMES; frame++) {
      frames.push({
        ...sketch,
        points: sketch.points.map((point) =>
          point.id === draggedPointId ? { ...point, x: 10 + frame * 0.1, y: 10 + (frame % 20) } : point,
        ),
      });
    }

    const versions = new Map<string, string>();
    const polylines = new Map<string, [number, number, number][]>();
    const rebuildsPerFrame: number[] = [];
    let firstFramePolylines: Map<string, [number, number, number][]> | null = null;
    for (const frameSketch of frames) {
      const pointsById = new Map(frameSketch.points.map((point) => [point.id, point]));
      const readPoint: PointReader = (id) => pointsById.get(id);
      let rebuilt = 0;
      for (const entity of frameSketch.entities) {
        if (entity.kind === "point") continue; // no polyline at all
        const version = entityPointVersion(entity, readPoint);
        if (versions.get(entity.id) !== version) {
          polylines.set(entity.id, resolveEntityPolyline(entity, readPoint));
          rebuilt += 1;
        }
        versions.set(entity.id, version);
      }
      rebuildsPerFrame.push(rebuilt);
      if (firstFramePolylines === null) firstFramePolylines = new Map(polylines);
    }

    return { frames, draggedCircleId, rebuildsPerFrame, polylines, firstFramePolylines };
  }

  it("builds the fixture deterministically at the advertised scale", () => {
    const { sketch } = largeSketchFixture();
    const again = largeSketchFixture().sketch;

    expect(sketch.points).toHaveLength(600);
    const kinds = sketch.entities.map((entity) => entity.kind);
    expect(kinds.filter((kind) => kind === "circle")).toHaveLength(80);
    expect(kinds.filter((kind) => kind === "line")).toHaveLength(80);
    expect(kinds.filter((kind) => kind === "arc")).toHaveLength(40);
    expect(kinds.filter((kind) => kind === "spline")).toHaveLength(40);
    expect(kinds.filter((kind) => kind === "point")).toHaveLength(80);
    // Same build twice must agree exactly — a drifting fixture would turn every other
    // assertion in this file into a moving target.
    expect(again).toEqual(sketch);
  });

  it("re-tessellates exactly the dragged circle per frame — 239 of 240 skip entirely", () => {
    const { rebuildsPerFrame, polylines, draggedCircleId } = runKeyedDrag();

    // Frame 0 populates the key map, so everything tessellates once. Every steady frame
    // after that: exactly one rebuild — the circle whose own centre point moved. The
    // naive `useMemo([entity, sketch])` this replaces would tessellate 240 entities on
    // every one of the 240 frames: 57,600 calls, versus 240 + 239 here.
    expect(rebuildsPerFrame[0]).toBe(240);
    for (let frame = 1; frame < FRAMES; frame++) {
      expect(rebuildsPerFrame[frame]).toBe(1);
    }
    expect(rebuildsPerFrame.reduce((sum, count) => sum + count, 0)).toBe(240 + (FRAMES - 1));
    // And the one that rebuilt is the dragged circle itself, not an arbitrary entity.
    expect(polylines.get(draggedCircleId)).toBeDefined();
  });

  it("keeps every untouched entity's polyline by reference, exactly as useMemo would", () => {
    const { frames, polylines, firstFramePolylines, draggedCircleId } = runKeyedDrag();

    // A naive tessellation produces a fresh array per entity per frame; the keyed memo
    // must hand drei's `<Line>` the *same* array reference across frames for untouched
    // entities (that reference equality is what skips the GPU-side line rebuild), and a
    // new reference for the one entity that legitimately changed.
    expect(polylines.get("large-line-0")).toBe(firstFramePolylines!.get("large-line-0"));
    expect(polylines.get("large-arc-0")).toBe(firstFramePolylines!.get("large-arc-0"));
    expect(polylines.get("large-spline-0")).toBe(firstFramePolylines!.get("large-spline-0"));

    expect(polylines.get(draggedCircleId)).not.toBe(firstFramePolylines!.get(draggedCircleId));
    // The polyline actually followed the drag, not just changed identity.
    expect(polylines.get(draggedCircleId)![0]![0]).toBeGreaterThan(firstFramePolylines!.get(draggedCircleId)![0]![0]);

    // Sanity on the frame objects themselves: the store pattern this simulates reuses
    // entity references across frames, which is what makes `memo(EntityView)` cheap to
    // satisfy in the first place.
    expect(frames[1]!.entities[0]).toBe(frames[0]!.entities[0]);
  });
});
