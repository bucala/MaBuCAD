import { useEffect, useRef } from "react";
import { Check, FlipVertical2, MoveHorizontal, MoveVertical, X } from "lucide-react";

import { runCreateSectionView } from "@/commands/drawingCommands";
import { useDocumentStore } from "@/state/documentStore";
import { useDrawingToolStore } from "@/state/drawingToolStore";

import styles from "./DrawingSheet.module.css";

/** px per sheet-mm at the outer sheet `<svg>`'s own fixed render size — see
 * `DrawingSheet.tsx`'s `width={sheetWidth * SHEET_SCALE}`. Dragging on-screen pixels needs
 * dividing by this to land back in sheet-mm. */
const SHEET_SCALE = 2.5;

/**
 * The interactive cut-line overlay for `drawing.section` — appears once a Front/Top/Right
 * view has been picked (`DrawingSheet.tsx`'s own click handling on that view arms this via
 * `drawingToolStore.pickSectionSource`). A draggable line plus a small floating toolbar
 * (orientation, flip side, confirm, cancel); the actual kernel cut only happens on Confirm
 * (`commands/drawingCommands.ts`'s `runCreateSectionView`), so dragging itself is free —
 * no rebuild per pixel moved.
 */
export function SectionOverlay() {
  const sourceViewId = useDrawingToolStore((state) => state.sectionSourceViewId);
  const orientation = useDrawingToolStore((state) => state.sectionOrientation);
  const position = useDrawingToolStore((state) => state.sectionLocalPosition);
  const flipped = useDrawingToolStore((state) => state.sectionFlipped);
  const setOrientation = useDrawingToolStore((state) => state.setSectionOrientation);
  const setPosition = useDrawingToolStore((state) => state.setSectionLocalPosition);
  const toggleFlip = useDrawingToolStore((state) => state.toggleSectionFlip);
  const resetPicking = useDrawingToolStore((state) => state.resetPicking);

  const view = useDocumentStore((state) => state.document.drawing?.views.find((v) => v.id === sourceViewId));
  const zoom = useDrawingToolStore((state) => state.zoom);
  const dragOrigin = useRef<{ pointer: number; position: number } | null>(null);

  // Re-centres the cut line whenever orientation changes (its old value, measured along
  // the other axis, has no meaning here) or a different view gets picked.
  useEffect(() => {
    if (!view) return;
    const extent = orientation === "vertical" ? view.width * view.scale : view.height * view.scale;
    setPosition(extent / 2);
    // Only re-centre on these two — dragging updates `position` itself and must not be
    // fought by this effect re-running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation, sourceViewId]);

  if (!view) return null;

  const width = view.width * view.scale;
  const height = view.height * view.scale;
  const left = view.x - width / 2;
  const top = view.y - height / 2;

  const confirm = () => {
    void runCreateSectionView(view, orientation, position / view.scale, flipped);
  };

  return (
    <g>
      {orientation === "vertical" ? (
        <line x1={left + position} y1={top} x2={left + position} y2={top + height} className={styles.sectionLine} />
      ) : (
        <line x1={left} y1={top + position} x2={left + width} y2={top + position} className={styles.sectionLine} />
      )}
      <rect
        x={orientation === "vertical" ? left + position - 1.5 : left}
        y={orientation === "vertical" ? top : top + position - 1.5}
        width={orientation === "vertical" ? 3 : width}
        height={orientation === "vertical" ? height : 3}
        className={orientation === "vertical" ? styles.sectionHandleHitVertical : styles.sectionHandleHit}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragOrigin.current = { pointer: orientation === "vertical" ? event.clientX : event.clientY, position };
        }}
        onPointerMove={(event) => {
          if (!dragOrigin.current) return;
          const client = orientation === "vertical" ? event.clientX : event.clientY;
          const delta = (client - dragOrigin.current.pointer) / (SHEET_SCALE * zoom);
          const max = orientation === "vertical" ? width : height;
          setPosition(Math.min(Math.max(dragOrigin.current.position + delta, 0), max));
        }}
        onPointerUp={() => {
          dragOrigin.current = null;
        }}
      />

      <foreignObject x={Math.max(left, 2)} y={Math.max(top - 12, 2)} width={210} height={22}>
        <div className={styles.overlayToolbar}>
          <button
            type="button"
            className={styles.overlayButton}
            title="Vertical cut"
            aria-pressed={orientation === "vertical"}
            onClick={() => setOrientation("vertical")}
          >
            <MoveHorizontal size={12} />
          </button>
          <button
            type="button"
            className={styles.overlayButton}
            title="Horizontal cut"
            aria-pressed={orientation === "horizontal"}
            onClick={() => setOrientation("horizontal")}
          >
            <MoveVertical size={12} />
          </button>
          <button type="button" className={styles.overlayButton} title="Flip side" onClick={toggleFlip}>
            <FlipVertical2 size={12} />
          </button>
          <button
            type="button"
            className={`${styles.overlayButton} ${styles.overlayButtonPrimary}`}
            title="Create section view"
            onClick={confirm}
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
