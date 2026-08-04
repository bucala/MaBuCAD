import { useState } from "react";
import { FileUp, RotateCw, Settings2 } from "lucide-react";

import { runCommand } from "@/commands/commandRegistry";
import { useTranslation } from "@/i18n/useTranslation";
import { useDocumentStore } from "@/state/documentStore";
import {
  DEFAULT_SHEET_FORMAT_ID,
  useTemplateStore,
} from "@/state/templateStore";
import { paperDimensions } from "@/types/drawingTemplates";
import type { BorderTemplate, SheetFormat, TitleBlockTemplate } from "@/types/drawingTemplates";
import type { DrawingViewData } from "@/types/document";

import styles from "./DrawingSheet.module.css";
import { TemplateManagerDialog } from "./TemplateManagerDialog";

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

/** The zone reference grid a `BorderTemplate` describes, drawn around the sheet's own
 * border rectangle — numbered columns top and bottom, lettered rows left and right, plus
 * small registration marks at each edge's midpoint. */
export function SheetBorder({ width, height, border }: { width: number; height: number; border: BorderTemplate }) {
  const { margin, zoneColumns, zoneRows, centreMarks } = border;
  const innerX = margin;
  const innerY = margin;
  const innerW = width - margin * 2;
  const innerH = height - margin * 2;
  const colWidth = innerW / zoneColumns;
  const rowHeight = innerH / zoneRows;

  return (
    <g>
      <rect x={1} y={1} width={width - 2} height={height - 2} className={styles.paperEdge} />
      <rect x={innerX} y={innerY} width={innerW} height={innerH} className={styles.borderLine} />

      {Array.from({ length: zoneColumns }, (_, i) => innerX + colWidth * (i + 0.5)).map((cx, i) => (
        <g key={`col-${i}`}>
          <text x={cx} y={margin * 0.65} textAnchor="middle" className={styles.zoneLabel}>
            {i + 1}
          </text>
          <text x={cx} y={height - margin * 0.3} textAnchor="middle" className={styles.zoneLabel}>
            {i + 1}
          </text>
        </g>
      ))}
      {Array.from({ length: zoneColumns - 1 }, (_, i) => innerX + colWidth * (i + 1)).map((x, i) => (
        <g key={`coltick-${i}`}>
          <line x1={x} y1={0} x2={x} y2={margin} className={styles.zoneTick} />
          <line x1={x} y1={height - margin} x2={x} y2={height} className={styles.zoneTick} />
        </g>
      ))}

      {Array.from({ length: zoneRows }, (_, i) => innerY + rowHeight * (i + 0.5)).map((cy, i) => (
        <g key={`row-${i}`}>
          <text x={margin * 0.5} y={cy} textAnchor="middle" dominantBaseline="middle" className={styles.zoneLabel}>
            {String.fromCharCode(65 + i)}
          </text>
          <text
            x={width - margin * 0.5}
            y={cy}
            textAnchor="middle"
            dominantBaseline="middle"
            className={styles.zoneLabel}
          >
            {String.fromCharCode(65 + i)}
          </text>
        </g>
      ))}
      {Array.from({ length: zoneRows - 1 }, (_, i) => innerY + rowHeight * (i + 1)).map((y, i) => (
        <g key={`rowtick-${i}`}>
          <line x1={0} y1={y} x2={margin} y2={y} className={styles.zoneTick} />
          <line x1={width - margin} y1={y} x2={width} y2={y} className={styles.zoneTick} />
        </g>
      ))}

      {centreMarks && (
        <>
          <rect x={width / 2 - 1} y={0} width={2} height={margin} className={styles.centreMark} />
          <rect x={width / 2 - 1} y={height - margin} width={2} height={margin} className={styles.centreMark} />
          <rect x={0} y={height / 2 - 1} width={margin} height={2} className={styles.centreMark} />
          <rect x={width - margin} y={height / 2 - 1} width={margin} height={2} className={styles.centreMark} />
        </>
      )}
    </g>
  );
}

/**
 * The title block, anchored so its own bottom-right corner sits at the border's
 * bottom-right corner. Each field is a labelled cell; clicking one turns it into a plain
 * text input (via `foreignObject`, which inherits the surrounding SVG's mm-per-unit scale
 * automatically) for typing that field's value — Enter or blur commits it, Escape cancels.
 */
