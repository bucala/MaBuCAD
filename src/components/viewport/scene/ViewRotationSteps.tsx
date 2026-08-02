import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { useViewportStore } from "@/state/viewportStore";

/** Degrees the camera orbits per arrow click — small enough to stay oriented, large
 * enough that a click is visibly a step rather than a nudge. */
const STEP_DEGREES = 45;
const STEP_RADIANS = (STEP_DEGREES * Math.PI) / 180;

/** How close the view is allowed to get to looking straight down/up the world Y axis —
 * past that the "left/right" horizontal axis becomes degenerate (gimbal lock), same
 * reason `OrbitControls` clamps `minPolarAngle`/`maxPolarAngle` by default. */
const POLE_GUARD_RADIANS = (5 * Math.PI) / 180;

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
    const offset = camera.position.clone().sub(target);
    const worldUp = new Vector3(0, 1, 0);

    if (request.direction === "left" || request.direction === "right") {
      // Right orbits the camera toward the model's right-hand side (bringing more of its
      // right-adjacent faces into view), not away from it.
      const angle = request.direction === "right" ? STEP_RADIANS : -STEP_RADIANS;
      offset.applyAxisAngle(worldUp, angle);
    } else {
      // Pitching around the camera's own local right axis tilts the view up/down without
      // introducing roll, since the camera is always looking straight at `target`.
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
      const angle = request.direction === "up" ? STEP_RADIANS : -STEP_RADIANS;
      const currentPolar = offset.angleTo(worldUp);
      const nextPolar = currentPolar - angle;
      if (nextPolar <= POLE_GUARD_RADIANS || nextPolar >= Math.PI - POLE_GUARD_RADIANS) {
        return;
      }
      offset.applyAxisAngle(right, angle);
    }

    camera.position.copy(target).add(offset);
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
