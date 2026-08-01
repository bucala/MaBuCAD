import { useEffect } from "react";
import { GizmoHelper, GizmoViewcube, GizmoViewport } from "@react-three/drei";
import { useThree } from "@react-three/fiber";

import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { useSceneAccentColor } from "@/hooks/useSceneAccentColor";

import { useSettingsStore } from "@/state/settingsStore";
import { selectIsSketchMode, useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";

import { AXIS_COLORS } from "../constants";
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
import { ViewRotationSteps } from "./ViewRotationSteps";
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
  const viewCubeVisible = useSettingsStore((state) => state.viewCubeVisible);
  const accent = useSceneAccentColor();
  const invalidate = useThree((state) => state.invalidate);

  // Both toggles are flipped from the DOM (the status bar, the Settings dialog) rather
  // than from inside this render loop, so under `frameloop="demand"` the mount/unmount
  // they cause needs an explicit repaint — see `Origin.tsx`'s own note on the same gap.
  useEffect(() => {
    invalidate();
  }, [gridVisible, viewCubeVisible, invalidate]);

  return (
    <>
      <CameraRig mode={projection} />
      <CadControls />
      <ZoomToFit />
      <ViewRotationSteps />
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

      {viewCubeVisible && (
        <GizmoHelper alignment="top-right" margin={[86, 86]}>
          <GizmoViewcube
            color={isDark ? "#3a3f45" : "#e8ecf0"}
            textColor={isDark ? "#ffffff" : "#1a1a1a"}
            strokeColor={isDark ? "#7b8593" : "#5d6b7a"}
            hoverColor={accent}
          />
        </GizmoHelper>
      )}

      {/* Replaces the old bottom-left legend, a static SVG drawn outside the Canvas that
          never actually rotated with the camera despite looking like it should — this one
          is a real 3D object GizmoHelper keeps in sync with the main camera, the same way
          the ViewCube above already is.
          `renderPriority={2}` is required here: drei's `Hud` re-clears and redraws the
          *entire* main scene whenever it sees the default `renderPriority` of 1, so a
          second `GizmoHelper` left at the default fights the ViewCube's — whichever one's
          frame callback runs last wins and the other's overlay gets wiped before the frame
          ever reaches the screen. A distinct, higher priority makes this one layer on top
          instead of clearing and redrawing everything again. Purely a visual orientation
          reference, not a control surface — the ViewCube above is where alignment clicks
          belong — `disabled` turns off GizmoViewport's own hover/click-to-snap behaviour. */}
      <GizmoHelper alignment="bottom-left" margin={[64, 64]} renderPriority={2}>
        <GizmoViewport
          axisColors={[AXIS_COLORS.x, AXIS_COLORS.y, AXIS_COLORS.z]}
          labelColor="#0a0a0a"
          hideNegativeAxes
          disabled
        />
      </GizmoHelper>
    </>
  );
}