function TitleBlockView({
  titleBlock,
  values,
  onEditValue,
}: {
  titleBlock: TitleBlockTemplate;
  values: Record<string, string>;
  onEditValue: (key: string, value: string) => void;
}) {
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);

  return (
    <g>
      <rect x={0} y={0} width={titleBlock.width} height={titleBlock.height} className={styles.titleBlockOutline} />
      {titleBlock.fields.map((field) => {
        const value = values[field.key] ?? "";
        const isEditing = editingFieldId === field.id;
        return (
          <g key={field.id}>
            <rect
              x={field.x}
              y={field.y}
              width={field.width}
              height={field.height}
              className={styles.titleBlockCell}
              data-field-key={field.key}
              onClick={() => setEditingFieldId(field.id)}
            />
            <text x={field.x + 1} y={field.y + 2.4} className={styles.titleBlockLabel}>
              {field.label}
            </text>
            {isEditing ? (
              <foreignObject x={field.x} y={field.y + 3} width={field.width} height={field.height - 3}>
                <input
                  autoFocus
                  defaultValue={value}
                  className={styles.titleBlockInput}
                  style={{ fontSize: field.fontSize }}
                  onBlur={(event) => {
                    onEditValue(field.key, event.target.value);
                    setEditingFieldId(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") setEditingFieldId(null);
                  }}
                />
              </foreignObject>
            ) : (
              <text
                x={field.x + 1}
                y={field.y + field.height - 1.5}
                fontSize={field.fontSize}
                fontWeight={field.bold ? 700 : 400}
                className={styles.titleBlockValue}
              >
                {value}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * A Drawing document's 2D sheet — `AppShell.tsx` swaps this in for the 3D Feature
 * Manager/viewport split whenever the active document's `kind` is `"drawing"`.
 *
 * Views are placed and cached by `commands/drawingCommands.ts`'s Insert Model View /
 * Update Views (see `types/document.ts`'s `DrawingViewData`); the border and title block
 * come from whichever `SheetFormat` the document has chosen (`state/templateStore.ts`'s
 * shared Drawing Resources library, editable via `TemplateManagerDialog.tsx`) — this
 * component only renders whatever the document and the library currently say, the same
 * read-only-render/command-does-the-work split every other property panel in this app
 * already follows.
 */
export function DrawingSheet() {
  const drawing = useDocumentStore((state) => state.document.drawing);
  const setDrawingSheet = useDocumentStore((state) => state.setDrawingSheet);
  const sheetFormats = useTemplateStore((state) => state.sheetFormats);
  const borders = useTemplateStore((state) => state.borders);
  const titleBlocks = useTemplateStore((state) => state.titleBlocks);
  const { t } = useTranslation();

  const views = drawing?.views ?? [];
  const sourcePart = drawing?.sourcePart ?? null;
  const titleBlockValues = drawing?.titleBlockValues ?? {};

  const sheetFormat: SheetFormat | undefined =
    sheetFormats.find((format) => format.id === (drawing?.sheetFormatId ?? DEFAULT_SHEET_FORMAT_ID)) ??
    sheetFormats[0];
  const border = sheetFormat ? borders.find((b) => b.id === sheetFormat.borderTemplateId) : undefined;
  const titleBlock = sheetFormat ? titleBlocks.find((b) => b.id === sheetFormat.titleBlockTemplateId) : undefined;
  const { width: sheetWidth, height: sheetHeight } = sheetFormat
    ? paperDimensions(sheetFormat.size, sheetFormat.orientation)
    : { width: 420, height: 297 };

  const setSheetFormat = (formatId: string) => {
    if (!drawing) return;
    setDrawingSheet({ ...drawing, sheetFormatId: formatId });
  };

  const setTitleBlockValue = (key: string, value: string) => {
    if (!drawing) return;
    setDrawingSheet({ ...drawing, titleBlockValues: { ...drawing.titleBlockValues, [key]: value } });
  };

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
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={() => runCommand("drawing.sheet-format")}
          title={t("drawing.edit-resources", "Edit borders and title blocks")}
        >
          <Settings2 size={14} strokeWidth={1.75} />
          {t("drawing.sheet-format", "Sheet Format")}
        </button>
        <select
          className={styles.sheetFormatSelect}
          value={sheetFormat?.id ?? ""}
          onChange={(event) => setSheetFormat(event.target.value)}
          aria-label={t("drawing.sheet-format", "Sheet Format")}
        >
          {sheetFormats.map((format) => (
            <option key={format.id} value={format.id}>
              {format.name}
            </option>
          ))}
        </select>
        {sourcePart && (
          <span className={styles.sourceLabel}>
            {t("drawing.showing", "Showing")} {sourcePart.fileName}
          </span>
        )}
      </div>

      <div className={styles.sheetScroll}>
        <svg
          className={styles.sheet}
          width={sheetWidth * 2.5}
          height={sheetHeight * 2.5}
          viewBox={`0 0 ${sheetWidth} ${sheetHeight}`}
        >
          {border && <SheetBorder width={sheetWidth} height={sheetHeight} border={border} />}
          {views.map((view) => (
            <View key={view.id} view={view} />
          ))}
          {titleBlock && border && (
            <g
              transform={`translate(${sheetWidth - border.margin - titleBlock.width}, ${
                sheetHeight - border.margin - titleBlock.height
              })`}
            >
              <TitleBlockView titleBlock={titleBlock} values={titleBlockValues} onEditValue={setTitleBlockValue} />
            </g>
          )}
        </svg>

        {views.length === 0 && (
          <div className={styles.emptyState}>
            {t("drawing.empty", "Insert a Model View to show a saved part's projected views here.")}
          </div>
        )}
      </div>

      <TemplateManagerDialog />
    </div>
  );
}
