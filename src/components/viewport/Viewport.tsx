import { Rotate3d } from "lucide-react";

import styles from "./Viewport.module.css";

/**
 * Graphics area.
 *
 * Step 1 only establishes the surface, its overlay slots and the sizing behaviour. The
 * react-three-fiber canvas, orbit controls, default planes and navigation cube land in
 * Step 2 without changing anything around this component.
 */
export function Viewport() {
  return (
    <div className={styles.viewport}>
      <div className={styles.canvasSlot}>
        <span className={styles.placeholderIcon} aria-hidden="true">
          <Rotate3d size={44} strokeWidth={1.25} />
        </span>
        <span className={styles.placeholderTitle}>Graphics area</span>
        <p className={styles.placeholderBody}>
          The 3D viewport is mounted here in Step 2, together with orbit, pan and zoom
          navigation, the default Front, Top and Right planes, and the origin triad.
        </p>
      </div>

      <div className={styles.navCubeSlot} aria-hidden="true">
        Navigation
        <br />
        cube
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
    </div>
  );
}
