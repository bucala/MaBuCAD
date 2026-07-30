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
        onCreated={(state) => {
          // Widens the invisible click-hit area around a sketch line beyond its drawn
          // pixel width (Line2's own raycast adds this threshold, in screen pixels,
          // straight onto `material.linewidth` — see three's LineSegments2.raycast) — a
          // 1-3px line is otherwise a needle to actually click. `Line2` isn't part of
          // three's own `RaycasterParameters` type (it's an examples/jsm addition reading
          // this object by convention, not a declared field), so it's set here on the
          // live raycaster rather than through the strictly-typed `raycaster` prop.
          const params = state.raycaster.params as unknown as Record<string, { threshold?: number } | undefined>;
          params.Line = { ...params.Line, threshold: 6 };
          params.Line2 = { ...params.Line2, threshold: 6 };
        }}
      >
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
