import { draw, drawCircle, drawPointsInterpolation, EdgeFinder, FaceFinder, genericSweep, Plane, Vector } from "replicad";
import type { AnyShape, Edge } from "replicad";
import { Vector3 } from "three";

import { planeBasis, sketchToWorld } from "@/sketch/planeBasis";
import { pointById } from "@/sketch/sketchModel";
import type { LineEntity, PointEntity, Sketch, SplineEntity } from "@/sketch/types";
import type { EndCondition, Feature } from "@/types/document";

import { getImportedShape } from "./importedShapes";
import { initKernel } from "./occ";
import { profileRegionGroups, profileRegions, type CircleLoop, type Loop } from "./profile";
import {
  MAX_CHECKPOINTS,
  longestReusablePrefix,
  planCheckpointEviction,
  prefixKeys,
  type BooleanOperation,
  type RebuildCheckpoint,
} from "./rebuildCache";

/**
 * One kernel Face's triangle range within `MeshData.indices`, in index-buffer units (i.e.
 * both are already ×3 from a triangle count — `indices.slice(start, start + count)` is
 * exactly this face's own triangles). `id` is a small sequential number assigned in
 * `shape.faces` order during this rebuild — stable for the lifetime of one mesh, but not
 * across rebuilds (a parameter tweak can add, remove or reorder faces), which is why
 * consumers (`SolidModel.tsx`) key any selection off the mesh reference too, not just the
 * id alone.
 */
export interface FaceGroup {
  start: number;
  count: number;
  id: number;
}

/** One kernel Edge's own slice of `MeshData.edges`, in vertex-pair units (i.e.
 * `edges.subarray(start * 3, (start + count) * 3)` is exactly this edge's own line-segment
 * positions) — the edge counterpart of `FaceGroup`, letting a Fillet/Chamfer's picked-edge
 * highlight draw the actual clicked edge's own curve instead of a marker dropped at the
 * click point (see `SolidModel.tsx`'s `pickedEdgeHighlights`). */
export interface EdgeGroup {
  start: number;
  count: number;
  id: number;
}

/** Triangulated result handed to three.js. */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Flattened line segment pairs for the edge overlay. */
  edges: Float32Array;
  /** Rotation that maps the sketch plane's local space into world space. */
  rotation: [number, number, number];
  /**
   * Per-face triangle ranges, straight from replicad's own `Shape.mesh()` — it already
   * triangulates face by face and reports exactly this (`faceGroups`, keyed by
   * `face.hashCode` upstream); this only re-keys each group by a friendlier sequential
   * index instead of the raw OpenCascade hash. This is the real per-face identity a
   * selection-priority filter needs — see `SolidModel.tsx`'s `handleFaceSelectClick` for
   * how a raycaster hit's `event.faceIndex` (a three.js triangle number, not a kernel
   * concept) is mapped back to one of these groups.
   */
  faceGroups: FaceGroup[];
  /** Per-edge slices of `edges` — see `EdgeGroup`'s own doc comment. */
  edgeGroups: EdgeGroup[];
}

export interface RebuildResult {
  mesh: MeshData | null;
  /** Feature id -> message, for the error badges in the tree. */
  errors: Record<string, string>;
}

/** Anything replicad hands back that can be extruded, cut and meshed. */
export type Solid = ReturnType<ReturnType<typeof drawCircle>["sketchOnPlane"]>["extrude"] extends (
  ...args: never[]
) => infer R
  ? R
  : never;

/**
 * The solid produced by the last successful rebuild, kept so export can hand the kernel's
 * own B-Rep to STEP rather than re-deriving it from the triangulated mesh.
 *
 * While this reference holds it, no collector can reclaim the shape (replicad's
 * FinalizationRegistry only deletes a shape once its wrapper is unreachable) — but
 * releasing the previous final is no longer this variable's job: the checkpoint
 * chain below owns every kernel object it has ever recorded, and `planCheckpointEviction`
 * releases the old final exactly when no kept checkpoint still references it (see
 * `rebuildCache.ts`). Assigning here is therefore all that is left to do.
 */
let currentShape: Solid | null = null;

export function getCurrentShape(): Solid | null {
  return currentShape;
}

function replaceCurrentShape(next: Solid | null): void {
  currentShape = next;
}

/**
 * The prefix cache: one checkpoint per evaluated feature of the history this process last
 * rebuilt, `checkpoints[i]` holding the replay state after feature `i` under that
 * prefix's content key. The next rebuild resumes from the longest matching key prefix
 * instead of replaying features whose outcome is already proven identical — see
 * `rebuildCache.ts` for the design and the aliasing rules that govern release.
 *
 * A single chain serves the active editing session; switching documents (or tabs, which
 * reload the document) changes feature content at index 0, misses every key, and drops
 * the whole chain, which is the correct conservative behaviour for a cache that must
 * never outlive the content it proves.
 */
let checkpoints: RebuildCheckpoint<Solid>[] = [];

/** Where the most recent rebuild resumed from — zero means a full replay. Written every
 * rebuild; read only by the test introspection hook below. */
let lastReplayedFrom = 0;

/** Test-only: drops the prefix cache so a spec can measure a cold replay against a warm
 * one, without releasing the dropped shapes (a spec process is short-lived, and the
 * release path is exercised for real by every rebuild). Never called by the app. */
export function __clearRebuildCacheForTesting(): void {
  checkpoints = [];
}

/** Test-only: how many checkpoints are held and where the last rebuild resumed from, so
 * the correctness spec can assert the cache actually shortened a replay. Never called by
 * the app. */
export function __rebuildCacheDiagnosticsForTesting(): { entries: number; replayedFrom: number } {
  return { entries: checkpoints.length, replayedFrom: lastReplayedFrom };
}

/** Builds a replicad drawing for one closed region of a sketch. */
function drawRegion(region: Loop | CircleLoop) {
  if ("radius" in region) {
    return drawCircle(region.radius).translate(region.centre.x, region.centre.y);
  }

  // Every segment already draws all the way back to the loop's own start (segments and
  // points are the same length, one edge per vertex), so by the time the last one runs
  // the pen is already there — `close()` only asserts that rather than adding anything.
  let pen = draw().movePointerTo([region.points[0].x, region.points[0].y]);
  for (const segment of region.segments) {
    pen =
      segment.kind === "arc"
        ? pen.threePointsArcTo([segment.to.x, segment.to.y], [segment.mid.x, segment.mid.y])
        : pen.lineTo([segment.to.x, segment.to.y]);
  }
  return pen.close();
}

