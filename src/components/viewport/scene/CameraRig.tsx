import { useEffect, useRef } from "react";
import { OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { OrthographicCamera as OrthographicCameraImpl, PerspectiveCamera as PerspectiveCameraImpl } from "three";
import { Vector3 } from "three";

import { DEFAULT_CAMERA_POSITION, DOCUMENT_SCALE } from "../constants";

export type ProjectionMode = "orthographic" | "perspective";

interface CameraRigProps {
  mode: ProjectionMode;
}

/**
 * Supplies the active camera.
 *
 * Orthographic is the default because parallel projection is what makes equal lengths
 * measure equal on screen — the reason engineering software works this way. Switching to
 * perspective keeps the current eye position and orbit target, so the view does not jump.
 */
export function CameraRig({ mode }: CameraRigProps) {
  const orthographicRef = useRef<OrthographicCameraImpl>(null);
  const perspectiveRef = useRef<PerspectiveCameraImpl>(null);
  const controls = useThree((state) => state.controls);

  // Carry the eye position across a projection change rather than snapping back to the
  // default view.
  const lastPosition = useRef(new Vector3(...DEFAULT_CAMERA_POSITION));

  useEffect(() => {
    const incoming = mode === "orthographic" ? orthographicRef.current : perspectiveRef.current;
    if (!incoming) return;

    // The Vector3 is captured once per run rather than re-read from the ref in the
    // cleanup: the ref's `.current` is never reassigned (only copied in and out of), but
    // reading a ref during cleanup reads whatever it holds *then*, which the
    // react-hooks lint rightly refuses to let pass silently.
    const last = lastPosition.current;
    incoming.position.copy(last);
    incoming.updateProjectionMatrix();

    return () => {
      last.copy(incoming.position);
    };
  }, [mode]);

  // The controls hold their own reference to the camera object, so they need to be told
  // when it is swapped out from underneath them.
  useEffect(() => {
    if (controls) {
      (controls as { update?: () => void }).update?.();
    }
  }, [controls, mode]);

  return mode === "orthographic" ? (
    <OrthographicCamera
      ref={orthographicRef}
      makeDefault
      position={DEFAULT_CAMERA_POSITION}
      // With makeDefault the frustum is sized in pixels, so one world unit spans `zoom`
      // pixels. 5 puts the 100 mm reference planes at roughly half the viewport height,
      // matching what the perspective camera shows from the same position.
      zoom={5}
      near={-DOCUMENT_SCALE * 100}
      far={DOCUMENT_SCALE * 100}
    />
  ) : (
    <PerspectiveCamera
      ref={perspectiveRef}
      makeDefault
      position={DEFAULT_CAMERA_POSITION}
      fov={40}
      near={DOCUMENT_SCALE * 0.01}
      far={DOCUMENT_SCALE * 100}
    />
  );
}
