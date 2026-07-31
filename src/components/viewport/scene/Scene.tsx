import { GizmoHelper, GizmoViewcube } from "@react-three/drei";

import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { useSceneAccentColor } from "@/hooks/useSceneAccentColor";

import { selectIsSketchMode, useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";

import { CadControls } from "../controls/CadControls";
import { SolidModel } from "../model/SolidModel";
import { SketchScene } from "../sketch/SketchScene";
import { CameraRig, type ProjectionMode } from "./CameraRig";
import { InactiveSketches } from "./InactiveSketches";
import { Origin } from "./Origin";
import { RaycasterTuning } from "./RaycasterTuning";
import { ReferencePlanes } from "./ReferencePlanes";
import { UserReferenceGeometry } from "./UserReferenceGeometry";
import { ViewportGrid } from "./ViewportGrid";
import { ZoomToFit } from "./ZoomToFit";

interface SceneProps {
  projection: ProjectionMode;
}

/**
 * Contents of the graphics area.
 *
 * Lighting is deliberately flat for now: everything in the scene uses unlit basic
 * materials, and shaded solids only arrive with the geometry kernel in Step 5.
 */
export function Scene({ projection }: SceneProps) {
  const isDark = useIsDarkTheme();
  const isSketchMode = useSketchStore(selectIsSketchMode);
  const gridVisible = useViewportStore((state) => state.gridVisible);
  const accent = useSceneAccentColor();

  return (
    <>
      <CameraRig mode={projection} />
      <CadControls />
      <ZoomToFit />
      <RaycasterTuning />

      {/* Sketch and reference geometry are unlit, so this lighting exists purely to shade
          the solid: a key light for form, a weaker fill so back faces do not go black, and
          just enough ambient to keep shadowed faces readable. */}
      <ambientLight intensity={0.55} />
      <directionalLight position={[1, 2, 3]} intensity={1.5} />
      <directionalLight position={[-2, -1, -1.5]} intensity={0.45} />

      {/* The ground grid competes with the sketch's own in-plane grid, so it steps
          aside while a sketch is open. */}
      {!isSketchMode && gridVisible && <ViewportGrid />}
      <ReferencePlanes />
      <UserReferenceGeometry />
      <InactiveSketches />
      <Origin />
      <SolidModel />
      {isSketchMode && <SketchScene />}

      <GizmoHelper alignment="top-right" margin={[86, 86]}>
        <GizmoViewcube
          color={isDark ? "#3a3f45" : "#e8ecf0"}
          textColor={isDark ? "#ffffff" : "#1a1a1a"}
          strokeColor={isDark ? "#7b8593" : "#5d6b7a"}
          hoverColor={accent}
        />
      </GizmoHelper>
    </>
  );
}