/**
 * Extrusion distances for an end condition.
 *
 * Everything is built on the sketch plane's local XY and extruded along local +Z, then the
 * whole mesh is rotated into place with the same quaternion the sketch is drawn with. That
 * avoids mapping our plane names onto the kernel's own plane conventions, where a mirrored
 * axis would silently flip a part.
 */
export function extrusionRange(
  endCondition: EndCondition,
  depth: number,
  reversed: boolean,
): { distance: number; offset: number } {
  const magnitude = Math.max(Math.abs(depth), 1e-3);
  const sign = reversed ? -1 : 1;

  switch (endCondition) {
    case "mid-plane":
      // Half the depth each side of the sketch plane.
      return { distance: magnitude, offset: -magnitude / 2 };
    case "through-all":
      // Without other bodies to terminate on, "through all" is a deliberately large blind
      // extrude in both directions.
      return { distance: magnitude * 100, offset: (-magnitude * 100) / 2 };
    case "blind":
    case "up-to-surface":
    default:
      return { distance: magnitude * sign, offset: 0 };
  }
}

interface RevolveAxis {
  origin: [number, number, number];
  direction: [number, number, number];
}

/** `profileRegions`'s optional entity filter, from `Feature.parameters.profileEntityIds` —
 * `undefined` (not an empty `Set`) when unset so `profileRegions` takes the whole sketch,
 * its own default, rather than a filter that matches nothing. */
function profileEntityFilter(feature: Feature): ReadonlySet<string> | undefined {
  const ids = feature.parameters.profileEntityIds;
  return ids && ids.length > 0 ? new Set(ids) : undefined;
}

/**
 * Finds the revolve axis for a sketch: a line explicitly marked as an axis line takes
 * priority (unambiguous even when the sketch also has an ordinary construction line doing
 * something else, e.g. a mirror axis); otherwise the first construction line's endpoints;
 * otherwise the sketch's local Y axis through the origin.
 *
 * The fallback matters more than it looks: replicad defaults an omitted revolve axis to
 * the sketch plane's own normal, which is coplanar with (not swept around by) a profile
 * drawn flat in local XY, producing a degenerate result rather than a safe no-op — so an
 * explicit in-plane axis must always be supplied.
 */
function revolveAxis(sketch: Sketch): RevolveAxis {
  const axisLine =
    sketch.entities.find(
      (entity): entity is LineEntity => entity.kind === "line" && entity.construction && !!entity.isAxis,
    ) ??
    sketch.entities.find(
      (entity): entity is LineEntity => entity.kind === "line" && entity.construction,
    );

  if (axisLine) {
    const start = pointById(sketch, axisLine.start);
    const end = pointById(sketch, axisLine.end);
    if (start && end) {
      return {
        origin: [start.x, start.y, 0],
        direction: [end.x - start.x, end.y - start.y, 0],
      };
    }
  }

  return { origin: [0, 0, 0], direction: [0, 1, 0] };
}

function buildRevolveSolid(sketch: Sketch, feature: Feature): Solid | null {
  const groups = profileRegionGroups(sketch, profileEntityFilter(feature));
  if (groups.length === 0) return null;

  const angle = feature.parameters.angle ?? 360;
  const axis = revolveAxis(sketch);

  // Each disjoint contour group (see `profileRegionGroups`'s own doc comment) revolves and
  // cuts its own holes independently, then the whole set fuses into the one body a revolve
  // feature produces — the multi-body counterpart of the single-group loop just below.
  let combined: Solid | null = null;
  for (const regions of groups) {
    let solid = drawRegion(regions.outer)
      .sketchOnPlane("XY")
      .revolve(axis.direction, { origin: axis.origin, angle }) as Solid;

    // Outer and inner regions sweep the identical axis/angle, so subtracting the swept hole
    // from the swept body is exact — unlike extrude's inner-hole handling, no offset or
    // over-length trick is needed to guarantee the cut fully passes through.
    for (const inner of regions.inner) {
      const tool = drawRegion(inner)
        .sketchOnPlane("XY")
        .revolve(axis.direction, { origin: axis.origin, angle }) as Solid;
      solid = (solid as unknown as { cut: (other: Solid) => Solid }).cut(tool);
    }

    combined = combined ? asBoolean(combined).fuse(solid) : solid;
  }

  return combined;
}

const AXIS_VECTORS: Record<"x" | "y" | "z", [number, number, number]> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

/** The plane whose normal is the given axis — what a mirror across that axis reflects through. */
const MIRROR_PLANES: Record<"x" | "y" | "z", "YZ" | "XZ" | "XY"> = {
  x: "YZ",
  y: "XZ",
  z: "XY",
};

function asTransformable(solid: Solid) {
  return solid as unknown as {
    clone: () => Solid;
    translate: (vector: [number, number, number]) => Solid;
    rotate: (angle: number, position: [number, number, number], direction: [number, number, number]) => Solid;
    mirror: (plane: "XY" | "YZ" | "XZ", origin?: [number, number, number]) => Solid;
  };
}

function asBoolean(solid: Solid) {
  return solid as unknown as { fuse: (other: Solid) => Solid; cut: (other: Solid) => Solid };
}

/**
 * Builds the union of the *additional* copies a pattern contributes — the seed instance is
 * already part of `current` from its own turn through the rebuild loop, so a pattern only
 * ever adds instances 1..count-1, transformed by `transformAt`.
 *
 * `translate`/`rotate`/`mirror` each free the shape they're called on and return a new one
 * (replicad's shapes are WASM-backed, not garbage collected), so every copy starts from its
 * own `clone()` of the source rather than reusing it directly.
 */
function buildCopies(
  source: Solid,
  count: number,
  transformAt: (index: number, copy: Solid) => Solid,
): Solid | null {
  const instances = Math.max(1, Math.round(count));
  let copies: Solid | null = null;

  for (let index = 1; index < instances; index += 1) {
    const copy = transformAt(index, asTransformable(source).clone());
    copies = copies ? asBoolean(copies).fuse(copy) : copy;
  }

  return copies;
}

function buildLinearPatternSolid(source: Solid, feature: Feature): Solid | null {
  const direction = AXIS_VECTORS[feature.parameters.axis ?? "x"];
  const spacing = feature.parameters.distance ?? 20;

  return buildCopies(source, feature.parameters.count ?? 1, (index, copy) =>
    asTransformable(copy).translate([
      direction[0] * spacing * index,
      direction[1] * spacing * index,
      direction[2] * spacing * index,
    ]),
  );
}

