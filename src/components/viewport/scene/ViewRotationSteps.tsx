import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { MathUtils, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { useViewportStore } from "@/state/viewportStore";

/**
 * Degrees between two adjacent ViewCube landmarks — a face, edge or corner. A real cube has
 * 26 of these (6 faces + 12 edges + 8 corners), laid out on an 8-position azimuth ring (45°
 * apart) crossed with a 5-position elevation ring (-90/-45/0/45/90°); every arrow click
 * moves exactly one step along one of those two rings. This is the same step size Rotate
 * View CW/CCW's own roll already used and still uses below — kept identical so all six
 * arrows read as one consistent system.
 */
const STEP_RADIANS = Math.PI / 4;

/** How close the view is allowed to get to looking straight down/up the world Y axis
 * (elevation ±90°) before it's nudged back off the exact pole — azimuth is undefined
 * exactly at the pole (every azimuth reconstructs the same direction there), which would
 * otherwise make `Math.atan2`'s read-back of the *next* click's azimuth numerically
 * unstable. Small enough to be visually indistinguishable from a true Top/Bottom view. */
const POLE_EPSILON_RADIANS = 1e-3;

/** World-space azimuth (around Y, 0 = +Z) and elevation (0 = horizon, +90° = straight up)
 * of a unit direction vector — the ViewCube's own two rings of landmarks, reduced to plain
 * spherical coordinates so "step to the next one" is just rounding to a 45° grid. */
function directionToAzimuthElevation(direction: Vector3): { azimuth: number; elevation: number } {
  return {
    elevation: Math.asin(MathUtils.clamp(direction.y, -1, 1)),
    azimuth: Math.atan2(direction.x, direction.z),
  };
}

function azimuthElevationToDirection(azimuth: number, elevation: number): Vector3 {
  const cosElevation = Math.cos(elevation);
  return new Vector3(cosElevation * Math.sin(azimuth), Math.sin(elevation), cosElevation * Math.cos(azimuth));
}

function snapToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * Performs the actual camera rotation for the ViewCube's navigation arrows (a plain DOM
 * overlay in `ViewCubeArrows.tsx`, outside the r3f tree — see `ZoomToFit.tsx`'s own doc
 * comment for why a request object in `viewportStore`, rather than a direct call, is how
 * DOM controls reach the camera here). Renders nothing; it exists purely to run the
 * effect below.
 */
export function ViewRotationSteps() {
  const request = useViewportStore((state) => state.rotateStepRequest);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    if (!request) return;

    const target = controls?.target ?? new Vector3(0, 0, 0);

    if (request.direction === "roll-cw" || request.direction === "roll-ccw") {
      // Spins the camera's own up vector around the current view axis (camera -> target)
      // — the horizon tilts, but the camera stays put and keeps looking at exactly the
      // same point, unlike the orbit below, which moves the camera around the model.
      const viewAxis = target.clone().sub(camera.position).normalize();
      if (viewAxis.lengthSq() < 1e-8) return;
      const angle = request.direction === "roll-cw" ? -STEP_RADIANS : STEP_RADIANS;
      camera.up.applyAxisAngle(viewAxis, angle).normalize();
      camera.lookAt(target);
      controls?.update();
      invalidate();
      return;
    }

    // Up/down/left/right all move the camera to the *next ViewCube landmark* in that
    // direction, not by a fixed angle from wherever the camera happens to currently be —
    // that distinction is the actual fix here. A fixed-angle orbit only lands cleanly on a
    // recognizable face/edge/corner if the starting view already was one; from anywhere
    // else (an isometric start, or a view left mid-orbit by a mouse drag) it drifts into
    // odd in-between orientations that compound with every further click, which is what
    // "left/right rotate incorrectly" and "down doesn't work" both actually were. Snapping
    // the *current* view to the nearest landmark first, then stepping exactly one grid
    // unit from there, makes every click land cleanly regardless of where the view started
    // — the same "flip to the next face" behaviour up/down already had, now shared by all
    // four directional arrows instead of only working for two of them by accident.
    const offset = camera.position.clone().sub(target);
    const distance = offset.length();
    if (distance < 1e-6) return;

    const { azimuth, elevation } = directionToAzimuthElevation(offset.clone().normalize());
    let nextAzimuth = snapToStep(azimuth, STEP_RADIANS);
    let nextElevation = MathUtils.clamp(snapToStep(elevation, STEP_RADIANS), -Math.PI / 2, Math.PI / 2);

    if (request.direction === "left" || request.direction === "right") {
      // Azimuth increases counter-clockwise as seen from above (standard right-handed
      // math convention), but "rotate view right" means the *view* turns rightward — the
      // face that was on the right edge of the screen comes toward the camera — which is
      // a clockwise step from above, i.e. a *decreasing* azimuth. Left is the reverse.
      nextAzimuth += request.direction === "right" ? -STEP_RADIANS : STEP_RADIANS;
    } else {
      const stepped = nextElevation + (request.direction === "up" ? STEP_RADIANS : -STEP_RADIANS);
      // Past the Top or Bottom landmark: rather than stopping dead (there's no "further"
      // along this ring), tip on over the pole and keep going down the opposite side —
      // the same continuous tumble a real cube does when you keep rotating it one way,
      // rather than treating the pole as a wall.
      if (stepped > Math.PI / 2 + 1e-6 || stepped < -Math.PI / 2 - 1e-6) {
        nextElevation = Math.sign(stepped) * Math.PI - stepped;
        nextAzimuth += Math.PI;
      } else {
        nextElevation = MathUtils.clamp(stepped, -Math.PI / 2, Math.PI / 2);
      }
    }

    // Nudge an exact pole landmark very slightly off it — see `POLE_EPSILON_RADIANS`'s own
    // comment — rather than leaving azimuth truly undefined there.
    if (Math.abs(nextElevation) >= Math.PI / 2 - 1e-9) {
      nextElevation = Math.sign(nextElevation) * (Math.PI / 2 - POLE_EPSILON_RADIANS);
    }

    const nextDirection = azimuthElevationToDirection(nextAzimuth, nextElevation);
    camera.position.copy(target).addScaledVector(nextDirection, distance);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    controls?.update();
    invalidate();
    // Only the request itself should re-trigger this — camera/controls are read at the
    // moment the arrow is clicked, not watched for their own changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  return null;
}
