import { useEffect, useMemo } from "react";
import { CanvasTexture, DoubleSide, RepeatWrapping, type Texture } from "three";

import { resolveTapDrill } from "@/data/holeResolution";
import type { TappedStandardId } from "@/data/holeStandards";
import { extrusionRange } from "@/kernel/rebuild";
import { pointById } from "@/sketch/sketchModel";
import type { PointEntity, Sketch } from "@/sketch/types";
import type { Feature } from "@/types/document";

/**
 * Cosmetic thread indicator for tapped/taper-tapped holes.
 *
 * Real thread geometry (an actual helical cut) is not modelled anywhere in this app — see
 * `FeatureParameters.threadDirection`/`fullDepthThread`'s own doc comments in
 * `types/document.ts`, which were added in anticipation of exactly this — so a tapped hole
 * otherwise cuts and displays as a perfectly plain cylinder, indistinguishable from a Simple
 * hole. This renders a textured cylindrical shell into that cylinder purely for display (it
 * contributes no geometry to the kernel body, and Export STEP/STL never sees it) — the same
 * convention Inventor's own cosmetic thread uses: a repeating diagonal-line texture on the
 * bore's cylindrical surface rather than an actually-modelled thread profile, close enough to
 * read as "this is threaded" without the cost and fragility of machining one into the B-Rep.
 *
 * Lives inside `SolidModel.tsx`'s own `<group rotation={mesh.rotation}>` rather than
 * computing a world transform of its own: a hole's cut cylinder is built in the sketch
 * plane's local, un-rotated XY space exactly like the rest of the fused body (see
 * `kernel/rebuild.ts`'s `buildHoleSolid`/`extrusionRange`), so the same rotation that orients
 * the mesh for display orients this cylinder identically, with no separate plane-basis lookup.
 */

const RADIAL_SEGMENTS = 48;
/** How far into the hole the cosmetic thread is drawn, in multiples of its own major
 * diameter — a real thread only needs to be visible near the opening to read correctly, and
 * a through-all hole's `extrusionRange` is a deliberately oversized cut (see its own doc
 * comment) that would otherwise demand hundreds of turns for no visual benefit. */
const DEPTH_IN_DIAMETERS = 6;
/** Fallback engagement length for a Full-Depth-off thread with no `threadDepth` value —
 * only possible in a document saved before the field existed; a fresh toggle-off seeds a
 * real value (see `PropertyManager.tsx`'s Full Depth handler). */
const PARTIAL_DEPTH_FRACTION = 0.55;
/** Square texture tile holding one diagonal line corner-to-corner — see `threadTexture`'s
 * own doc comment for why this single tile, repeated, draws a continuous helix. */
const TEXTURE_SIZE = 128;

/**
 * One diagonal line across a square tile. Mapped onto a cylinder with U wrapping exactly
 * once around its circumference (`repeat.x = ±1`, the sign giving a thread's handedness)
 * and V repeated once per pitch of height (`repeat.y`, set per-instance since depth and
 * pitch vary per hole), the line advances by exactly one pitch for each full revolution —
 * the definition of a helix — and chains seamlessly from one V-repeat into the next
 * because it both starts and ends exactly at the tile's own corners.
 */
function threadTexture(color: string): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, TEXTURE_SIZE * 0.035);
  ctx.beginPath();
  ctx.moveTo(0, TEXTURE_SIZE);
  ctx.lineTo(TEXTURE_SIZE, 0);
  ctx.stroke();

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

interface ThreadCylinder {
  key: string;
  centre: { x: number; y: number };
  radius: number;
  zStart: number;
  depth: number;
  directionSign: number;
  winding: 1 | -1;
  pitch: number;
}