/**
 * Pivot a Circular Pattern rotates its copies around.
 *
 * `replicad`'s `rotate` always turns a solid about a *line* (a point plus a direction), not
 * just a direction — a circular pattern's own axis has to run through the seed feature's own
 * geometry, not through the origin, or every instance ends up displaced sideways by however
 * far the part happens to sit from world (0, 0, 0). There is no axis-picking UI yet (the
 * pattern only offers a world-aligned X/Y/Z direction), so this instead defaults the pivot
 * to the seed solid's own bounding-box centre — correct for the common case of patterning a
 * feature that is itself rotationally arranged around its own middle (a bolt circle of
 * holes, a ring of ribs), and exactly what "honour the feature's own orientation" means here
 * absent an explicit axis to honour instead.
 */
function circularPatternPivot(source: Solid): [number, number, number] {
  return source.boundingBox.center;
}

function buildCircularPatternSolid(source: Solid, feature: Feature): Solid | null {
  const direction = AXIS_VECTORS[feature.parameters.axis ?? "z"];
  const count = Math.max(1, Math.round(feature.parameters.count ?? 1));
  const step = (feature.parameters.angle ?? 360) / count;
  const pivot = circularPatternPivot(source);

  return buildCopies(source, count, (index, copy) =>
    asTransformable(copy).rotate(step * index, pivot, direction),
  );
}

function buildMirrorSolid(source: Solid, feature: Feature): Solid {
  const plane = MIRROR_PLANES[feature.parameters.axis ?? "x"];
  return asTransformable(asTransformable(source).clone()).mirror(plane, [0, 0, 0]);
}

/**
 * How close (mm) a picked point needs to land to an edge, in the *rebuilt* solid, for that
 * edge to count as "the one picked". Generous enough to absorb the small differences between
 * where the point was picked (against one triangulation of the body) and the freshly
 * rebuilt body's own re-triangulated edges, without being so loose it starts picking up
 * neighbouring edges on a typical small-part scale (`DOCUMENT_SCALE` is 100 mm).
 */
const EDGE_PICK_TOLERANCE = 0.75;

/** How many points along each candidate edge `nearestEdgeTo` samples — fine enough that
 * two edges meeting at a shared vertex (where a coarse start/mid/end sample would tie,
 * since both edges' nearest *sample* is that same shared point) still resolve correctly:
 * at `EDGE_PICK_TOLERANCE` (0.75mm), a pick landing within a fraction of a mm of one edge
 * but merely near the other's endpoint needs a sample spacing well under that margin. On a
 * typical small-part edge length this keeps sample spacing comfortably under 0.1mm. */
const EDGE_SAMPLE_COUNT = 32;

/**
 * Among the real edges on the rebuilt solid within `EDGE_PICK_TOLERANCE` of `point`, the
 * one actually nearest it — approximated by sampling `EDGE_SAMPLE_COUNT` points along each
 * candidate's own parametric curve (replicad's `Edge` exposes no direct "closest point to
 * an external point" query), which is what disambiguates the short, closely-spaced edges a
 * corner or tight-bevel pick tends to land near (exactly the geometry a radius-only match
 * confuses — see `pickedEdgeFilter`'s own doc comment). `null` when nothing is within
 * tolerance at all (a stale pick from before a rebuild changed the body's topology).
 */
export function nearestEdgeTo(solid: Solid, point: [number, number, number]): Edge | null {
  const candidates = new EdgeFinder().withinDistance(EDGE_PICK_TOLERANCE, point).find(solid as unknown as AnyShape);
  if (candidates.length === 0) return null;

  const target = new Vector(point);
  let best: Edge | null = null;
  let bestDistance = Infinity;
  for (const edge of candidates) {
    for (let step = 0; step <= EDGE_SAMPLE_COUNT; step += 1) {
      const sample = edge.pointAt(step / EDGE_SAMPLE_COUNT);
      const distance = sample.sub(target).Length;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = edge;
      }
    }
  }
  return best;
}

/**
 * Builds an edge filter from picked points — resolves each picked point to the single
 * nearest real edge on the rebuilt solid, not every edge within `EDGE_PICK_TOLERANCE` of
 * it. A plain `EdgeFinder.withinDistance` radius filter (the previous approach) keeps
 * *every* candidate inside that radius, and several short/adjacent edges routinely sit
 * within 0.75mm of a single point near a corner, a sharp bevel, or anywhere edges
 * converge tightly — so one click could resolve to two or more real edges, and the whole
 * neighbourhood got rounded/chamfered along with the one edge actually picked. Resolving
 * to the nearest candidate first (`nearestEdgeTo`), then filtering with `EdgeFinder.inList`
 * on that already-resolved set, makes exactly one real edge come out of exactly one click.
 * This is still a geometric proximity match rather than true persistent naming, which this
 * app's kernel has no way to provide — see `FeatureParameters.edgePoints`'s own note.
 * `undefined` means "every edge", replicad's own convention for a fillet/chamfer's
 * optional filter.
 */
export function pickedEdgeFilter(
  solid: Solid,
  edgePoints: [number, number, number][] | undefined,
): ((finder: EdgeFinder) => EdgeFinder) | undefined {
  if (!edgePoints || edgePoints.length === 0) return undefined;
  const resolved = edgePoints
    .map((point) => nearestEdgeTo(solid, point))
    .filter((edge): edge is Edge => edge !== null);
  if (resolved.length === 0) return undefined;
  return (finder) => finder.inList(resolved);
}

/** True only in the brief window between a Fillet/Chamfer being created and the user
 * picking their first edge — see `FeatureParameters.edgesPending`'s own doc comment. */
function isAwaitingFirstEdgePick(feature: Feature): boolean {
  return !!feature.parameters.edgesPending && (feature.parameters.edgePoints?.length ?? 0) === 0;
}

/**
 * A fillet applies to every edge of the body once edges have actually been picked/confirmed
 * (or on a pre-existing feature that was always unselective); selecting edges in the
 * viewport (`viewportStore.ts`'s `edgePickModeFeatureId`) narrows it to just those, via
 * `pickedEdgeFilter`. A freshly-created feature still waiting on its first pick
 * (`isAwaitingFirstEdgePick`) is a pure pass-through instead — no edges rounded yet.
 */
function buildFilletedSolid(solid: Solid, feature: Feature): Solid {
  if (isAwaitingFirstEdgePick(feature)) return solid;
  const radius = Math.max(feature.parameters.radius ?? 2, 0.05);
  const target = solid as unknown as { fillet: (radiusConfig: number, filter?: (f: EdgeFinder) => EdgeFinder) => Solid };
  return target.fillet(radius, pickedEdgeFilter(solid, feature.parameters.edgePoints));
}

/** A plain-number chamfer distance is symmetric; see `buildFilletedSolid`'s own note on
 * narrowing which edges it applies to via picked points, and on the pending-first-pick
 * pass-through. */
