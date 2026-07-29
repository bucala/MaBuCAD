import { pointById } from "@/sketch/sketchModel";
import type { LineEntity, Sketch, SketchPoint } from "@/sketch/types";

export interface Loop {
  /** Ordered points around the loop, first point not repeated at the end. */
  points: { x: number; y: number }[];
  /** Signed area; the sign gives the winding direction. */
  signedArea: number;
}

/**
 * Extracts the closed loops of a sketch as ordered point rings.
 *
 * A profile is stored as unordered lines sharing endpoints, but extruding needs each loop
 * walked in order. Because coincident points are the *same* point rather than two points
 * tied by a constraint, walking is a plain graph traversal with no tolerance guessing.
 */
export function extractLoops(sketch: Sketch): Loop[] {
  const lines = sketch.entities.filter(
    (entity): entity is LineEntity => entity.kind === "line" && !entity.construction,
  );

  // pointId -> line ids touching it
  const incident = new Map<string, string[]>();
  for (const line of lines) {
    for (const pointId of [line.start, line.end]) {
      const list = incident.get(pointId);
      if (list) list.push(line.id);
      else incident.set(pointId, [line.id]);
    }
  }

  const lineById = new Map(lines.map((line) => [line.id, line]));
  const visited = new Set<string>();
  const loops: Loop[] = [];

  for (const seed of lines) {
    if (visited.has(seed.id)) continue;

    const ring: SketchPoint[] = [];
    let currentLine: LineEntity | undefined = seed;
    let currentPoint = seed.start;

    while (currentLine && !visited.has(currentLine.id)) {
      visited.add(currentLine.id);

      const startPoint = pointById(sketch, currentPoint);
      if (!startPoint) break;
      ring.push(startPoint);

      const activeLineId: string = currentLine.id;
      const nextPointId: string =
        currentLine.start === currentPoint ? currentLine.end : currentLine.start;

      // Step to the other unvisited line at this vertex. A vertex shared by more than two
      // lines is ambiguous, so the first unvisited one wins — enough for the profiles the
      // sketcher can currently produce.
      const candidates: string[] = incident.get(nextPointId) ?? [];
      const nextLineId: string | undefined = candidates.find(
        (id: string) => id !== activeLineId && !visited.has(id),
      );

      currentPoint = nextPointId;
      currentLine = nextLineId ? lineById.get(nextLineId) : undefined;
    }

    // A ring only counts as a loop when the walk returned to where it began.
    const closesBack =
      ring.length >= 3 && (incident.get(currentPoint) ?? []).includes(seed.id);

    if (closesBack) {
      const points = ring.map((point) => ({ x: point.x, y: point.y }));
      loops.push({ points, signedArea: signedArea(points) });
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
