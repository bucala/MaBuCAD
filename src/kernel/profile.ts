import { arcMidpoint, pointById } from "@/sketch/sketchModel";
import type { ArcEntity, LineEntity, Sketch, SketchPoint } from "@/sketch/types";

/** One edge of a walked loop, exact enough for the kernel to draw it. */
export type LoopSegment =
  | { kind: "line"; to: { x: number; y: number } }
  | { kind: "arc"; to: { x: number; y: number }; mid: { x: number; y: number } };

export interface Loop {
  /** Ordered points around the loop, first point not repeated at the end. */
  points: { x: number; y: number }[];
  /** The edge from `points[i]` to `points[(i + 1) % points.length]`, same length as `points`. */
  segments: LoopSegment[];
  /** Signed area; the sign gives the winding direction. */
  signedArea: number;
  /** The sketch entity id each segment in `segments` was walked from, same length/order —
   * lets a caller (`profileRegions`'s optional filter) tell which loop a given entity
   * belongs to without re-walking the sketch. */
  entityIds: string[];
}

type EdgeEntity = LineEntity | ArcEntity;

/**
 * Extracts the closed loops of a sketch as ordered point rings.
 *
 * A profile is stored as unordered lines and arcs sharing endpoints, but extruding needs
 * each loop walked in order. Because coincident points are the *same* point rather than
 * two points tied by a constraint, walking is a plain graph traversal with no tolerance
 * guessing. Lines and arcs are walked uniformly — both have a plain `start`/`end` — and
 * only the final `segments` step distinguishes them, since that's the only place the
 * distinction (straight vs. curved) actually matters.
 */
export function extractLoops(sketch: Sketch): Loop[] {
  const edges = sketch.entities.filter(
    (entity): entity is EdgeEntity =>
      (entity.kind === "line" || entity.kind === "arc") && !entity.construction,
  );

  // pointId -> edge ids touching it
  const incident = new Map<string, string[]>();
  for (const edge of edges) {
    for (const pointId of [edge.start, edge.end]) {
      const list = incident.get(pointId);
      if (list) list.push(edge.id);
      else incident.set(pointId, [edge.id]);
    }
  }

  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const visited = new Set<string>();
  const loops: Loop[] = [];

  for (const seed of edges) {
    if (visited.has(seed.id)) continue;

    const ring: SketchPoint[] = [];
    const ringEdges: EdgeEntity[] = [];
    let currentEdge: EdgeEntity | undefined = seed;
    let currentPoint = seed.start;

    while (currentEdge && !visited.has(currentEdge.id)) {
      visited.add(currentEdge.id);

      const startPoint = pointById(sketch, currentPoint);
      if (!startPoint) break;
      ring.push(startPoint);
      ringEdges.push(currentEdge);

      const activeEdgeId: string = currentEdge.id;
      const nextPointId: string =
        currentEdge.start === currentPoint ? currentEdge.end : currentEdge.start;

      // Step to the other unvisited edge at this vertex. A vertex shared by more than two
      // edges is ambiguous, so the first unvisited one wins — enough for the profiles the
      // sketcher can currently produce.
      const candidates: string[] = incident.get(nextPointId) ?? [];
      const nextEdgeId: string | undefined = candidates.find(
        (id: string) => id !== activeEdgeId && !visited.has(id),
      );

      currentPoint = nextPointId;
      currentEdge = nextEdgeId ? edgeById.get(nextEdgeId) : undefined;
    }

    // A ring only counts as a loop when the walk returned to where it began. Two edges is
    // enough once arcs are involved (a line and an arc sharing both endpoints, say), unlike
    // a lines-only loop where two straight segments could only ever retrace each other.
    const closesBack =
      ring.length >= 2 && (incident.get(currentPoint) ?? []).includes(seed.id);

    if (closesBack) {
      const points = ring.map((point) => ({ x: point.x, y: point.y }));
      const segments = ringEdges.map((edge, index): LoopSegment => {
        const to = points[(index + 1) % points.length];
        if (edge.kind === "line") return { kind: "line", to };

        const centre = pointById(sketch, edge.center);
        const start = pointById(sketch, edge.start);
        const end = pointById(sketch, edge.end);
        if (!centre || !start || !end) return { kind: "line", to };

        // The walk may have arrived at this arc from either endpoint; the midpoint is
        // computed from the arc's own fixed start->end sweep regardless of which way the
        // ring is being traversed, since the same curve is correct either direction.
        const mid = arcMidpoint(centre, start, end, edge.radius);
        return { kind: "arc", to, mid };
      });

      loops.push({
        points,
        segments,
        signedArea: loopSignedArea(points, segments),
        entityIds: ringEdges.map((edge) => edge.id),
      });
    }
  }

  return loops;
}