function buildChamferedSolid(solid: Solid, feature: Feature): Solid {
  if (isAwaitingFirstEdgePick(feature)) return solid;
  const distance = Math.max(feature.parameters.distance ?? 1, 0.05);
  const target = solid as unknown as {
    chamfer: (radiusConfig: number, filter?: (f: EdgeFinder) => EdgeFinder) => Solid;
  };
  return target.chamfer(distance, pickedEdgeFilter(solid, feature.parameters.edgePoints));
}

function facingDirection(axis: "x" | "y" | "z"): [number, number, number] {
  return AXIS_VECTORS[axis];
}

/**
 * Shell and Draft both need to choose which face(s) of the body they act on, and — like a
 * pattern's direction or a reference axis's placement — there is no face-picking UI yet to
 * do that with. Both stand in with the same trick: act on whichever face(s) point exactly
 * along a chosen world axis (`FaceFinder.atAngleWith(direction, 0)`). For a simple extruded
 * block that resolves to exactly the face a real pick would most often land on anyway (the
 * top of an open box, the underside of a moulded shape); a body with several faces sharing
 * that orientation gets all of them shelled/drafted together, which is the honest limit of
 * this approach without real picking.
 */
function buildShelledSolid(solid: Solid, feature: Feature): Solid {
  const thickness = Math.max(feature.parameters.thickness ?? 2, 0.1);
  const direction = facingDirection(feature.parameters.axis ?? "z");
  const target = solid as unknown as {
    shell: (thickness: number, finderFcn: (f: FaceFinder) => FaceFinder) => Solid;
  };
  return target.shell(thickness, (finder) => finder.atAngleWith(direction, 0));
}

function buildDraftedSolid(solid: Solid, feature: Feature): Solid {
  const angle = feature.parameters.angle ?? 3;
  const direction = facingDirection(feature.parameters.axis ?? "z");
  const target = solid as unknown as {
    draft: (angle: number, faceFinder: (f: FaceFinder) => FaceFinder) => Solid;
  };
  return target.draft(angle, (finder) => finder.atAngleWith(direction, 0));
}

function buildFeatureSolid(sketch: Sketch, feature: Feature): Solid | null {
  const groups = profileRegionGroups(sketch, profileEntityFilter(feature));
  if (groups.length === 0) return null;

  const { distance, offset } = extrusionRange(
    feature.parameters.endCondition ?? "blind",
    feature.parameters.depth ?? 10,
    feature.parameters.reversed ?? false,
  );

  // Each disjoint contour group (see `profileRegionGroups`'s own doc comment) extrudes and
  // cuts its own holes independently, then the whole set fuses into the one body an Extrude
  // feature produces — e.g. two separate bosses from one sketch, not one contour silently
  // "cutting" the other when they don't even overlap.
  let combined: Solid | null = null;
  for (const regions of groups) {
    let solid = drawRegion(regions.outer).sketchOnPlane("XY").extrude(distance) as Solid;

    // Inner regions become through holes rather than separate bodies.
    for (const inner of regions.inner) {
      const tool = drawRegion(inner)
        .sketchOnPlane("XY")
        .extrude(distance * 2)
        .translate([0, 0, -Math.abs(distance) / 2]) as Solid;
      solid = (solid as unknown as { cut: (other: Solid) => Solid }).cut(tool);
    }

    combined = combined ? asBoolean(combined).fuse(solid) : solid;
  }

  if (combined && offset !== 0) {
    combined = (combined as unknown as { translate: (v: [number, number, number]) => Solid }).translate([
      0,
      0,
      offset,
    ]);
  }

  return combined;
}

/**
 * Builds a rib: a thin wall extruded from the first non-construction line in the sketch,
 * thickened symmetrically by `thickness` on either side of that line, then extruded to
 * `depth`/`endCondition` the same way `buildFeatureSolid` does.
 *
 * A real Rib normally extends automatically until it meets the existing body's faces — this
 * app has no face-picking UI yet to know where those are, so this instead extrudes to an
 * explicit depth, the same as any other sketch-based feature; the user controls how far the
 * rib reaches rather than it being inferred. Only a single straight segment is supported for
 * now, not a connected chain of several — a zigzag rib is a real follow-up, not
 * fundamentally different, just needing the same multi-segment walk this doesn't have yet.
 */
function buildRibSolid(sketch: Sketch, feature: Feature): Solid | null {
  const line = sketch.entities.find(
    (entity): entity is LineEntity => entity.kind === "line" && !entity.construction,
  );
  if (!line) return null;

  const start = pointById(sketch, line.start);
  const end = pointById(sketch, line.end);
  if (!start || !end) return null;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;

  const halfThickness = Math.max(feature.parameters.thickness ?? 2, 0.05) / 2;
  const perpX = (-dy / length) * halfThickness;
  const perpY = (dx / length) * halfThickness;

  const wallProfile = draw([start.x + perpX, start.y + perpY])
    .lineTo([end.x + perpX, end.y + perpY])
    .lineTo([end.x - perpX, end.y - perpY])
    .lineTo([start.x - perpX, start.y - perpY])
    .close();

  const { distance, offset } = extrusionRange(
    feature.parameters.endCondition ?? "blind",
    feature.parameters.depth ?? 10,
    feature.parameters.reversed ?? false,
  );

  let solid = wallProfile.sketchOnPlane("XY").extrude(distance) as Solid;
  if (offset !== 0) {
    solid = (solid as unknown as { translate: (v: [number, number, number]) => Solid }).translate([0, 0, offset]);
  }

  return solid;
}

/** Standard general-purpose twist-drill point angle (included), matching Autodesk Hole
 * Wizard's own default for "Angle Drill Point" — half of this is the cone's half-angle. */
const DRILL_POINT_INCLUDED_ANGLE_DEGREES = 118;

/**
 * The extra conical tip a real twist drill leaves at the bottom of a blind hole, for
 * `drillPoint: "angle"` — purely additive (fused onto the already-built cylindrical tool),
 * so `drillPoint: "flat"` (the default, and the only option before this existed) is
 * completely unaffected. `cylinderEndZ` is the Z the plain cylindrical tool already ends
 * at; `direction` is which way it was cut (matching `extrusionRange`'s own sign
 * convention), so the cone's apex extends a little further the same way rather than back
 * into the cylinder it's attached to.
 */
