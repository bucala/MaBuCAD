import { Check, MoveHorizontal, MoveVertical, X } from "lucide-react";

import { runCreateAuxiliaryView } from "@/commands/drawingCommands";
import { useDocumentStore } from "@/state/documentStore";
import { useDrawingToolStore } from "@/state/drawingToolStore";

import styles from "./DrawingSheet.module.css";

/** Configuration overlay for a supplementary projection. The bounded slider keeps the
 * interaction understandable: this is a 30° default auxiliary tilt, not an arbitrary
 * camera-authoring tool. */
export function AuxiliaryOverlay() {
  const sourceViewId = useDrawingToolStore((state) => state.auxiliarySourceViewId);
  const axis = useDrawingToolStore((state) => state.auxiliaryTiltAxis);
  const angle = useDrawingToolStore((state) => state.auxiliaryAngle);
  const setTilt = useDrawingToolStore((state) => state.setAuxiliaryTilt);
  const resetPicking = useDrawingToolStore((state) => state.resetPicking);
  const view = useDocumentStore((state) => state.document.drawing?.views.find((candidate) => candidate.id === sourceViewId));

  if (!view) return null;

  const width = view.width * view.scale;
  const height = view.height * view.scale;
  const left = view.x - width / 2;
  const top = view.y - height / 2;

  return (
    <g>
      <rect x={left} y={top} width={width} height={height} className={styles.auxiliarySource} />
      <foreignObject x={Math.max(left, 2)} y={Math.max(top - 12, 2)} width={260} height={24}>
        <div className={styles.overlayToolbar}>
          <button
            type="button"
            className={styles.overlayButton}
            title="Tilt around horizontal screen axis"
            aria-pressed={axis === "horizontal"}
            onClick={() => setTilt("horizontal", angle)}
          >
            <MoveHorizontal size={12} />
          </button>
          <button
            type="button"
            className={styles.overlayButton}
            title="Tilt around vertical screen axis"
            aria-pressed={axis === "vertical"}
            onClick={() => setTilt("vertical", angle)}
          >
            <MoveVertical size={12} />
          </button>
          <input
            type="range"
            min={-60}
            max={60}
            step={5}
            value={angle}
            aria-label="Auxiliary tilt angle"
            onChange={(event) => setTilt(axis, Number(event.target.value))}
          />
          <span className={styles.overlayValue}>{angle}°</span>
          <button
            type="button"
            className={`${styles.overlayButton} ${styles.overlayButtonPrimary}`}
            title="Create auxiliary view"
            onClick={() => void runCreateAuxiliaryView(view, axis, angle)}
          >
            <Check size={12} />
          </button>
          <button type="button" className={styles.overlayButton} title="Cancel" onClick={resetPicking}>
            <X size={12} />
          </button>
        </div>
      </foreignObject>
    </g>
  );
}
