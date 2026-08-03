import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

import { useViewportStore } from "@/state/viewportStore";

/**
 * Captures the current WebGL frame as a data URL on "Print", invoked from the ribbon —
 * outside the r3f tree, so it can only reach the renderer via `printRequest` the same way
 * `ZoomToFit.tsx` reaches the camera. `Viewport.tsx` sets `preserveDrawingBuffer: true` on
 * the renderer specifically so `toDataURL()` here reads the frame actually on screen
 * rather than a buffer the browser already cleared after compositing.
 *
 * Renders nothing; it exists purely to run the effect below.
 */
export function PrintCapture() {
  const request = useViewportStore((state) => state.printRequest);
  const setPrintSnapshot = useViewportStore((state) => state.setPrintSnapshot);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    if (request === 0) return;
    setPrintSnapshot(gl.domElement.toDataURL("image/png"));
    // Only the request counter should re-trigger this — `gl` is read at the moment the
    // button is pressed, not watched for its own identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  return null;
}
