import { useEffect } from "react";
import { Grid } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Vector3 } from "three";

import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { usePlaneFrame } from "@/hooks/usePlaneFrame";
import type { PlaneFrame } from "@/sketch/planeBasis";
import { selectActiveSketch, useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";
import { mixHex } from "@/utils/colorMix";

import { DOCUMENT_SCALE, VIEWPORT_BG_APPROX } from "../constants";
import { DragSnapIndicator } from "./DragSnapIndicator";
import { SketchCanvas } from "./SketchCanvas";
import { SketchConstraintGlyphs } from "./SketchConstraintGlyphs";
import { SketchDimensions, SmartDimensionPreview } from "./SketchDimensions";
import { SketchGeometry } from "./SketchGeometry";

/**
 * Everything that appears while a sketch is open: the aligned camera, an in-plane grid,
 * the geometry, its dimensions and the pointer surface that draws them.
 */
export function SketchScene() {
  const sketch = useSketchStore(selectActiveSketch);
  const isDark = useIsDarkTheme();
  const gridVisible = useViewportStore((state) => state.gridVisible);

  if (!sketch) return null;
  return <ActiveSketchScene sketch={sketch} isDark={isDark} gridVisible={gridVisible} />;
}

function ActiveSketchScene({
  sketch,
  isDark,
  gridVisible,
}: {
  sketch: NonNullable<ReturnType<typeof selectActiveSketch>>;
  isDark: boolean;
  gridVisible: boolean;
}) {
  const frame = usePlaneFrame(sketch.planeId);
  const bg = isDark ? VIEWPORT_BG_APPROX.dark : VIEWPORT_BG_APPROX.light;

  return (
    <group position={frame.origin} quaternion={frame.quaternion}>
      <SketchCameraAlignment frame={frame} />

      {/* Grid drawn in the sketch plane rather than on the ground, so it reads as graph
          paper under the profile. Shares the status bar's grid-hide toggle with the 3D
          viewport's own ground grid, rather than having its own — they're never both
          visible at once, so one switch is enough. */}
      {gridVisible && (
        <Grid
          rotation={[Math.PI / 2, 0, 0]}
          position={[0, 0, -0.05]}
          infiniteGrid
          cellSize={DOCUMENT_SCALE / 20}
          cellThickness={0.6}
          cellColor={mixHex(isDark ? "#4c525a" : "#c3cdd8", bg, 0.5)}
          sectionSize={DOCUMENT_SCALE / 2}
          sectionThickness={1}
          sectionColor={mixHex(isDark ? "#69737f" : "#9bacbd", bg, 0.5)}
          fadeDistance={DOCUMENT_SCALE * 10}
          fadeStrength={1}
          side={2}
          raycast={() => null}
        />
      )}

      <SketchCanvas sketch={sketch} />
      <SketchGeometry sketch={sketch} isDark={isDark} />
      <SketchDimensions sketch={sketch} />
      <SmartDimensionPreview sketch={sketch} />
      <DragSnapIndicator />
      <SketchConstraintGlyphs sketch={sketch} />
    </group>
  );
}

/**
 * Looks straight down the sketch plane's normal when sketch mode opens.
 *
 * Sketching is a 2D task, so the view is squared up once on entry; the user is still free
 * to orbit away afterwards.
 */
function SketchCameraAlignment({ frame }: { frame: PlaneFrame }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const invalidate = useThree((state) => state.invalidate);

  // Re-aligns only when the plane itself changes orientation or position (a different
  // sketch, or an edited offset) — not on every unrelated document edit.
  const key = [frame.origin.toArray(), frame.quaternion.toArray()].flat().map((n) => n.toFixed(6)).join(",");
  useEffect(() => {
    const distance = camera.position.clone().sub(frame.origin).length() || DOCUMENT_SCALE * 2.5;

    camera.position.copy(frame.origin).addScaledVector(frame.normal, distance);
    camera.up.copy(frame.up);
    camera.lookAt(frame.origin);
    camera.updateProjectionMatrix();

    const orbit = controls as { target?: Vector3; update?: () => void } | null;
    orbit?.target?.copy(frame.origin);
    orbit?.update?.();

    invalidate();
    // `frame` is captured through `key`, which changes exactly when its placement does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, camera, controls, invalidate]);

  return null;
}
