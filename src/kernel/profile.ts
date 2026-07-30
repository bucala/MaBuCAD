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

      loops.push({ points, segments, signedArea: loopSignedArea(points, segments) });
    }
  }

  return loops;
}

export interface CircleLoop {
  centre: { x: number; y: number };
  radius: number;
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

/**
 * Splits a sketch's closed regions into one outer profile and any inner ones.
 *
 * The largest region becomes the body and the rest become holes, which is the convention
 * every mainstream modeller uses for a single-sketch extrude.
 */
export function profileRegions(sketch: Sketch): ProfileRegions | null {
  const regions: (Loop | CircleLoop)[] = [...extractLoops(sketch), ...extractCircles(sketch)];
  if (regions.length === 0) return null;

  const sorted = [...regions].sort((a, b) => areaOf(b) - areaOf(a));
  return { outer: sorted[0], inner: sorted.slice(1) };
}
