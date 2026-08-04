import { FileUp, RotateCw } from "lucide-react";

import { runCommand } from "@/commands/commandRegistry";
import { useTranslation } from "@/i18n/useTranslation";
import { useDocumentStore } from "@/state/documentStore";
import type { DrawingViewData } from "@/types/document";

import styles from "./DrawingSheet.module.css";

/** A3 landscape, mm — the only sheet size this first pass offers (Sheet Format, the
 * ribbon button next to Update Views, is still a "Coming soon" stub). */
const SHEET_WIDTH = 420;
const SHEET_HEIGHT = 297;

/** One placed view: visible edges solid, hidden edges dashed, labelled underneath. */
function View({ view }: { view: DrawingViewData }) {
  const width = view.width * view.scale;
  const height = view.height * view.scale;
  const x = view.x - width / 2;
  const y = view.y - height / 2;

  return (
    <svg x={x} y={y} width={width} height={height} viewBox={`0 0 ${view.width} ${view.height}`} overflow="visible">
      {/* `kernel/drawingProjection.ts` hands back CAD-space geometry (Y up); this sheet
          renders Y-down like every other 2D surface in the app, so the view's own content
          is flipped here rather than upstream, where CAD-space is the more natural unit
          for the projection maths to work in. */}
      <g transform={`translate(0, ${view.height}) scale(1, -1)`}>
        {view.hiddenPaths.map((d, index) => (
          <path key={`hidden-${index}`} d={d} className={styles.hiddenEdge} />
        ))}
        {view.visiblePaths.map((d, index) => (
          <path key={`visible-${index}`} d={d} className={styles.visibleEdge} />
        ))}
      </g>
      <text x={view.width / 2} y={view.height + 16} textAnchor="middle" className={styles.viewLabel}>
        {view.label}
      </text>
    </svg>
  );
}

/**
 * A Drawing document's 2D sheet — `AppShell.tsx` swaps this in for the 3D Feature
 * Manager/viewport split whenever the active document's `kind` is `"drawing"`.
 *
 * Views are placed and cached by `commands/drawingCommands.ts`'s Insert Model View /
 * Update Views (see `types/document.ts`'s `DrawingViewData`); this component only renders
 * whatever is already on `document.drawing`, the same read-only-render/command-does-the-
 * work split every other property panel in this app already follows.
 */
export function DrawingSheet() {
  const drawing = useDocumentStore((state) => state.document.drawing);
  const { t } = useTranslation();

  const views = drawing?.views ?? [];
  const sourcePart = drawing?.sourcePart ?? null;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.toolbarButton} onClick={() => runCommand("drawing.model-view")}>
          <FileUp size={14} strokeWidth={1.75} />
          {t("drawing.insert-model-view", "Insert Model View")}
        </button>
        {sourcePart && (
          <button type="button" className={styles.toolbarButton} onClick={() => runCommand("drawing.update-views")}>
            <RotateCw size={14} strokeWidth={1.75} />
            {t("drawing.update-views", "Update Views")}
          </button>
        )}
        {sourcePart && (
          <span className={styles.sourceLabel}>
            {t("drawing.showing", "Showing")} {sourcePart.fileName}
          </span>
        )}
      </div>

      <div className={styles.sheetScroll}>
        <svg
          className={styles.sheet}
          width={SHEET_WIDTH * 2.5}
          height={SHEET_HEIGHT * 2.5}
          viewBox={`0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}`}
        >
          <rect x={2} y={2} width={SHEET_WIDTH - 4} height={SHEET_HEIGHT - 4} className={styles.border} />
          {views.map((view) => (
            <View key={view.id} view={view} />
          ))}
        </svg>

        {views.length === 0 && (
          <div className={styles.emptyState}>
            {t("drawing.empty", "Insert a Model View to show a saved part's projected views here.")}
          </div>
        )}
      </div>
    </div>
  );
}