function buildThreadCylinders(
  features: Feature[],
  rollbackIndex: number,
  sketches: Record<string, Sketch>,
): ThreadCylinder[] {
  const cylinders: ThreadCylinder[] = [];

  for (const feature of features.slice(0, rollbackIndex)) {
    if (feature.kind !== "hole" || feature.suppressed) continue;
    const { holeType, holeStandard, holeSize } = feature.parameters;
    if (holeType !== "tapped" && holeType !== "taper-tapped") continue;
    if (!holeStandard || !holeSize) continue;

    const entry = resolveTapDrill(holeStandard as TappedStandardId, holeSize);
    if (!entry) continue;

    const sketch = sketches[feature.parents[0]];
    if (!sketch) continue;

    const points = sketch.entities
      .filter((entity): entity is PointEntity => entity.kind === "point")
      .map((entity) => pointById(sketch, entity.at))
      .filter((point): point is NonNullable<typeof point> => point !== undefined);
    if (points.length === 0) continue;

    const endCondition = feature.parameters.endCondition ?? "through-all";
    const reversed = feature.parameters.reversed ?? false;
    const { distance } = extrusionRange(endCondition, feature.parameters.depth ?? 10, reversed);
    const directionSign = reversed ? -1 : 1;
    const majorRadius = entry.nominalSize / 2;
    const winding: 1 | -1 = feature.parameters.threadDirection === "left" ? -1 : 1;

    // Capped by the literal `depth` field, not just a diameter multiple — `distance` for a
    // `through-all` hole is a deliberately oversized cut (see `extrusionRange`'s own doc
    // comment, `magnitude * 100`) with no relation to how thick the actual body is. Without
    // this, a wide-diameter thread on a `through-all` hole would coil for a hundred times
    // its own `depth` value, tunnelling far out past the real material into open space.
    const literalDepth = Math.max(Math.abs(feature.parameters.depth ?? 10), 0.01);
    const depthCap = Math.min(majorRadius * 2 * DEPTH_IN_DIAMETERS, literalDepth);
    const availableDepth = Math.min(Math.abs(distance), depthCap);
    // `threadDepth` is the Hole Wizard's own engagement length; clamped to what the hole
    // actually offers so a stale (pre-size-change) value can never draw thread past the
    // hole's bottom, and falls back to the pre-field fraction for old documents.
    const depth =
      feature.parameters.fullDepthThread === false
        ? Math.min(feature.parameters.threadDepth ?? availableDepth * PARTIAL_DEPTH_FRACTION, availableDepth)
        : availableDepth;
    if (depth <= 0) continue;

    // Always starts at the sketch plane (`z = 0`) — where the hole's own point sits and
    // where its opening actually is, regardless of end condition. `distance`/`offset` from
    // `extrusionRange` describe the *cut tool*, which for `through-all` extends deep past
    // either face purely to guarantee full penetration (see its own doc comment) — using
    // `offset` here would start the cosmetic thread far outside the visible material.
    for (const point of points) {
      cylinders.push({
        key: `${feature.id}-${point.id}`,
        centre: point,
        radius: majorRadius,
        zStart: 0,
        depth,
        directionSign,
        winding,
        pitch: entry.pitch,
      });
    }
  }

  return cylinders;
}

interface ThreadInstance {
  key: string;
  centre: { x: number; y: number };
  radius: number;
  zStart: number;
  depth: number;
  directionSign: number;
  texture: Texture;
}

/** One cloned, independently-configured texture per hole — a shared instance can't carry
 * a different `repeat` (turn count) and handedness per cylinder at once. The shared base
 * is disposed immediately after cloning: nothing renders it directly, and a clone's own
 * GPU upload is independent of the instance it was cloned from. */
function buildThreadInstances(
  features: Feature[],
  rollbackIndex: number,
  sketches: Record<string, Sketch>,
  color: string,
): ThreadInstance[] {
  const cylinders = buildThreadCylinders(features, rollbackIndex, sketches);
  if (cylinders.length === 0) return [];

  const base = threadTexture(color);
  const instances = cylinders.map((cylinder) => {
    const texture = base.clone();
    texture.needsUpdate = true;
    texture.repeat.set(cylinder.winding, Math.max(cylinder.depth / Math.max(cylinder.pitch, 0.05), 1));
    return {
      key: cylinder.key,
      centre: cylinder.centre,
      radius: cylinder.radius,
      zStart: cylinder.zStart,
      depth: cylinder.depth,
      directionSign: cylinder.directionSign,
      texture,
    };
  });
  base.dispose();
  return instances;
}

export function HoleThreadOverlay({
  features,
  rollbackIndex,
  sketches,
  color,
}: {
  features: Feature[];
  rollbackIndex: number;
  sketches: Record<string, Sketch>;
  color: string;
}) {
  const instances = useMemo(
    () => buildThreadInstances(features, rollbackIndex, sketches, color),
    [features, rollbackIndex, sketches, color],
  );

  // Manually-created textures aren't owned by R3F's own JSX disposal (unlike a
  // `<meshBasicMaterial>` tag, which R3F does construct and dispose itself) — the same
  // reason `SolidModel.tsx` disposes its own manually-built geometries, applied here to
  // each batch of cloned textures in turn.
  useEffect(
    () => () => {
      for (const instance of instances) instance.texture.dispose();
    },
    [instances],
  );

  return (
    <>
      {instances.map(({ key, centre, radius, zStart, depth, directionSign, texture }) => (
        <mesh
          key={key}
          position={[centre.x, centre.y, zStart + (directionSign * depth) / 2]}
          rotation={[directionSign * (Math.PI / 2), 0, 0]}
          raycast={() => null}
        >
          <cylinderGeometry args={[radius, radius, depth, RADIAL_SEGMENTS, 1, true]} />
          <meshBasicMaterial map={texture} transparent opacity={0.6} side={DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}
