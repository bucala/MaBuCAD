import { useMemo } from "react";
import { Line } from "@react-three/drei";

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
 * hole. This draws a helical polyline into that cylinder purely for display (it contributes
 * no geometry to the kernel body, and Export STEP/STL never sees it), the same convention
 * SolidWorks' own "cosmetic thread" uses: close enough to read as "this is threaded" without
 * the cost and fragility of actually machining a thread profile into the B-Rep.
 *
 * Lives inside `SolidModel.tsx`'s own `<group rotation={mesh.rotation}>` rather than
 * computing a world transform of its own: a hole's cut cylinder is built in the sketch
 * plane's local, un-rotated XY space exactly like the rest of the fused body (see
 * `kernel/rebuild.ts`'s `buildHoleSolid`/`extrusionRange`), so the same rotation that orients
 * the mesh for display orients this line identically, with no separate plane-basis lookup.
 */

const SEGMENTS_PER_TURN = 24;
const MIN_TURNS = 3;
const MAX_TURNS = 28;
/** How far into the hole the cosmetic thread is drawn, in multiples of its own major
 * diameter — a real thread only needs to be visible near the opening to read correctly, and
 * a through-all hole's `extrusionRange` is a deliberately oversized cut (see its own doc
 * comment) that would otherwise demand thousands of turns for no visual benefit. */
const DEPTH_IN_DIAMETERS = 6;
/** `fullDepthThread === false` shows a visibly shorter engagement length instead of a second
 * exact-but-unmodelled measurement — there is no real thread-length field to draw from. */
const PARTIAL_DEPTH_FRACTION = 0.55;

function threadHelixPoints(
  centre: { x: number; y: number },
  majorRadius: number,
  pitch: number,
  zStart: number,
  depth: number,
  directionSign: number,
  winding: 1 | -1,
): [number, number, number][] {
  const turns = Math.min(MAX_TURNS, Math.max(MIN_TURNS, depth / Math.max(pitch, 0.05)));
  const totalSegments = Math.round(turns * SEGMENTS_PER_TURN);
  const points: [number, number, number][] = [];

  for (let i = 0; i <= totalSegments; i += 1) {
    const t = i / SEGMENTS_PER_TURN;
    const angle = winding * t * Math.PI * 2;
    const z = zStart + directionSign * Math.min(t * pitch, depth);
    points.push([centre.x + majorRadius * Math.cos(angle), centre.y + majorRadius * Math.sin(angle), z]);
    if (z * directionSign >= zStart * directionSign + depth) break;
  }

  return points;
}

interface ThreadRun {
  key: string;
  points: [number, number, number][];
}

function buildThreadRuns(features: Feature[], rollbackIndex: number, sketches: Record<string, Sketch>): ThreadRun[] {
  const runs: ThreadRun[] = [];

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
    const depth = feature.parameters.fullDepthThread === false ? availableDepth * PARTIAL_DEPTH_FRACTION : availableDepth;
    if (depth <= 0) continue;

    // Always starts at the sketch plane (`z = 0`) — where the hole's own point sits and
    // where its opening actually is, regardless of end condition. `distance`/`offset` from
    // `extrusionRange` describe the *cut tool*, which for `through-all` extends deep past
    // either face purely to guarantee full penetration (see its own doc comment) — using
    // `offset` here would start the cosmetic thread far outside the visible material.
    for (const point of points) {
      runs.push({
        key: `${feature.id}-${point.id}`,
        points: threadHelixPoints(point, majorRadius, entry.pitch, 0, depth, directionSign, winding),
      });
    }
  }

  return runs;
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
  const runs = useMemo(() => buildThreadRuns(features, rollbackIndex, sketches), [features, rollbackIndex, sketches]);

  return (
    <>
      {runs.map((run) => (
        <Line
          key={run.key}
          points={run.points}
          color={color}
          lineWidth={1}
          transparent
          opacity={0.55}
          raycast={() => null}
        />
      ))}
    </>
  );
}
