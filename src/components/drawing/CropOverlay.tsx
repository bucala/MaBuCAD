import { Check, X } from "lucide-react";
import { useRef } from "react";

import { runCreateCropView } from "@/commands/drawingCommands";
import { useDocumentStore } from "@/state/documentStore";
import { useDrawingToolStore } from "@/state/drawingToolStore";

import styles from "./DrawingSheet.module.css";

const SHEET_SCALE = 2.5;

/** Rectangular crop configuration. The crop stays in the source view's local coordinates
 * and is therefore independent of where the source view is dragged on the sheet. */
export function CropOverlay() {
  const sourceViewId = useDrawingToolStore((state) => state.cropSourceViewId);
  const cropX = useDrawingToolStore((state) => state.cropX);
  const cropY = useDrawingToolStore((state) => state.cropY);
  const cropWidth = useDrawingToolStore((state) => state.cropWidth);
  const cropHeight = useDrawingToolStore((state) => state.cropHeight);
  const setCropRect = useDrawingToolStore((state) => state.setCropRect);
  const resetPicking = useDrawingToolStore((state) => state.resetPicking);
  const zoom = useDrawingToolStore((state) => state.zoom);
  const view = useDocumentStore((state) => state.document.drawing?.views.find((candidate) => candidate.id === sourceViewId));
  const moveOrigin = useRef<{ x: number; y: number; cropX: number; cropY: number } | null>(null);
  const resizeOrigin = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  if (!view) return null;

  const left = view.x - (view.width * view.scale) / 2;
  const top = view.y - (view.height * view.scale) / 2;
  const sheetX = left + cropX * view.scale;
  const sheetY = top + cropY * view.scale;
  const sheetWidth = cropWidth * view.scale;
  const sheetHeight = cropHeight * view.scale;

  return (
    <g>
      <rect x={sheetX} y={sheetY} width={sheetWidth} height={sheetHeight} className={styles.cropRect} />
      <rect
        x={sheetX + 3}
        y={sheetY + 3}
        width={Math.max(sheetWidth - 6, 2)}
        height={Math.max(sheetHeight - 6, 2)}
        className={styles.cropMoveHit}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          moveOrigin.current = { x: event.clientX, y: event.clientY, cropX, cropY };
        }}
        onPointerMove={(event) => {
          if (!moveOrigin.current) return;
          const dx = (event.clientX - moveOrigin.current.x) / (SHEET_SCALE * zoom * view.scale);
          const dy = (event.clientY - moveOrigin.current.y) / (SHEET_SCALE * zoom * view.scale);
          setCropRect(moveOrigin.current.cropX + dx, moveOrigin.current.cropY + dy, cropWidth, cropHeight);
        }}
        onPointerUp={() => {
          moveOrigin.current = null;
        }}
      />
      <rect
        x={sheetX + sheetWidth - 3}
        y={sheetY + sheetHeight - 3}
        width={6}
        height={6}
        className={styles.cropResizeHandle}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeOrigin.current = { x: event.clientX, y: event.clientY, width: cropWidth, height: cropHeight };
        }}
        onPointerMove={(event) => {
          if (!resizeOrigin.current) return;
          event.stopPropagation();
          const dx = (event.clientX - resizeOrigin.current.x) / (SHEET_SCALE * zoom * view.scale);
          const dy = (event.clientY - resizeOrigin.current.y) / (SHEET_SCALE * zoom * view.scale);
          setCropRect(cropX, cropY, resizeOrigin.current.width + dx, resizeOrigin.current.height + dy);
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
            title="Create crop view"
            onClick={() => runCreateCropView(view, cropX, cropY, cropWidth, cropHeight)}
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
