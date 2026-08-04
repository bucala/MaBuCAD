import { measureArea, measureDistanceBetween, measureLength, measureShapeVolumeProperties } from "replicad";
import type { AnyShape, Edge, Face, Shape3D } from "replicad";

import { getCurrentShape, type Solid } from "./rebuild";

/** Which kind of kernel sub-shape a viewport pick resolved to — the two entity kinds
 * `SolidModel.tsx` can already resolve a raycaster hit against (see `FaceGroup`/
 * `EdgeGroup` in `rebuild.ts`). */
export type MeasureEntityKind = "face" | "edge";

export interface MeasurePick {
  kind: MeasureEntityKind;
  /** `FaceGroup.id`/`EdgeGroup.id` — a sequential index into `getCurrentShape()!.faces`/
   * `.edges`, valid only for the mesh it was picked from (see those types' own doc
   * comments in `rebuild.ts`). */
  id: number;
}

export interface PickMeasurement extends MeasurePick {
  /** Area (mm²) for a face, length (mm) for an edge. */
  value: number;
}

export interface MeasureSummary {
  picks: PickMeasurement[];
  /** Straight-line distance (mm) between the two picks, or `null` with fewer than two. */
  distance: number | null;
}

/** Resolves a single pick against the given shape's own `faces`/`edges` arrays — split out
 * so the "which array, which measure function" branch on `pick.kind` only has to be
 * written once, here. */
function resolveSubShape(shape: Solid, pick: MeasurePick): Face | Edge | null {
  return pick.kind === "face" ? (shape.faces[pick.id] ?? null) : (shape.edges[pick.id] ?? null);
}

/**
 * Measures whatever is currently picked in Inspect > Measure: each pick's own area or
 * length, plus the distance between the two once there are exactly two. Resolves every
 * pick against `getCurrentShape()` — the kernel's own last-built body — so the numbers
 * are exact, not derived from the triangulated mesh. Returns `null` if there is no
 * current body, or a pick's id no longer exists on it (a stale pick left over from
 * before a rebuild changed the body's topology).
 */
export function computeMeasureSummary(picks: MeasurePick[]): MeasureSummary | null {
  const shape = getCurrentShape();
  if (!shape) return null;

  const subShapes: (Face | Edge)[] = [];
  for (const pick of picks) {
    const subShape = resolveSubShape(shape, pick);
    if (!subShape) return null;
    subShapes.push(subShape);
  }

  // `pick.kind` and `subShapes[index]`'s actual class are kept in lockstep by
  // `resolveSubShape` above, so the cast on each branch below is just telling TypeScript
  // what that invariant already guarantees.
  const picksResult: PickMeasurement[] = picks.map((pick, index) => ({
    ...pick,
    value:
      pick.kind === "face"
        ? measureArea(subShapes[index] as Face)
        : measureLength(subShapes[index] as AnyShape),
  }));

  const distance =
    subShapes.length === 2
      ? measureDistanceBetween(subShapes[0] as AnyShape, subShapes[1] as AnyShape)
      : null;

  return { picks: picksResult, distance };
}

export interface MassProperties {
  volume: number;
  area: number;
  centerOfMass: [number, number, number];
}

/**
 * Volume, surface area and centre of mass of the whole current body, straight from the
 * kernel's own B-Rep via `measureShapeVolumeProperties`/`measureArea` — exact, not
 * approximated from the triangulated mesh. `null` when there is no solid body yet.
 */
export function computeMassProperties(): MassProperties | null {
  const shape = getCurrentShape();
  if (!shape) return null;

  // `getCurrentShape()`'s own return type is wider than what it actually ever holds —
  // `rebuildDocument()` only ever stores a genuine boolean-operation-built solid (see its
  // own comment on `currentShape`) — the same "the declared type undersells the runtime
  // guarantee" gap `kernel/io.ts`'s STEP/STL export already casts through for the same
  // reason.
  const volumeShape = shape as unknown as Shape3D;
  const volumeProperties = measureShapeVolumeProperties(volumeShape);
  return {
    volume: volumeProperties.volume,
    area: measureArea(volumeShape),
    centerOfMass: volumeProperties.centerOfMass,
  };
}
