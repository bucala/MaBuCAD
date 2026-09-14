import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, type OrthographicCamera, type PerspectiveCamera } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { useSettingsStore } from "@/state/settingsStore";

/** The orbit target before any controls exist — the same default OrbitControls itself
 * starts from, so the distance estimate holds even on the very first frame. */
const DEFAULT_TARGET = new Vector3();

/**
 * Applies Settings > Display > "Line pick tolerance" to the live raycaster whenever it
 * changes, not just once at Canvas creation — and in the right *unit* for each of the two
 * line implementations three.js ships, which do not share one:
 *
 *  - `Line2` (fat lines — every sketch line) raycasts in *screen pixels*:
 *    `raycaster.params.Line2.threshold` adds straight onto `material.linewidth`
 *    (`LineSegments2.raycast`), so the setting applies as-is. `Line2` isn't part of
 *    three's own `RaycasterParameters` type (it's an examples/jsm addition reading this
 *    object by convention, not a declared field), so it's set via an escape hatch rather
 *    than through r3f's strictly-typed `raycaster` prop.
 *  - native `Line`/`LineSegments` (the B-Rep edge overlay that Fillet/Chamfer picking and
 *    Measure click) raycasts in *world units*: `Line.raycast` compares the ray-to-segment
 *    distance against `raycaster.params.Line.threshold` directly. Feeding it the pixel
 *    value made the default tolerance "6 mm" — a click anywhere within 6 mm of *any* edge
 *    registered as an edge hit, and its `stopPropagation` swallowed the face pick
 *    underneath, which is why edge picking read as far sloppier than the sketcher's. The
 *    world value is instead the setting × the world size of one pixel at the camera's
 *    current distance to the orbit target, recomputed per rendered frame — pixel-accurate
 *    at any zoom, the same behaviour the sketch side gets for free.
 *
 * Per-frame work is a dirty-checked no-op most frames (the Canvas is `frameloop="demand"`,
 * so this only runs while a frame is actually being drawn, and two multiplications are
 * nothing next to what that frame costs), because the camera *does* move between setting
 * changes — that's the whole point: zooming in tightens the world threshold the same way
 * it shrinks a pixel.
 */
export function RaycasterTuning() {
  const raycaster = useThree((state) => state.raycaster);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const size = useThree((state) => state.size);
  const linePickTolerance = useSettingsStore((state) => state.linePickTolerance);
  const appliedRef = useRef({ line: -1, line2: -1 });

  useFrame(() => {
    const heightPx = Math.max(size.height, 1);
    let worldPerPixel: number;
    if ((camera as PerspectiveCamera).isPerspectiveCamera) {
      // One pixel at the orbit target's depth — where the model sits, and where the
      // tolerance has to mean "this many pixels from the edge I can see".
      const fovRadians = (((camera as PerspectiveCamera).fov || 50) * Math.PI) / 180;
      const target = controls?.target ?? DEFAULT_TARGET;
      const distance = camera.position.distanceTo(target);
      worldPerPixel = (2 * distance * Math.tan(fovRadians / 2)) / heightPx;
    } else {
      // Orthographic: top/bottom are already world units, so this is exact.
      const ortho = camera as OrthographicCamera;
      worldPerPixel = (ortho.top - ortho.bottom) / heightPx;
    }

    const lineThreshold = linePickTolerance * worldPerPixel;
    if (appliedRef.current.line === lineThreshold && appliedRef.current.line2 === linePickTolerance) {
      return;
    }
    appliedRef.current = { line: lineThreshold, line2: linePickTolerance };

    const params = raycaster.params as unknown as Record<string, { threshold?: number } | undefined>;
    params.Line = { ...params.Line, threshold: lineThreshold };
    params.Line2 = { ...params.Line2, threshold: linePickTolerance };
  });

  return null;
}
