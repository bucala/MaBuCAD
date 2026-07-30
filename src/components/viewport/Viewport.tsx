import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Box, Frame } from "lucide-react";

import { Scene } from "./scene/Scene";
import type { ProjectionMode } from "./scene/CameraRig";
import { SketchContextMenu } from "./sketch/SketchContextMenu";
import { ViewportContextMenu } from "./ViewportContextMenu";
import styles from "./Viewport.module.css";

const PROJECTIONS: { id: ProjectionMode; label: string; icon: typeof Box; title: string }[] = [
  {
    id: "orthographic",
    label: "Ortho",
    icon: Frame,
    title: "Orthographic — parallel projection, equal lengths measure equal on screen",
  },
  {
    id: "perspective",
    label: "Persp",
    icon: Box,
    title: "Perspective — natural depth, for presentation views",
  },
];

/**
 * Graphics area.
 *
 * `frameloop="demand"` renders only when something actually changes, which is the right
 * behaviour for a modelling tool: a static model costs nothing, and navigation still runs
 * at full rate because the controls invalidate on every change.
 */
export function Viewport() {
  const [projection, setProjection] = useState<ProjectionMode>("orthographic");

  return (
    <div className={styles.viewport}>
      <Canvas
        className={styles.canvas}
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <Scene projection={projection} />
      </Canvas>

      <div className={styles.toolbar} role="group" aria-label="Projection">
        {PROJECTIONS.map(({ id, label, icon: Icon, title }) => (
          <button
            key={id}
            type="button"
            className={styles.toolbarButton}
            aria-pressed={projection === id}
            title={title}
            onClick={() => setProjection(id)}
          >
            <Icon size={14} strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </div>

      <div className={styles.originGizmo} aria-hidden="true">
        <span className={styles.axis}>
          <span className={`${styles.axisSwatch} ${styles.axisX}`} />X
        </span>
        <span className={styles.axis}>
          <span className={`${styles.axisSwatch} ${styles.axisY}`} />Y
        </span>
        <span className={styles.axis}>
          <span className={`${styles.axisSwatch} ${styles.axisZ}`} />Z
        </span>
      </div>

      <div className={styles.hint}>
        Middle drag orbit · Ctrl+middle pan · Shift+middle or wheel zoom
      </div>

      {/* Renders nothing outside sketch mode — SketchCanvas is the only thing that ever
          opens it, and it lives here (a plain DOM sibling of the Canvas) rather than
          inside the Canvas tree; see SketchContextMenu's own doc comment for why. */}
      <SketchContextMenu />

      {/* Same reasoning as SketchContextMenu, opened instead by ReferencePlanes/SolidModel
          for a right-click on a plane or the modelled solid. */}
      <ViewportContextMenu />
    </div>
  );
}