export interface CircleLoop {
  centre: { x: number; y: number };
  radius: number;
  /** The circle entity this loop came from — see `Loop.entityIds`'s own note. */
  entityId: string;
}

/** Circles are already closed profiles and need no walking. */
export function extractCircles(sketch: Sketch): CircleLoop[] {
  return sketch.entities
    .filter((entity) => entity.kind === "circle" && !entity.construction)
    .map((entity) => {
      const circle = entity as Extract<typeof entity, { kind: "circle" }>;
      const centre = pointById(sketch, circle.center);
      return {
        centre: { x: centre?.x ?? 0, y: centre?.y ?? 0 },
        radius: circle.radius,
        entityId: circle.id,
      };
    });
}

export function signedArea(points: { x: number; y: number }[]): number {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    total += current.x * next.y - next.x * current.y;
  }
  return total / 2;
}

/** Shoelace contribution of two consecutive points, halved at the end by the caller. */
const shoelaceTerm = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x * b.y - b.x * a.y;

/**
 * Signed area of a loop's exact boundary, not just the straight-edged polygon through its
 * vertices — an arc's bulge can otherwise be significant enough to rank a region's size
 * wrongly (whether it is the outer boss or an inner hole). Each arc edge contributes its
 * own midpoint as one extra shoelace sample, splitting that edge into two straight
 * sub-edges through it; every other edge is exact already.
 */
function loopSignedArea(points: { x: number; y: number }[], segments: LoopSegment[]): number {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const segment = segments[index];

    if (segment.kind === "arc") {
      total += shoelaceTerm(current, segment.mid) + shoelaceTerm(segment.mid, segment.to);
    } else {
      total += shoelaceTerm(current, segment.to);
    }
  }
  return total / 2;
}

export interface ProfileRegions {
  /** The loop enclosing the greatest area, extruded as the solid body. */
  outer: Loop | CircleLoop;
  /** Loops inside the outer one, cut from the body as through holes. */
  inner: (Loop | CircleLoop)[];
}

const areaOf = (region: Loop | CircleLoop): number =>
  "radius" in region ? Math.PI * region.radius ** 2 : Math.abs(region.signedArea);

/** Entity ids a region (loop or circle) was built from — the `profileEntityIds` filter's
 * own unit, and what a "Profile Regions" picker UI groups its checkboxes by. */
export const regionEntityIds = (region: Loop | CircleLoop): string[] =>
  "radius" in region ? [region.entityId] : region.entityIds;

/** A representative point for containment testing — a circle's own centre, or a polygon
 * loop's centroid. Not exact for a very concave loop, but every sketch profile this app can
 * actually produce (walked entirely from lines/arcs sharing endpoints) is well-behaved
 * enough that this reads correctly in practice. */
function representativePoint(region: Loop | CircleLoop): { x: number; y: number } {
  if ("radius" in region) return region.centre;
  const sum = region.points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / region.points.length, y: sum.y / region.points.length };
}

/** Ray-casting point-in-polygon test against a loop's own vertices — an arc's own bulge is
 * ignored here (unlike `loopSignedArea`'s exact treatment), a deliberate approximation: this
 * only ever decides *which* region a hole belongs to, not a solid's real geometry, so the
 * kernel's own exact boolean cut is what actually has to be right, not this test. */
