import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

import { useSettingsStore } from "@/state/settingsStore";
import { useViewportStore } from "@/state/viewportStore";

import styles from "./ViewCubeArrows.module.css";

const ARROWS = [
  { direction: "up" as const, Icon: ChevronUp, className: "up", label: "Rotate view up" },
  { direction: "down" as const, Icon: ChevronDown, className: "down", label: "Rotate view down" },
  { direction: "left" as const, Icon: ChevronLeft, className: "left", label: "Rotate view left" },
  { direction: "right" as const, Icon: ChevronRight, className: "right", label: "Rotate view right" },
];

/**
 * Four arrow buttons ringing the ViewCube, for stepping the view by a fixed angle without
 * having to grab it directly — the ViewCube itself (`GizmoViewcube` in `Scene.tsx`) only
 * jumps straight to a face/edge/corner's canonical orientation, which is not always what
 * you want.
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
      {ARROWS.map(({ direction, Icon, className, label }) => (
        <button
          key={direction}
          type="button"
          className={`${styles.arrow} ${styles[className]}`}
          title={label}
          aria-label={label}
          onClick={() => requestRotateStep(direction)}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
