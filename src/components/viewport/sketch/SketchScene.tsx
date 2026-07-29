import { useEffect } from "react";
import { Grid } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Vector3 } from "three";

import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { planeBasis } from "@/sketch/planeBasis";
import { selectActiveSketch, useSketchStore } from "@/state/sketchStore";

import { DOCUMENT_SCALE } from "../constants";
import { SketchCanvas } from "./SketchCanvas";
import { SketchDimensions } from "./SketchDimensions";
import { SketchGeometry } from "./SketchGeometry";

/**
 * Everything that appears while a sketch is open: the aligned camera, an in-plane grid,
 * the geometry, its dimensions and the pointer surface that draws them.
 */
export function SketchScene() {
  const sketch = useSketchStore(selectActiveSketch);
  const isDark = useIsDarkTheme();

  if (!sketch) return null;

  const basis = planeBasis(sketch.planeId);

  return (
    <group rotation={basis.rotation as unknown as [number, number, number]}>
      <SketchCameraAlignment planeId={sketch.planeId} />

      {/* Grid drawn in the sketch plane rather than on the ground, so it reads as
          graph paper under the profile. */}
      <Grid
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, -0.05]}
        infiniteGrid
        cellSize={DOCUMENT_SCALE / 20}
        cellThickness={0.6}
        cellColor={isDark ? "#4c525a" : "#c3cdd8"}
        sectionSize={DOCUMENT_SCALE / 2}
        sectionThickness={1}
        sectionColor={isDark ? "#69737f" : "#9bacbd"}
        fadeDistance={DOCUMENT_SCALE * 10}
        fadeStrength={1}
        side={2}
        raycast={() => null}
      />

      <SketchCanvas sketch={sketch} />
      <SketchGeometry sketch={sketch} isDark={isDark} />
      <SketchDimensions sketch={sketch} />
    </group>
  );
}

/**
 * Looks straight down the sketch plane's normal when sketch mode opens.
 *
 * Sketching is a 2D task, so the view is squared up once on entry; the user is still free
 * to orbit away afterwards.
 */
function SketchCameraAlignment({ planeId }: { planeId: string }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const basis = planeBasis(planeId);
    const distance = camera.position.length() || DOCUMENT_SCALE * 2.5;

    camera.position.copy(basis.normal.clone().multiplyScalar(distance));
    camera.up.copy(basis.up);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const orbit = controls as { target?: Vector3; update?: () => void } | null;
    orbit?.target?.set(0, 0, 0);
    orbit?.update?.();

    invalidate();
  }, [planeId, camera, controls, invalidate]);

  return null;
}