function pointInLoop(point: { x: number; y: number }, loop: Loop): boolean {
  let inside = false;
  for (let i = 0, j = loop.points.length - 1; i < loop.points.length; j = i, i += 1) {
    const a = loop.points[i];
    const b = loop.points[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (!crosses) continue;
    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

function pointInRegion(point: { x: number; y: number }, region: Loop | CircleLoop): boolean {
  if ("radius" in region) {
    return Math.hypot(point.x - region.centre.x, point.y - region.centre.y) <= region.radius;
  }
  return pointInLoop(point, region);
}

/**
 * Groups a sketch's closed regions into one or more independent bodies, each with its own
 * outer profile and whatever regions nest directly inside it as holes — unlike a single
 * `{outer, inner[]}` picking just the largest region as "the" body and silently treating
 * every other region as a hole regardless of where it actually sits, which only produces
 * the right result when a sketch has one outer contour with holes in it. A sketch with two
 * *disjoint* contours (two separate bosses from one Extrude) needs two separate groups, or
 * the smaller one becomes a no-op "hole" that doesn't overlap the body it was subtracted
 * from and simply vanishes.
 *
 * Nesting is resolved by each region's own immediate parent — the smallest other region
 * whose boundary contains its representative point — so a region with no parent starts its
 * own group, and a region with one becomes that parent's hole. Only one level deep: a hole
 * inside a hole inside a body (alternating solid/void) is a real but rare case no mainstream
 * modeller's single-sketch Extrude handles either, so it is treated as an (own, holeless)
 * body of its own here rather than guessed at.
 *
 * `entityFilter`, when given, restricts this to only the regions that own at least one of
 * those entity ids — how Extrude/Revolve build from a user-picked subset of a multi-contour
 * sketch (`Feature.parameters.profileEntityIds`) instead of always taking every closed
 * region the sketch has. Omitted (the default), every region is eligible, the existing
 * whole-sketch behaviour.
 */
export function profileRegionGroups(sketch: Sketch, entityFilter?: ReadonlySet<string>): ProfileRegions[] {
  const all: (Loop | CircleLoop)[] = [...extractLoops(sketch), ...extractCircles(sketch)];
  const regions = entityFilter
    ? all.filter((region) => regionEntityIds(region).some((id) => entityFilter.has(id)))
    : all;
  if (regions.length === 0) return [];

  const points = regions.map(representativePoint);
  const parents: (Loop | CircleLoop | null)[] = regions.map((region, index) => {
    let parent: Loop | CircleLoop | null = null;
    let parentArea = Infinity;
    for (let other = 0; other < regions.length; other += 1) {
      if (other === index) continue;
      const candidate = regions[other];
      const candidateArea = areaOf(candidate);
      if (candidateArea <= areaOf(region) || candidateArea >= parentArea) continue;
      if (pointInRegion(points[index], candidate)) {
        parent = candidate;
        parentArea = candidateArea;
      }
    }
    return parent;
  });

  const groups: ProfileRegions[] = [];
  regions.forEach((region, index) => {
    if (parents[index] !== null) return; // it's a hole, collected below by its parent
    const inner = regions.filter((_, holeIndex) => parents[holeIndex] === region);
    groups.push({ outer: region, inner });
  });

  return groups;
}

/**
 * Splits a sketch's closed regions into one outer profile and any inner ones.
 *
 * The largest region becomes the body and the rest become holes — correct for a sketch with
 * one outer contour and holes in it, but not for one with several *disjoint* contours; see
 * `profileRegionGroups`'s own doc comment for that case, which every caller here should
 * prefer for a single-sketch profile. Kept only for Sweep and Loft, which do not yet build
 * more than one body per sketch either way.
 */
export function profileRegions(sketch: Sketch, entityFilter?: ReadonlySet<string>): ProfileRegions | null {
  const all: (Loop | CircleLoop)[] = [...extractLoops(sketch), ...extractCircles(sketch)];
  const regions = entityFilter
    ? all.filter((region) => regionEntityIds(region).some((id) => entityFilter.has(id)))
    : all;
  if (regions.length === 0) return null;

  const sorted = [...regions].sort((a, b) => areaOf(b) - areaOf(a));
  return { outer: sorted[0], inner: sorted.slice(1) };
}
