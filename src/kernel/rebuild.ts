import { draw, drawCircle } from "replicad";

import { planeBasis } from "@/sketch/planeBasis";
import type { Sketch } from "@/sketch/types";
import type { EndCondition, Feature } from "@/types/document";

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
type Solid = ReturnType<ReturnType<typeof drawCircle>["sketchOnPlane"]>["extrude"] extends (
  ...args: never[]
) => infer R
  ? R
  : never;

/** Builds a replicad drawing for one closed region of a sketch. */
function drawRegion(region: Loop | CircleLoop) {
  if ("radius" in region) {
    return drawCircle(region.radius).translate(region.centre.x, region.centre.y);
  }

  const [first, ...rest] = region.points;
  let pen = draw().movePointerTo([first.x, first.y]);
  for (const point of rest) {
    pen = pen.lineTo([point.x, point.y]);
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

  for (const feature of features) {
    if (feature.suppressed) continue;
    if (feature.kind !== "extrude" && feature.kind !== "cut-extrude") continue;

    const sketchId = feature.parents.find((parent) => sketches[parent]);
    if (!sketchId) {
      errors[feature.id] = "No sketch selected for this feature";
      continue;
    }

    const sketch = sketches[sketchId];

    try {
      const solid = buildFeatureSolid(sketch, feature);
      if (!solid) {
        errors[feature.id] = "The sketch has no closed profile to extrude";
        continue;
      }

      rotation = planeBasis(sketch.planeId).rotation as [number, number, number];

      if (feature.kind === "cut-extrude") {
        if (!current) {
          errors[feature.id] = "Nothing to cut: add a boss feature first";
          continue;
        }
        current = (current as unknown as { cut: (other: Solid) => Solid }).cut(solid);
      } else {
        current = current
          ? (current as unknown as { fuse: (other: Solid) => Solid }).fuse(solid)
          : solid;
      }
    } catch (error) {
      errors[feature.id] = error instanceof Error ? error.message : "Rebuild failed";
    }
  }

  if (!current) {
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
