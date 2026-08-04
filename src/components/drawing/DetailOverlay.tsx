import { useRef } from "react";
import { Check, X } from "lucide-react";

import { runCreateDetailView } from "@/commands/drawingCommands";
import { useDocumentStore } from "@/state/documentStore";
import { useDrawingToolStore } from "@/state/drawingToolStore";

import styles from "./DrawingSheet.module.css";

/** px per sheet-mm at the outer sheet `<svg>`'s own fixed render size — see
 * `SectionOverlay.tsx`'s own doc comment on the same constant. */
const SHEET_SCALE = 2.5;

/**
 * The interactive crop-circle overlay for `drawing.detail` — appears once a view has been
 * picked. Drag the circle's body to move it, the small handle on its edge to resize it;
 * Confirm creates the detail view via `commands/drawingCommands.ts`'s `runCreateDetailView`
 * (a synchronous crop of already-projected data, no kernel rebuild needed).
 */
export function DetailOverlay() {
  const sourceViewId = useDrawingToolStore((state) => state.detailSourceViewId);
  const cx = useDrawingToolStore((state) => state.detailCentreX);
  const cy = useDrawingToolStore((state) => state.detailCentreY);
  const radius = useDrawingToolStore((state) => state.detailRadius);
  const setCircle = useDrawingToolStore((state) => state.setDetailCircle);
  const resetPicking = useDrawingToolStore((state) => state.resetPicking);

  const view = useDocumentStore((state) => state.document.drawing?.views.find((v) => v.id === sourceViewId));
  const moveOrigin = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const resizeOrigin = useRef<{ x: number; radius: number } | null>(null);

  if (!view) return null;

  const width = view.width * view.scale;
  const height = view.height * view.scale;
  const left = view.x - width / 2;
  const top = view.y - height / 2;
  // `cx`/`cy`/`radius` live in the source view's own unscaled local space (matching
  // `detailOf`'s own doc comment); this is the one place that maps them into sheet space
  // for on-screen dragging.
  const sheetCx = left + cx * view.scale;
  const sheetCy = top + cy * view.scale;
  const sheetR = radius * view.scale;

  return (
    <g>
      <circle cx={sheetCx} cy={sheetCy} r={sheetR} className={styles.detailCircle} />
      <circle
        cx={sheetCx}
        cy={sheetCy}
        r={Math.max(sheetR - 3, 2)}
        className={styles.detailCentreHit}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          moveOrigin.current = { x: event.clientX, y: event.clientY, cx, cy };
        }}
        onPointerMove={(event) => {
          if (!moveOrigin.current) return;
          const dx = (event.clientX - moveOrigin.current.x) / (SHEET_SCALE * view.scale);
          const dy = (event.clientY - moveOrigin.current.y) / (SHEET_SCALE * view.scale);
          setCircle(moveOrigin.current.cx + dx, moveOrigin.current.cy + dy, radius);
        }}
        onPointerUp={() => {
          moveOrigin.current = null;
        }}
      />
      <circle
        cx={sheetCx + sheetR}
        cy={sheetCy}
        r={3}
        className={styles.detailRadiusHandle}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeOrigin.current = { x: event.clientX, radius };
        }}
        onPointerMove={(event) => {
          if (!resizeOrigin.current) return;
          event.stopPropagation();
          const dx = (event.clientX - resizeOrigin.current.x) / (SHEET_SCALE * view.scale);
          setCircle(cx, cy, Math.max(resizeOrigin.current.radius + dx, 3));
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          resizeOrigin.current = null;
        }}
      />

      <foreignObject x={Math.max(left, 2)} y={Math.max(top - 12, 2)} width={80} height={22}>
        <div className={styles.overlayToolbar}>
          <button
            type="button"
            className={`${styles.overlayButton} ${styles.overlayButtonPrimary}`}
            title="Create detail view"
            onClick={() => runCreateDetailView(view, cx, cy, radius)}
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
