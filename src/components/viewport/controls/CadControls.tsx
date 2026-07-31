import { useEffect, useMemo, useRef } from "react";
import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { MOUSE } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { MAX_ZOOM_DISTANCE, MIN_ZOOM_DISTANCE } from "../constants";
import { useModifierKeys } from "./useModifierKeys";

/**
 * Orbit, pan and zoom with SolidWorks mouse bindings.
 *
 *   middle drag           orbit
 *   Ctrl  + middle drag   pan
 *   Shift + middle drag   zoom
 *   wheel                 zoom towards the cursor
 *
 * Left and right buttons are deliberately left unbound: left belongs to entity selection
 * from Step 4, and right opens the context menu.
 */
export function CadControls() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { ctrl, shift } = useModifierKeys();
  const gl = useThree((state) => state.gl);

  const mouseButtons = useMemo(() => {
    if (ctrl) {
      return { MIDDLE: MOUSE.PAN };
    }
    if (shift) {
      return { MIDDLE: MOUSE.DOLLY };
    }
    return { MIDDLE: MOUSE.ROTATE };
  }, [ctrl, shift]);

  // Chromium starts its autoscroll gesture on middle mouse down, which fights the orbit
  // drag and leaves the scroll cursor stuck on screen. Suppressing the default on the
  // canvas keeps the middle button available for navigation.
  useEffect(() => {
    const canvas = gl.domElement;

    const suppressAutoscroll = (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    };

    canvas.addEventListener("mousedown", suppressAutoscroll);
    canvas.addEventListener("auxclick", suppressAutoscroll);

    return () => {
      canvas.removeEventListener("mousedown", suppressAutoscroll);
      canvas.removeEventListener("auxclick", suppressAutoscroll);
    };
  }, [gl]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      // Inertia feels imprecise when placing geometry, and damping would need a render
      // loop running every frame rather than only on change.
      enableDamping={false}
      zoomToCursor
      mouseButtons={mouseButtons}
      minDistance={MIN_ZOOM_DISTANCE}
      maxDistance={MAX_ZOOM_DISTANCE}
      // Pan across the screen plane rather than the ground plane, which is what CAD
      // users expect when dragging a model sideways.
      screenSpacePanning
    />
  );
}
