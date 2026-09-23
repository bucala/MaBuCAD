import { Check, MoveHorizontal, MoveVertical, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { runCreateBrokenView } from "@/commands/drawingCommands";
import { useDocumentStore } from "@/state/documentStore";
import { useDrawingToolStore } from "@/state/drawingToolStore";

import styles from "./DrawingSheet.module.css";

const SHEET_SCALE = 2.5;

/** Configures the omitted band of a Broken view. Moving the band preserves its width; the
 * two edge handles change its extent without requiring a second dialog. */
export function BrokenOverlay() {
  const sourceViewId = useDrawingToolStore((state) => state.brokenSourceViewId);
  const orientation = useDrawingToolStore((state) => state.brokenOrientation);
  const start = useDrawingToolStore((state) => state.brokenStart);
  const end = useDrawingToolStore((state) => state.brokenEnd);
  const setBand = useDrawingToolStore((state) => state.setBrokenBand);
  const setOrientation = useDrawingToolStore((state) => state.setBrokenOrientation);
  const resetPicking = useDrawingToolStore((state) => state.resetPicking);
  const zoom = useDrawingToolStore((state) => state.zoom);
  const view = useDocumentStore((state) => state.document.drawing?.views.find((candidate) => candidate.id === sourceViewId));
  const moveOrigin = useRef<{ pointer: number; start: number; end: number } | null>(null);
  const resizeOrigin = useRef<{ pointer: number; edge: "start" | "end"; start: number; end: number } | null>(null);

  useEffect(() => {
    if (!view || end > start) return;
    const extent = orientation === "vertical" ? view.width : view.height;
    setBand(extent / 3, (extent * 2) / 3);
  }, [view, orientation, end, start, setBand]);

  if (!view) return null;

  const width = view.width * view.scale;
  const height = view.height * view.scale;
  const left = view.x - width / 2;
  const top = view.y - height / 2;
  const bandStart = orientation === "vertical" ? left + start * view.scale : top + start * view.scale;
  const bandEnd = orientation === "vertical" ? left + end * view.scale : top + end * view.scale;

  const moveBand = (event: React.PointerEvent<SVGRectElement>) => {
    if (!moveOrigin.current) return;
    const pointer = orientation === "vertical" ? event.clientX : event.clientY;
    const delta = (pointer - moveOrigin.current.pointer) / (SHEET_SCALE * zoom * view.scale);
    const extent = orientation === "vertical" ? view.width : view.height;
    const size = moveOrigin.current.end - moveOrigin.current.start;
    const nextStart = Math.max(0, Math.min(moveOrigin.current.start + delta, extent - size));
    setBand(nextStart, nextStart + size);
  };

  const resizeBand = (event: React.PointerEvent<SVGRectElement>) => {
    if (!resizeOrigin.current) return;
    const pointer = orientation === "vertical" ? event.clientX : event.clientY;
    // Same origin-relative delta as `moveBand`: `clientX/Y` are viewport pixels, so a
    // sheet-mm offset like `left`/`top` can never be subtracted from them directly.
    const delta = (pointer - resizeOrigin.current.pointer) / (SHEET_SCALE * zoom * view.scale);
    const extent = orientation === "vertical" ? view.width : view.height;
    if (resizeOrigin.current.edge === "start") {
      const next = Math.max(0, Math.min(resizeOrigin.current.start + delta, resizeOrigin.current.end));
      setBand(next, resizeOrigin.current.end);
    } else {
      const next = Math.max(resizeOrigin.current.start, Math.min(resizeOrigin.current.end + delta, extent));
      setBand(resizeOrigin.current.start, next);
    }
  };

  return (
    <g>
      <rect
        x={orientation === "vertical" ? bandStart : left}
        y={orientation === "vertical" ? top : bandStart}
        width={orientation === "vertical" ? Math.max(bandEnd - bandStart, 4) : width}
        height={orientation === "vertical" ? height : Math.max(bandEnd - bandStart, 4)}
        className={styles.brokenBand}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          moveOrigin.current = {
            pointer: orientation === "vertical" ? event.clientX : event.clientY,
            start,
            end,
          };
        }}
        onPointerMove={moveBand}
        onPointerUp={() => {
          moveOrigin.current = null;
        }}
      />
      <rect
        x={orientation === "vertical" ? bandStart - 2 : left}
        y={orientation === "vertical" ? top : bandStart - 2}
        width={orientation === "vertical" ? 4 : width}
        height={orientation === "vertical" ? height : 4}
        className={styles.brokenHandle}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeOrigin.current = { pointer: orientation === "vertical" ? event.clientX : event.clientY, edge: "start", start, end };
        }}
        onPointerMove={(event) => {
          event.stopPropagation();
          resizeBand(event);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          resizeOrigin.current = null;
        }}
      />
      <rect
        x={orientation === "vertical" ? bandEnd - 2 : left}
        y={orientation === "vertical" ? top : bandEnd - 2}
        width={orientation === "vertical" ? 4 : width}
        height={orientation === "vertical" ? height : 4}
        className={styles.brokenHandle}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeOrigin.current = { pointer: orientation === "vertical" ? event.clientX : event.clientY, edge: "end", start, end };
        }}
        onPointerMove={(event) => {
          event.stopPropagation();
          resizeBand(event);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          resizeOrigin.current = null;
        }}
      />
      <foreignObject x={Math.max(left, 2)} y={Math.max(top - 12, 2)} width={150} height={22}>
        <div className={styles.overlayToolbar}>
          <button
            type="button"
            className={styles.overlayButton}
            title="Break vertically"
            aria-pressed={orientation === "vertical"}
            onClick={() => setOrientation("vertical")}
          >
            <MoveHorizontal size={12} />
          </button>
          <button
            type="button"
            className={styles.overlayButton}
            title="Break horizontally"
            aria-pressed={orientation === "horizontal"}
            onClick={() => setOrientation("horizontal")}
          >
            <MoveVertical size={12} />
          </button>
          <button
            type="button"
            className={`${styles.overlayButton} ${styles.overlayButtonPrimary}`}
            title="Create broken view"
            onClick={() => runCreateBrokenView(view, orientation, start, end)}
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
