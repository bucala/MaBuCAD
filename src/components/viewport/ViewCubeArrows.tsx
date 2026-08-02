import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCcw, RotateCw } from "lucide-react";

import { useSettingsStore } from "@/state/settingsStore";
import { useViewportStore } from "@/state/viewportStore";

import styles from "./ViewCubeArrows.module.css";

const ARROWS = [
  { direction: "up" as const, Icon: ChevronUp, className: "up", label: "Rotate view up" },
  { direction: "down" as const, Icon: ChevronDown, className: "down", label: "Rotate view down" },
  { direction: "left" as const, Icon: ChevronLeft, className: "left", label: "Rotate view left" },
  { direction: "right" as const, Icon: ChevronRight, className: "right", label: "Rotate view right" },
];

/** Diagonal corner buttons, distinct in both position and icon from the four pan arrows
 * above — they spin the horizon (roll) rather than orbiting around the model. */
const ROLL_ARROWS = [
  { direction: "roll-ccw" as const, Icon: RotateCcw, className: "rollTopLeft", label: "Rotate view counter-clockwise" },
  { direction: "roll-cw" as const, Icon: RotateCw, className: "rollBottomRight", label: "Rotate view clockwise" },
];

/**
 * Arrow buttons ringing the ViewCube, for stepping the view by a fixed angle without
 * having to grab it directly — the ViewCube itself (`GizmoViewcube` in `Scene.tsx`) only
 * jumps straight to a face/edge/corner's canonical orientation, which is not always what
 * you want. Four step the camera around the model (up/down/left/right); two more, at the
 * diagonal corners, roll the camera's own up vector around the current view axis instead
 * — the view keeps looking at exactly the same thing, only the horizon tilts.
 *
 * A plain DOM overlay rather than more Hud geometry, for the same reason `SketchContextMenu`
 * is one (see its own doc comment): it needs to sit reliably on top of the canvas without
 * fighting for pixels inside the ViewCube's own render pass. Reaches the camera via
 * `viewportStore`'s `rotateStepRequest` — see `ViewRotationSteps.tsx`, which does the actual
 * rotation inside the r3f tree.
 */
export function ViewCubeArrows() {
  const viewCubeVisible = useSettingsStore((state) => state.viewCubeVisible);
  const requestRotateStep = useViewportStore((state) => state.requestRotateStep);

  if (!viewCubeVisible) return null;

  return (
    <div className={styles.ring} aria-hidden={false}>
      {[...ARROWS, ...ROLL_ARROWS].map(({ direction, Icon, className, label }) => (
        <button
          key={direction}
          type="button"
          className={`${styles.arrow} ${styles[className]}`}
          title={label}
          aria-label={label}
          onClick={() => requestRotateStep(direction)}
        >
          <Icon size={12} />
        </button>
      ))}
    </div>
  );
}
