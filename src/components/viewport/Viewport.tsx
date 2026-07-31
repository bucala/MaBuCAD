import { Canvas } from "@react-three/fiber";

import { useViewportStore } from "@/state/viewportStore";

import { Scene } from "./scene/Scene";
import { SketchContextMenu } from "./sketch/SketchContextMenu";
import styles from "./Viewport.module.css";

/**
 * Graphics area.
 *
 * `frameloop="demand"` renders only when something actually changes, which is the right
 * behaviour for a modelling tool: a static model costs nothing, and navigation still runs
 * at full rate because the controls invalidate on every change.
 */
export function Viewport() {
  const projection = useViewportStore((state) => state.projection);

  return (
    <div className={styles.viewport}>
      <Canvas
        className={styles.canvas}
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        {/* Line pick tolerance is applied inside the tree, not here via `onCreated` — see
            `RaycasterTuning.tsx`: it needs to react to the Settings dialog changing the
            value live, not just set it once at canvas creation. */}
        <Scene projection={projection} />
      </Canvas>

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

      {/* FeatureContextMenu (opened by ReferencePlanes/SolidModel for a right-click on a
          plane or the modelled solid) is mounted once at the app's top level, not here —
          see its own doc comment for why: the same global store this viewport uses to
          open it is also what the Feature Manager tree opens it from. */}
    </div>
  );
}