function buildDrillPointCone(x: number, y: number, radius: number, cylinderEndZ: number, direction: number): Solid {
  const halfAngleRadians = (DRILL_POINT_INCLUDED_ANGLE_DEGREES / 2) * (Math.PI / 180);
  const coneHeight = radius / Math.tan(halfAngleRadians);
  const tipZ = cylinderEndZ + direction * coneHeight;

  const base = drawCircle(radius).translate(x, y).sketchOnPlane("XY", cylinderEndZ);
  // A true zero-radius loft endpoint isn't reliably supported, so the "point" is a very
  // small circle instead — small enough that the taper still reads as a sharp drill tip.
  const tip = drawCircle(Math.max(radius * 0.02, 0.01)).translate(x, y).sketchOnPlane("XY", tipZ);
  return (base as unknown as { loftWith: (other: unknown) => Solid }).loftWith(tip);
}

/**
 * A hole's optional counterbore/spotface/countersink recess, as a standalone tool fused
 * onto the main cylindrical cut — always starts at the sketch plane itself (`Z = 0`, the
 * surface the hole was placed on) and extends `direction` into the material, the same
 * side the main hole cuts toward. Counterbore and spotface are both a plain wider
 * cylinder (Inventor doesn't distinguish them geometrically either — spotface is just a
 * shallow counterbore by convention); countersink is a truncated cone widening from the
 * hole's own radius up to the seat radius, sized from the seat's included angle so the
 * taper meets the through-hole at exactly its own diameter rather than leaving a step.
 */
function buildSeatTool(
  x: number,
  y: number,
  holeRadius: number,
  seatType: "counterbore" | "spotface" | "countersink",
  seatDiameter: number,
  seatDepthOrAngle: number,
  direction: number,
): Solid {
  const seatRadius = Math.max(seatDiameter / 2, holeRadius + 0.1);

  if (seatType === "countersink") {
    const halfAngleRadians = (seatDepthOrAngle / 2) * (Math.PI / 180);
    const depth = Math.max((seatRadius - holeRadius) / Math.max(Math.tan(halfAngleRadians), 1e-3), 0.05);
    const wide = drawCircle(seatRadius).translate(x, y).sketchOnPlane("XY", 0);
    const narrow = drawCircle(holeRadius).translate(x, y).sketchOnPlane("XY", direction * depth);
    return (wide as unknown as { loftWith: (other: unknown) => Solid }).loftWith(narrow);
  }

  const depth = Math.max(seatDepthOrAngle, 0.1);
  return drawCircle(seatRadius).translate(x, y).sketchOnPlane("XY").extrude(direction * depth) as Solid;
}

/**
 * Builds the union of one cylindrical cut per point placed in the hole's sketch — a Hole
 * Wizard feature always cuts (there is no join/intersect for it), and one feature can carry
 * several holes at once the same way a real Hole Wizard places a whole pattern of them from
 * one dialog. `radius` is already resolved to its final value by the time this runs, whether
 * that came from a plain number (a simple hole) or a clearance/tap-drill lookup in
 * `data/holeStandards.ts` (see `PropertyManager.tsx`'s Hole Wizard section) — this function
 * has no notion of standards or fasteners, only a radius and an end condition, same as
 * `buildFeatureSolid` reusing `extrusionRange` below. `seatType`/`drillPoint` add optional
 * extra tools (see `buildSeatTool`/`buildDrillPointCone`), fused onto each point's own
 * cylinder before it joins the rest.
 */
function buildHoleSolid(sketch: Sketch, feature: Feature): Solid | null {
  const points = sketch.entities
    .filter((entity): entity is PointEntity => entity.kind === "point")
    .map((entity) => pointById(sketch, entity.at))
    .filter((point): point is NonNullable<typeof point> => point !== undefined);
  if (points.length === 0) return null;

  const radius = Math.max(feature.parameters.radius ?? 3, 0.05);
  const endCondition = feature.parameters.endCondition ?? "through-all";
  const reversed = feature.parameters.reversed ?? false;
  const { distance, offset } = extrusionRange(endCondition, feature.parameters.depth ?? 10, reversed);

  const seatType = feature.parameters.seatType ?? "none";
  // Which way the hole cuts, for the seat/drill-point tools' own `direction` — same sign
  // convention `extrusionRange` uses for a blind cut, kept consistent regardless of the
  // actual end condition chosen (a through-all hole's own `distance`/`offset` are centred
  // on zero, which has no single "into the material" side to reuse).
  const cutDirection = reversed ? -1 : 1;
  const addsDrillPoint = feature.parameters.drillPoint === "angle" && endCondition === "blind";

  let solid: Solid | null = null;
  for (const point of points) {
    let tool = drawCircle(radius).translate(point.x, point.y).sketchOnPlane("XY").extrude(distance) as Solid;
    if (offset !== 0) {
      tool = (tool as unknown as { translate: (v: [number, number, number]) => Solid }).translate([0, 0, offset]);
    }

    if (addsDrillPoint) {
      const cone = buildDrillPointCone(point.x, point.y, radius, offset + distance, cutDirection);
      tool = asBoolean(tool).fuse(cone);
    }

    if (seatType !== "none") {
      const seatDiameter = feature.parameters.seatDiameter ?? radius * 2 * 1.8;
      const seatDepthOrAngle = feature.parameters.seatDepthOrAngle ?? (seatType === "countersink" ? 90 : radius);
      const seat = buildSeatTool(point.x, point.y, radius, seatType, seatDiameter, seatDepthOrAngle, cutDirection);
      tool = asBoolean(tool).fuse(seat);
    }

    solid = solid ? asBoolean(solid).fuse(tool) : tool;
  }

  return solid;
}

/**
 * Builds a loft blending two or more sketches' outer profiles.
 *
 * Real lofts blend profiles positioned on different, parallel, offset planes. This app's
 * sketches only live on one of the three default planes with no position offset yet (see
 * `reference-plane`'s own "cannot be sketched on" note for why), so every sketch handed to
 * a loft is required to share the *same* plane by the caller — instead, the profiles are
 * spread out purely in that plane's local space, evenly along its normal (local +Z) over the
 * feature's own `depth`, in the order the sketches were selected. This still produces a real,
 * correct loft — just one whose section spacing is a feature parameter rather than each
 * profile's own sketched position, an honest trade rather than the real thing.
 *
 * Only the outer profile of each sketch is used; inner loops (holes) are not lofted — a hole
 * cut afterward composes better anyway, the same as every other feature that already leans on
 * boolean composition instead of doing everything in one operation.
 */
function buildLoftSolid(sketches: Sketch[], feature: Feature): Solid | null {
  const regionsList = sketches.map((sketch) => profileRegions(sketch));
  if (regionsList.some((regions) => !regions)) return null;

  const totalDepth = feature.parameters.depth ?? 20;
  const spacing = sketches.length > 1 ? totalDepth / (sketches.length - 1) : 0;

  const profileSketches = regionsList.map((regions, index) =>
    drawRegion(regions!.outer).sketchOnPlane("XY", [0, 0, spacing * index]),
  );

  const [base, ...rest] = profileSketches;
  return (base as unknown as { loftWith: (others: unknown[]) => Solid }).loftWith(rest);
}

