import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import type { Camera, Mesh } from "three";

// Reused across frames instead of allocated fresh each time — `useFrame` runs for every
// point/glyph in the sketch, so a per-call `new Vector3()` would otherwise churn garbage
// on every repaint while panning or zooming.
const _scratch = new Vector3();

/**
 * World units spanned by one screen-space pixel, evaluated at `worldPoint` — only matters
 * for a perspective camera, where the answer depends on distance to the camera.
 *
 * Exact, not approximated, for the app's default orthographic camera: with `makeDefault`
 * (see `CameraRig.tsx`'s own comment on this), one world unit spans exactly `camera.zoom`
 * pixels there, so `1 / zoom` is precise regardless of pan/zoom.
 */
export function worldUnitsPerPixel(camera: Camera, viewportHeightPx: number, worldPoint: Vector3): number {
  const asOrthographic = camera as unknown as { isOrthographicCamera?: boolean; zoom: number };
  if (asOrthographic.isOrthographicCamera) return 1 / asOrthographic.zoom;

  const asPerspective = camera as unknown as { isPerspectiveCamera?: boolean; fov: number };
  if (asPerspective.isPerspectiveCamera) {
    const distance = camera.position.distanceTo(worldPoint);
    const frustumHeightAtDistance = 2 * Math.tan((asPerspective.fov * Math.PI) / 360) * distance;
    return frustumHeightAtDistance / viewportHeightPx;
  }

  return 1;
}

/**
 * A ref to attach to a mesh built from unit-radius geometry (`circleGeometry args={[1, N]}`)
 * so it renders at a constant `pixels` size on screen regardless of camera zoom, instead of
 * growing/shrinking with the sketch the way a plain world-space radius does — the fix for
 * sketch point dots (and their invisible click targets) reading as "nonsensically large"
 * once zoomed in, or vanishing once zoomed out.
 *
 * Recomputed every frame via `useFrame` rather than once from a React prop: panning/orbiting
 * mutates the camera imperatively (`OrbitControls` et al.), which does not by itself trigger
 * a React re-render of this component, so a scale set only at mount would go stale the
 * moment the user zooms.
 */
export function useScreenSpacePixelScale(pixels: number) {
  const ref = useRef<Mesh>(null);
  useFrame(({ camera, size }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const worldPoint = mesh.getWorldPosition(_scratch);
    const scale = pixels * worldUnitsPerPixel(camera, size.height, worldPoint);
    mesh.scale.setScalar(scale);
  });
  return ref;
}
