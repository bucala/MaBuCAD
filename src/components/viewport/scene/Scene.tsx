import { useState } from "react";
import { GizmoHelper, GizmoViewcube } from "@react-three/drei";

import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";

import { CadControls } from "../controls/CadControls";
import type { ReferencePlaneId } from "../constants";
import { CameraRig, type ProjectionMode } from "./CameraRig";
import { Origin } from "./Origin";
import { ReferencePlanes } from "./ReferencePlanes";
import { ViewportGrid } from "./ViewportGrid";

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
  const [selectedPlaneId, setSelectedPlaneId] = useState<ReferencePlaneId | null>(null);
  const isDark = useIsDarkTheme();

  return (
    <>
      <CameraRig mode={projection} />
      <CadControls />

      <ambientLight intensity={1.6} />
      <directionalLight position={[1, 2, 3]} intensity={1.2} />

      <ViewportGrid />
      <ReferencePlanes selectedId={selectedPlaneId} onSelect={setSelectedPlaneId} />
      <Origin />

      <GizmoHelper alignment="top-right" margin={[86, 86]}>
        <GizmoViewcube
          color={isDark ? "#3a3f45" : "#e8ecf0"}
          textColor={isDark ? "#ffffff" : "#1a1a1a"}
          strokeColor={isDark ? "#7b8593" : "#5d6b7a"}
          hoverColor={isDark ? "#4cc2ff" : "#0078d4"}
        />
      </GizmoHelper>
    </>
  );
}