/** Any world vector not parallel to `direction`, for building a stable perpendicular basis. */
function perpendicularTo(direction: Vector3): Vector3 {
  const helper = Math.abs(direction.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  return new Vector3().crossVectors(direction, helper).normalize();
}

/** The world-space basis a sketch's plane maps onto, as a replicad `Plane` object — origin
 * at the sketch's own origin (always [0, 0, 0]; sketches don't support a position offset
 * yet), oriented by the same quaternion `sketchToWorld` uses. */
function replicadPlaneFor(planeId: string): Plane {
  const basis = planeBasis(planeId);
  const xDir = new Vector3(1, 0, 0).applyQuaternion(basis.quaternion);
  return new Plane([0, 0, 0], [xDir.x, xDir.y, xDir.z], [basis.normal.x, basis.normal.y, basis.normal.z]);
}

/**
 * Resolves the sweep path from `pathSketch`: a spline's points if it has one (a curved path —
 * springs, handles, pipes with bends), otherwise a construction line's two endpoints (a
 * straight path, the same "first construction entity" convention `revolveAxis` already uses
 * for a revolve's axis). A spline doesn't need to be a *construction* spline the way the
 * line does — `profileRegions()` never uses splines for a boss/cut profile either way (its
 * closed-loop walk only looks at line/arc edges), so there is no ordinary, non-path meaning
 * for a spline to be "taken" from, unlike a line, which the same sketch could otherwise mean
 * as a real profile edge.
 */
function sweepPathPoints(pathSketch: Sketch): { x: number; y: number }[] | null {
  const spline = pathSketch.entities.find((entity): entity is SplineEntity => entity.kind === "spline");
  if (spline) {
    const points = spline.points
      .map((id) => pointById(pathSketch, id))
      .filter((point): point is NonNullable<typeof point> => point !== undefined);
    return points.length >= 2 ? points : null;
  }

  const axisLine = pathSketch.entities.find(
    (entity): entity is LineEntity => entity.kind === "line" && entity.construction,
  );
  if (!axisLine) return null;

  const start = pointById(pathSketch, axisLine.start);
  const end = pointById(pathSketch, axisLine.end);
  return start && end ? [start, end] : null;
}

/**
 * Builds a sweep: `profileSketch`'s outer profile, extruded along the path defined by
 * `pathSketch`'s first construction line or spline.
 *
 * Unlike every other sketch-based feature here, this does not build everything in one
 * sketch's own local-XY space and rotate the result for display afterward — a sweep whose
 * path leaves the profile's own plane is the entire point of the feature (an extrude already
 * covers "sweep along the profile plane's own normal"). The path is embedded via the path
 * sketch's own true plane (`replicadPlaneFor`, matching `sketchToWorld`'s own convention) —
 * a straight line for two points, an interpolated spline for three or more. The profile sits
 * on its own explicit `Plane`, perpendicular to the path's start tangent (the plane's normal
 * *is* the sweep direction, the standard convention a pipe/sweep needs) — approximated as the
 * direction from the path's first point to its second, which is exact for a straight path and
 * a reasonable estimate of a curved one's initial tangent. `genericSweep`, replicad's
 * lower-level pipe-sweep function, is used directly instead of `Sketch.sweepSketch`'s own
 * `(plane, origin)` callback convenience, which turned out to not honour a supplied plane the
 * way its own types suggest (empirically, every attempt through it produced a sweep aligned
 * to a fixed axis regardless of the path actually given to it) — worth another look someday,
 * but not blocking on understanding why once a lower-level path this function fully controls
 * itself produces a correct result.
 */
function buildSweepSolid(profileSketch: Sketch, pathSketch: Sketch): Solid | null {
  const regions = profileRegions(profileSketch);
  if (!regions) return null;

  const pathPoints = sweepPathPoints(pathSketch);
  if (!pathPoints) return null;

  const worldPoints = pathPoints.map((point) => sketchToWorld(pathSketch.planeId, point.x, point.y));
  const tangent = worldPoints[1].clone().sub(worldPoints[0]).normalize();
  if (tangent.lengthSq() < 1e-12) return null;

  const perpendicular = perpendicularTo(tangent);
  const origin: [number, number, number] = [worldPoints[0].x, worldPoints[0].y, worldPoints[0].z];
  const tangentArray: [number, number, number] = [tangent.x, tangent.y, tangent.z];
  const perpendicularArray: [number, number, number] = [perpendicular.x, perpendicular.y, perpendicular.z];

  const pathPlane = replicadPlaneFor(pathSketch.planeId);
  const pathDrawing =
    pathPoints.length === 2
      ? draw([pathPoints[0].x, pathPoints[0].y])
          .lineTo([pathPoints[1].x, pathPoints[1].y])
          .done()
      : drawPointsInterpolation(pathPoints.map((point): [number, number] => [point.x, point.y]));
  const spineWire = (pathDrawing.sketchOnPlane(pathPlane) as unknown as { wire: unknown }).wire;

  const profilePlane = new Plane(origin, perpendicularArray, tangentArray);
  const profileWire = (drawRegion(regions.outer).sketchOnPlane(profilePlane) as unknown as { wire: unknown })
    .wire;

  return genericSweep(profileWire as never, spineWire as never, {});
}

/**
 * Combines `addition` into `base` with the given operation — `join`/`cut`/`intersect`
 * map straight onto replicad's own `fuse`/`cut`/`intersect`. A `null` base (nothing built
 * yet) always becomes `addition` outright regardless of operation, the same as the
 * pre-existing `current ? fuse(...) : solid` shortcut this replaces: the first feature in
 * a document has nothing to combine with yet, so it simply *is* the body.
 */
function applyOperation(base: Solid | null, addition: Solid, operation: BooleanOperation): Solid {
  if (!base) return addition;
  const target = base as unknown as {
    cut: (other: Solid) => Solid;
    fuse: (other: Solid) => Solid;
    intersect: (other: Solid) => Solid;
  };
  switch (operation) {
    case "cut":
      return target.cut(addition);
    case "intersect":
      return target.intersect(addition);
    case "join":
      return target.fuse(addition);
  }
}

/**
 * Rebuilds the document's geometry from its feature history.
 *
 * Only features above the rollback bar and not suppressed take part, so rolling back
 * genuinely re-evaluates the model rather than just hiding rows in the tree.
 *
 * Rather than replaying from scratch every time, the rebuild resumes from the cached
 * checkpoint prefix whose content keys still match (`rebuildCache.ts`) and replays only
 * the features from the first change onward — editing the last feature of a deep history
 * costs one feature, not the whole chain. Every clean replayed prefix becomes the new
 * cache, so the next edit starts from wherever this one ended.
 */
export async function rebuildDocument(
  features: Feature[],
  sketches: Record<string, Sketch>,
): Promise<RebuildResult> {
  await initKernel();

  // Suppressed features never reach the kernel, so the cache addresses the *evaluated*
  // list — un-suppressing a feature inserts it into that list and shifts every key after
  // it, which is exactly the divergence the prefix match exists to catch.
  const evaluated = features.filter((candidate) => !candidate.suppressed);
  const keys = prefixKeys(evaluated, sketches);

  const errors: Record<string, string> = {};
  let current: Solid | null = null;
  let rotation: [number, number, number] = [0, 0, 0];

  // Each modelling feature's own contribution, keyed by feature id, so a pattern or mirror
  // referencing an earlier feature can transform and re-combine just that feature's shape
  // rather than the whole cumulative body built up to that point.
  const featureSolids = new Map<string, { solid: Solid; operation: BooleanOperation }>();

  // Resume from the longest cached prefix whose content still matches; `start` is the
  // first evaluated index that has to actually be replayed. A fresh process (or a
  // document switch, which changes feature content at index 0) starts at zero.
  const start = longestReusablePrefix(
    checkpoints.map((checkpoint) => checkpoint.key),
    keys,
  );
  lastReplayedFrom = start;
  if (start > 0) {
    const resume = checkpoints[start - 1]!;
    current = resume.current;
    rotation = [...resume.rotation] as [number, number, number];
    for (const [id, entry] of resume.featureSolids) featureSolids.set(id, { ...entry });
  }

  // The chain this rebuild leaves behind: the kept prefix, plus a fresh checkpoint for
  // every replayed feature whose prefix stayed clean.
  const newChain: RebuildCheckpoint<Solid>[] = checkpoints.slice(0, start);

  // Checkpoints are only kept for prefixes that replayed without error and without an
  // imported body. An errored feature can be transiently fixed by something outside the
  // document (an imported shape being re-registered, kernel state), so the state after it
  // must be re-derived rather than trusted — `recordCheckpoint` below refuses to record
  // once any error exists. An imported solid is the other exclusion, tracked by this flag
  // instead: it is owned by `importedShapes.ts`'s registry, which may release it while the
  // cache still holds a reference, so the cache stops at the import.
  let cacheable = true;

  const recordCheckpoint = (index: number) => {
    if (!cacheable || index < start || index >= MAX_CHECKPOINTS) return;
    // An errored prefix must never be checkpointed: an error can be fixed by something
    // outside the document (an imported shape re-registered, kernel state), so the state
    // after it has to be re-derived, not trusted.
    if (Object.keys(errors).length > 0) return;
    newChain[index] = {
      key: keys[index]!,
      current,
      featureSolids: new Map(featureSolids),
      rotation: [...rotation] as [number, number, number],
    };
  };

  for (let index = 0; index < evaluated.length; index++) {
    if (index < start) continue;

    // The state right now is the end of the *previous* feature — exactly what its
    // checkpoint records. Recording at the top of the loop rather than the bottom means
    // every early `continue` in the body below still leaves the checkpoint behind,
    // without duplicating recording code into each branch.
    if (index > start) recordCheckpoint(index - 1);

    const feature = evaluated[index]!;

    // An imported body has no history to replay; it simply enters the model as a base.
    if (feature.kind === "imported") {
      // Registry-owned solid from here on — see the `cacheable` note above.
      cacheable = false;
      const imported = getImportedShape(feature.id);
      if (!imported) {
        errors[feature.id] = "Imported geometry is no longer loaded";
        continue;
      }
      current = applyOperation(current, imported as Solid, "join");
      featureSolids.set(feature.id, { solid: imported as Solid, operation: "join" });
      rotation = [0, 0, 0];
      continue;
    }

    const isExtrudeKind = feature.kind === "extrude" || feature.kind === "cut-extrude";
    const isRevolveKind = feature.kind === "revolve" || feature.kind === "cut-revolve";
    const isHoleKind = feature.kind === "hole";
    const isPatternKind =
      feature.kind === "linear-pattern" || feature.kind === "circular-pattern" || feature.kind === "mirror";

    if (isPatternKind) {
      const sourceId = feature.parents.find((parent) => featureSolids.has(parent));
      const source = sourceId ? featureSolids.get(sourceId) : undefined;
      if (!source) {
        errors[feature.id] = "No feature selected to pattern";
        continue;
      }
      if (!current) {
        errors[feature.id] = "Nothing to pattern: add a boss feature first";
        continue;
      }

      try {
        const patterned =
          feature.kind === "linear-pattern"
            ? buildLinearPatternSolid(source.solid, feature)
            : feature.kind === "circular-pattern"
              ? buildCircularPatternSolid(source.solid, feature)
              : buildMirrorSolid(source.solid, feature);

        if (!patterned) {
          errors[feature.id] = "Increase the instance count to add copies";
          continue;
        }

        current = applyOperation(current, patterned, source.operation);
      } catch (error) {
        errors[feature.id] = error instanceof Error ? error.message : "Pattern failed";
      }
      continue;
    }

    // Fillet/Chamfer/Shell/Draft all act on the body as a whole (dress-up features, not
    // built from a sketch), so unlike an extrude/revolve/hole they need no `parents` lookup
    // — whatever `current` is by this point in the history is what they modify in place.
    if (
      feature.kind === "fillet" ||
      feature.kind === "chamfer" ||
      feature.kind === "shell" ||
      feature.kind === "draft"
    ) {
      if (!current) {
        errors[feature.id] = `Nothing to ${feature.kind}: add a boss feature first`;
        continue;
      }
      try {
        current =
          feature.kind === "fillet"
            ? buildFilletedSolid(current, feature)
            : feature.kind === "chamfer"
              ? buildChamferedSolid(current, feature)
              : feature.kind === "shell"
                ? buildShelledSolid(current, feature)
                : buildDraftedSolid(current, feature);
        featureSolids.set(feature.id, { solid: current, operation: "join" });
      } catch (error) {
        errors[feature.id] = error instanceof Error ? error.message : `${feature.kind} failed`;
      }
      continue;
    }

    if (feature.kind === "loft") {
      const sketchIds = feature.parents.filter((parent) => sketches[parent]);
      if (sketchIds.length < 2) {
        errors[feature.id] = "Select at least two sketches to loft between";
        continue;
      }

      const loftSketches = sketchIds.map((id) => sketches[id]);
      const planeId = loftSketches[0].planeId;
      if (loftSketches.some((sketch) => sketch.planeId !== planeId)) {
        errors[feature.id] = "All sketches in a loft must be on the same plane (multi-plane lofts aren't supported yet)";
        continue;
      }

      try {
        const solid = buildLoftSolid(loftSketches, feature);
        if (!solid) {
          errors[feature.id] = "Each sketch needs a closed profile to loft between";
          continue;
        }

        rotation = planeBasis(planeId).rotation as [number, number, number];
        featureSolids.set(feature.id, { solid, operation: "join" });
        current = applyOperation(current, solid, "join");
      } catch (error) {
        errors[feature.id] = error instanceof Error ? error.message : "Loft failed";
      }
      continue;
    }

    if (feature.kind === "sweep" || feature.kind === "cut-sweep") {
      const [profileId, pathId] = feature.parents.filter((parent) => sketches[parent]);
      if (!profileId || !pathId) {
        errors[feature.id] = "Select a profile sketch and a path sketch (with a spline or construction line) to sweep";
        continue;
      }

      try {
        const solid = buildSweepSolid(sketches[profileId], sketches[pathId]);
        if (!solid) {
          errors[feature.id] = "The profile needs a closed loop and the path sketch needs a spline or construction line";
          continue;
        }

        // Both sketches are already embedded in true world coordinates (see
        // `buildSweepSolid`'s own note), so unlike every other sketch-based feature there is
        // no cosmetic display rotation left to apply.
        rotation = [0, 0, 0];
        const operation: BooleanOperation = feature.parameters.operation ?? (feature.kind === "cut-sweep" ? "cut" : "join");
        featureSolids.set(feature.id, { solid, operation });
        if (operation !== "join" && !current) {
          errors[feature.id] = "Nothing to cut: add a boss feature first";
          continue;
        }
        current = applyOperation(current, solid, operation);
      } catch (error) {
        errors[feature.id] = error instanceof Error ? error.message : "Sweep failed";
      }
      continue;
    }

    const isRibKind = feature.kind === "rib";

    if (!isExtrudeKind && !isRevolveKind && !isHoleKind && !isRibKind) continue;

    const sketchId = feature.parents.find((parent) => sketches[parent]);
    if (!sketchId) {
      errors[feature.id] = "No sketch selected for this feature";
      continue;
    }

    const sketch = sketches[sketchId];

    try {
      const solid = isRevolveKind
        ? buildRevolveSolid(sketch, feature)
        : isHoleKind
          ? buildHoleSolid(sketch, feature)
          : isRibKind
            ? buildRibSolid(sketch, feature)
            : buildFeatureSolid(sketch, feature);
      if (!solid) {
        errors[feature.id] = isRevolveKind
          ? "The sketch has no closed profile to revolve"
          : isHoleKind
            ? "Place at least one point in the sketch to mark a hole centre"
            : isRibKind
              ? "Draw a single line in the sketch to mark the rib's path"
              : "The sketch has no closed profile to extrude";
        continue;
      }

      rotation = planeBasis(sketch.planeId).rotation as [number, number, number];

      // Falls back to the feature's own kind for a document/undo-history entry saved
      // before `operation` existed — the cut-* kinds always meant "cut" and the boss
      // kinds always meant "join", so an absent value still resolves to what it already
      // was rather than silently changing behaviour on old documents. A hole always cuts
      // and a rib always joins; neither has a join/cut/intersect choice to begin with.
      const operation: BooleanOperation =
        feature.parameters.operation ??
        (isHoleKind || feature.kind === "cut-extrude" || feature.kind === "cut-revolve" ? "cut" : "join");
      featureSolids.set(feature.id, { solid, operation });
      if (operation !== "join" && !current) {
        errors[feature.id] =
          operation === "cut" ? "Nothing to cut: add a boss feature first" : "Nothing to intersect: add a boss feature first";
        continue;
      }
      current = applyOperation(current, solid, operation);
    } catch (error) {
      errors[feature.id] = error instanceof Error ? error.message : "Rebuild failed";
    }
  }

  // The last feature's checkpoint: the top-of-loop recorder fires only when a *next*
  // iteration begins, which never happens for the final feature.
  if (evaluated.length > 0 && evaluated.length - 1 >= start) {
    recordCheckpoint(evaluated.length - 1);
  }

  // Swap in the new chain, releasing exactly the kernel objects the old chain owned that
  // the new one does not — the old final solid included, when no kept checkpoint still
  // holds it. This is the single place checkpoint shapes are deleted; `replaceCurrentShape`
  // only assigns, because every previous final is either kept here or released here.
  const doomed = planCheckpointEviction(checkpoints, newChain, currentShape, current);
  checkpoints = newChain;
  for (const shape of doomed) {
    try {
      (shape as unknown as { delete?: () => void }).delete?.();
    } catch {
      // A shape already released by the kernel is not worth failing a rebuild over.
    }
  }

  if (!current) {
    replaceCurrentShape(null);
    return { mesh: null, errors };
  }

  const shape = current as unknown as {
    mesh: (options?: { tolerance?: number; angularTolerance?: number }) => {
      vertices: number[];
      triangles: number[];
      normals: number[];
      faceGroups: { start: number; count: number; faceId: number }[];
    };
    meshEdges: (options?: { keepMesh?: boolean }) => {
      lines: number[];
      edgeGroups: { start: number; count: number; edgeId: number }[];
    };
  };

  const triangulated = shape.mesh({ tolerance: 0.05, angularTolerance: 20 });
  const wireframe = shape.meshEdges();

  replaceCurrentShape(current);

  return {
    mesh: {
      positions: Float32Array.from(triangulated.vertices),
      normals: Float32Array.from(triangulated.normals),
      indices: Uint32Array.from(triangulated.triangles),
      edges: Float32Array.from(wireframe.lines),
      rotation,
      // Re-keyed 0, 1, 2, ... in `shape.faces` order rather than trusting the raw OpenCascade
      // hash straight through: a hash is a fine unique key but a confusing one to show a user
      // ("Face 3821490102"), and small sequential ids are cheap to assign here since
      // `faceGroups` is already in that same face order.
      faceGroups: triangulated.faceGroups.map((group, index) => ({
        start: group.start,
        count: group.count,
        id: index,
      })),
      // Re-keyed the same way `faceGroups` is, for the same reason — a small sequential id
      // is friendlier and more stable-looking than OpenCascade's raw edge hash, even though
      // neither is stable across a rebuild that changes the body's topology.
      edgeGroups: wireframe.edgeGroups.map((group, index) => ({
        start: group.start,
        count: group.count,
        id: index,
      })),
    },
    errors,
  };
}
