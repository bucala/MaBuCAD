import { draw, drawCircle, drawPointsInterpolation, EdgeFinder, FaceFinder, genericSweep, Plane } from "replicad";
import { Vector3 } from "three";

import { planeBasis, sketchToWorld } from "@/sketch/planeBasis";
import { pointById } from "@/sketch/sketchModel";
import type { LineEntity, PointEntity, Sketch, SplineEntity } from "@/sketch/types";
import type { EndCondition, Feature } from "@/types/document";

import { getImportedShape } from "./importedShapes";
import { initKernel } from "./occ";
import { profileRegions, type CircleLoop, type Loop } from "./profile";

/** Triangulated result handed to three.js. */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Flattened line segment pairs for the edge overlay. */
  edges: Float32Array;
  /** Rotation that maps the sketch plane's local space into world space. */
  rotation: [number, number, number];
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
 * Shapes are WebAssembly-backed and are not reclaimed by the JavaScript garbage collector,
 * so the previous one is released whenever a new rebuild replaces it.
 */
let currentShape: Solid | null = null;

export function getCurrentShape(): Solid | null {
  return currentShape;
}

function replaceCurrentShape(next: Solid | null): void {
  const previous = currentShape as unknown as { delete?: () => void } | null;
  if (previous && previous !== (next as unknown as typeof previous)) {
    try {
      previous.delete?.();
    } catch {
      // A shape already released by the kernel is not worth failing a rebuild over.
    }
  }
  currentShape = next;
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
function extrusionRange(
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

/**
 * Finds the revolve axis for a sketch: the first construction line's endpoints, or the
 * sketch's local Y axis through the origin when none exists.
 *
 * The fallback matters more than it looks: replicad defaults an omitted revolve axis to
 * the sketch plane's own normal, which is coplanar with (not swept around by) a profile
 * drawn flat in local XY, producing a degenerate result rather than a safe no-op — so an
 * explicit in-plane axis must always be supplied.
 */
function revolveAxis(sketch: Sketch): RevolveAxis {
  const axisLine = sketch.entities.find(
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
  const regions = profileRegions(sketch);
  if (!regions) return null;

  const angle = feature.parameters.angle ?? 360;
  const axis = revolveAxis(sketch);

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

  return solid;
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

function buildCircularPatternSolid(source: Solid, feature: Feature): Solid | null {
  const direction = AXIS_VECTORS[feature.parameters.axis ?? "z"];
  const count = Math.max(1, Math.round(feature.parameters.count ?? 1));
  const step = (feature.parameters.angle ?? 360) / count;

  return buildCopies(source, count, (index, copy) =>
    asTransformable(copy).rotate(step * index, [0, 0, 0], direction),
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

/**
 * Builds an edge filter from picked points — see `FeatureParameters.edgePoints`'s own note
 * on why this is a geometric proximity match (`EdgeFinder.withinDistance`) rather than true
 * persistent naming, which this app's kernel has no way to provide. `undefined` means "every
 * edge", replicad's own convention for a fillet/chamfer's optional filter.
 */
function pickedEdgeFilter(
  edgePoints: [number, number, number][] | undefined,
): ((finder: EdgeFinder) => EdgeFinder) | undefined {
  if (!edgePoints || edgePoints.length === 0) return undefined;
  return (finder) =>
    finder.either(edgePoints.map((point) => (f: EdgeFinder) => f.withinDistance(EDGE_PICK_TOLERANCE, point)));
}

/**
 * A fillet applies to every edge of the body by default; selecting edges in the viewport
 * (`viewportStore.ts`'s `edgePickModeFeatureId`) narrows it to just those, via
 * `pickedEdgeFilter`.
 */
function buildFilletedSolid(solid: Solid, feature: Feature): Solid {
  const radius = Math.max(feature.parameters.radius ?? 2, 0.05);
  const target = solid as unknown as { fillet: (radiusConfig: number, filter?: (f: EdgeFinder) => EdgeFinder) => Solid };
  return target.fillet(radius, pickedEdgeFilter(feature.parameters.edgePoints));
}

/** A plain-number chamfer distance is symmetric; see `buildFilletedSolid`'s own note on
 * narrowing which edges it applies to via picked points. */
function buildChamferedSolid(solid: Solid, feature: Feature): Solid {
  const distance = Math.max(feature.parameters.distance ?? 1, 0.05);
  const target = solid as unknown as {
    chamfer: (radiusConfig: number, filter?: (f: EdgeFinder) => EdgeFinder) => Solid;
  };
  return target.chamfer(distance, pickedEdgeFilter(feature.parameters.edgePoints));
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
  const regions = profileRegions(sketch);
  if (!regions) return null;

  const { distance, offset } = extrusionRange(
    feature.parameters.endCondition ?? "blind",
    feature.parameters.depth ?? 10,
    feature.parameters.reversed ?? false,
  );

  let solid = drawRegion(regions.outer).sketchOnPlane("XY").extrude(distance) as Solid;

  // Inner regions become through holes rather than separate bodies.
  for (const inner of regions.inner) {
    const tool = drawRegion(inner)
      .sketchOnPlane("XY")
      .extrude(distance * 2)
      .translate([0, 0, -Math.abs(distance) / 2]) as Solid;
    solid = (solid as unknown as { cut: (other: Solid) => Solid }).cut(tool);
  }

  if (offset !== 0) {
    solid = (solid as unknown as { translate: (v: [number, number, number]) => Solid }).translate([
      0,
      0,
      offset,
    ]);
  }

  return solid;
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

/**
 * Builds the union of one cylindrical cut per point placed in the hole's sketch — a Hole
 * Wizard feature always cuts (there is no join/intersect for it), and one feature can carry
 * several holes at once the same way a real Hole Wizard places a whole pattern of them from
 * one dialog. `radius` is already resolved to its final value by the time this runs, whether
 * that came from a plain number (a simple hole) or a clearance/tap-drill lookup in
 * `data/holeStandards.ts` (see `PropertyManager.tsx`'s Hole Wizard section) — this function
 * has no notion of standards or fasteners, only a radius and an end condition, same as
 * `buildFeatureSolid` reusing `extrusionRange` below.
 */
function buildHoleSolid(sketch: Sketch, feature: Feature): Solid | null {
  const points = sketch.entities
    .filter((entity): entity is PointEntity => entity.kind === "point")
    .map((entity) => pointById(sketch, entity.at))
    .filter((point): point is NonNullable<typeof point> => point !== undefined);
  if (points.length === 0) return null;

  const radius = Math.max(feature.parameters.radius ?? 3, 0.05);
  const { distance, offset } = extrusionRange(
    feature.parameters.endCondition ?? "through-all",
    feature.parameters.depth ?? 10,
    feature.parameters.reversed ?? false,
  );

  let solid: Solid | null = null;
  for (const point of points) {
    let tool = drawCircle(radius).translate(point.x, point.y).sketchOnPlane("XY").extrude(distance) as Solid;
    if (offset !== 0) {
      tool = (tool as unknown as { translate: (v: [number, number, number]) => Solid }).translate([0, 0, offset]);
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

/** How a feature's own solid combines with whatever body already exists. */
type BooleanOperation = "join" | "cut" | "intersect";

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
 */
export async function rebuildDocument(
  features: Feature[],
  sketches: Record<string, Sketch>,
): Promise<RebuildResult> {
  await initKernel();

  const errors: Record<string, string> = {};
  let current: Solid | null = null;
  let rotation: [number, number, number] = [0, 0, 0];

  // Each modelling feature's own contribution, keyed by feature id, so a pattern or mirror
  // referencing an earlier feature can transform and re-combine just that feature's shape
  // rather than the whole cumulative body built up to that point.
  const featureSolids = new Map<string, { solid: Solid; operation: BooleanOperation }>();

  for (const feature of features) {
    if (feature.suppressed) continue;

    // An imported body has no history to replay; it simply enters the model as a base.
    if (feature.kind === "imported") {
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

  if (!current) {
    replaceCurrentShape(null);
    return { mesh: null, errors };
  }

  const shape = current as unknown as {
    mesh: (options?: { tolerance?: number; angularTolerance?: number }) => {
      vertices: number[];
      triangles: number[];
      normals: number[];
    };
    meshEdges: (options?: { keepMesh?: boolean }) => { lines: number[] };
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
    },
    errors,
  };
}
