import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, X } from "lucide-react";

import { runCreateProjectedView } from "@/commands/drawingCommands";
import { DEFAULT_PROJECTION_METHOD, projectableDirections } from "@/commands/drawingViewLayout";
import { useDocumentStore } from "@/state/documentStore";
import { useDrawingToolStore } from "@/state/drawingToolStore";
import type { StandardProjectionKind } from "@/types/document";

import styles from "./DrawingSheet.module.css";

/** How far beyond the source view's own bounding box each arrow floats, sheet mm — clear
 * of the view's own label (`View`'s own render sits it 16mm below the view's bottom edge),
 * so the "down" arrow never lands on top of that text. */
const ARROW_OFFSET = 24;
const ARROW_ICON = { up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight } as const;

/**
 * `drawing.projected`'s own directional-arrow picker — appears once a placed standard view
 * has been clicked (`DrawingSheet.tsx` arms this via `drawingToolStore.pickProjectedSource`
 * instead of immediately creating the "next missing" view the way this command originally
 * worked). Each arrow is one further standard direction reachable from the source by exactly
 * one cardinal step (`drawingViewLayout.ts`'s `projectableDirections`); clicking one creates
 * that view and re-lays out the whole associated set. Isometric never resolves to a cardinal
 * arrow (its projection isn't axis-aligned), so it gets its own small corner button whenever
 * it isn't already on the sheet, alongside whatever cardinal arrows apply.
 */
export function ProjectedViewOverlay() {
  const sourceViewId = useDrawingToolStore((state) => state.projectedSourceViewId);
  const resetPicking = useDrawingToolStore((state) => state.resetPicking);
  const drawing = useDocumentStore((state) => state.document.drawing);
  const sourceView = drawing?.views.find((view) => view.id === sourceViewId);

  if (!drawing || !sourceView || sourceView.kind !== "standard") return null;

  const method = drawing.projectionMethod ?? DEFAULT_PROJECTION_METHOD;
  const existing = new Set(
    drawing.views.filter((view) => view.kind === "standard").map((view) => view.projection as StandardProjectionKind),
  );
  const candidates = projectableDirections(sourceView.projection as StandardProjectionKind, existing, method);
  const showIso = !existing.has("iso") && sourceView.projection !== "iso";

  const width = sourceView.width * sourceView.scale;
  const height = sourceView.height * sourceView.scale;
  const left = sourceView.x - width / 2;
  const right = sourceView.x + width / 2;
  const top = sourceView.y - height / 2;
  const bottom = sourceView.y + height / 2;

  const create = (direction: StandardProjectionKind) => {
    void runCreateProjectedView(sourceView, direction);
  };

  return (
    <g>
      {candidates.map(({ direction, arrow }) => {
        const Icon = ARROW_ICON[arrow];
        const cx =
          arrow === "left" ? left - ARROW_OFFSET : arrow === "right" ? right + ARROW_OFFSET : sourceView.x;
        const cy = arrow === "up" ? top - ARROW_OFFSET : arrow === "down" ? bottom + ARROW_OFFSET : sourceView.y;
        return (
          <foreignObject key={direction} x={cx - 8} y={cy - 8} width={16} height={16}>
            <button
              type="button"
              className={`${styles.overlayButton} ${styles.overlayButtonPrimary}`}
              title={`Project ${direction.toUpperCase()}`}
              onClick={() => create(direction)}
            >
              <Icon size={12} />
            </button>
          </foreignObject>
        );
      })}
      {showIso && (
        <foreignObject x={right + ARROW_OFFSET - 8} y={top - ARROW_OFFSET - 8} width={16} height={16}>
          <button
            type="button"
            className={`${styles.overlayButton} ${styles.overlayButtonPrimary}`}
            title="Project ISOMETRIC"
            onClick={() => create("iso")}
          >
            <Box size={12} />
          </button>
        </foreignObject>
      )}
      <foreignObject x={left - 8} y={top - ARROW_OFFSET - 8} width={16} height={16}>
        <button type="button" className={styles.overlayButton} title="Cancel" onClick={resetPicking}>
          <X size={12} />
        </button>
      </foreignObject>
    </g>
  );
}
