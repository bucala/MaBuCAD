import { useEffect, useRef, useState } from "react";
import { FileUp, RotateCw, Settings2, Trash2 } from "lucide-react";

import { runCommand } from "@/commands/commandRegistry";
import { useTranslation } from "@/i18n/useTranslation";
import { useDocumentStore } from "@/state/documentStore";
import { useDrawingToolStore } from "@/state/drawingToolStore";
import { DEFAULT_SHEET_FORMAT_ID, useTemplateStore } from "@/state/templateStore";
import { paperDimensions } from "@/types/drawingTemplates";
import type { BorderTemplate, SheetFormat, TitleBlockTemplate } from "@/types/drawingTemplates";
import type { DrawingNoteData, DrawingViewData } from "@/types/document";

import { DetailOverlay } from "./DetailOverlay";
import styles from "./DrawingSheet.module.css";
import { SectionOverlay } from "./SectionOverlay";
import { TemplateManagerDialog } from "./TemplateManagerDialog";

/** px per sheet-mm the outer sheet `<svg>` is rendered at — every drag handler in this
 * file (views, notes) converts screen-pixel deltas back to sheet-mm by dividing by this. */
const SHEET_SCALE = 2.5;

/** Views only Front/Top/Right can take a Section cut from — Iso's projection axes aren't
 * world-axis-aligned (see `kernel/drawingProjection.ts`'s `sectionAxisAndOffset`), and a
 * Section/Detail view has nothing meaningful to further section/detail from itself. */
function isSectionable(view: DrawingViewData): boolean {
  return view.kind !== "detail" && view.projection !== "iso";
}

/** One placed view's actual projected geometry: visible edges solid, hidden edges dashed,
 * labelled underneath. A Detail view crops this same rendering to a circle via `detailOf`
 * — see its own doc comment in `types/document.ts` for the coordinate space it's in. */
function View({ view }: { view: DrawingViewData }) {
  const width = view.width * view.scale;
  const height = view.height * view.scale;
  const x = view.x - width / 2;
  const y = view.y - height / 2;
  const detail = view.kind === "detail" ? view.detailOf : undefined;

  const viewBoxStr = detail
    ? `${detail.cx - detail.radius} ${detail.cy - detail.radius} ${detail.radius * 2} ${detail.radius * 2}`
    : `0 0 ${view.width} ${view.height}`;
  const flipTranslateY = detail ? detail.sourceHeight : view.height;
  const clipId = detail ? `detail-clip-${view.id}` : undefined;

  return (
    <>
      <svg x={x} y={y} width={width} height={height} viewBox={viewBoxStr} overflow="visible">
        {clipId && detail && (
          <clipPath id={clipId}>
            <circle cx={detail.cx} cy={detail.cy} r={detail.radius} />
          </clipPath>
        )}
        {/* `kernel/drawingProjection.ts` hands back CAD-space geometry (Y up); this sheet
            renders Y-down like every other 2D surface in the app, so the view's own content
            is flipped here rather than upstream, where CAD-space is the more natural unit
            for the projection maths to work in. A Detail view reuses its source's own
            un-flipped paths verbatim, so it needs the exact same flip, just keyed by the
            source's own height rather than its own (`detailOf.sourceHeight`). */}
        <g clipPath={clipId ? `url(#${clipId})` : undefined}>
          <g transform={`translate(0, ${flipTranslateY}) scale(1, -1)`}>
            {/* ISO 128-50 hatching: the newly exposed cut face(s)' own outline, filled with
                the shared 45°-diagonal pattern (`DrawingSheet`'s own <defs>) — same angle
                and spacing for every section on the sheet, since they're all this one part. */}
            {view.hatchPaths?.map((d, index) => (
              <path key={`hatch-${index}`} d={d} className={styles.hatchFill} fillRule="evenodd" />
            ))}
            {view.hiddenPaths.map((d, index) => (
              <path key={`hidden-${index}`} d={d} className={styles.hiddenEdge} />
            ))}
            {view.visiblePaths.map((d, index) => (
              <path key={`visible-${index}`} d={d} className={styles.visibleEdge} />
            ))}
          </g>
        </g>
      </svg>
      {/* Rendered in the *sheet's* own coordinate system, not the nested viewBox above —
          a Detail view's viewBox only spans its own small crop radius, which would make
          any font-size fixed in that space (this label's included) balloon or shrink with
          the crop/scale instead of reading consistently across every view on the sheet. */}
      <text x={view.x} y={y + height + 16} textAnchor="middle" className={styles.viewLabel}>
        {view.label}
      </text>
    </>
  );
}

/**
 * Wraps `View` with a drag/select handle and, while `drawing.section`/`drawing.detail` are
 * armed, a "pick me" overlay — clicking picks this view as the tool's source instead of
 * selecting/dragging it.
 */
function PlacedView({
  view,
  selected,
  pickable,
  onSelect,
  onMove,
  onPick,
}: {
  view: DrawingViewData;
  selected: boolean;
  pickable: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onPick: (localX: number, localY: number) => void;
}) {
  const width = view.width * view.scale;
  const height = view.height * view.scale;
  const x = view.x - width / 2;
  const y = view.y - height / 2;
  const dragOrigin = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  return (
    <g>
      <View view={view} />
      {pickable ? (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          className={styles.pickable}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const fracX = (event.clientX - rect.left) / rect.width;
            const fracY = (event.clientY - rect.top) / rect.height;
            onPick(fracX * view.width, fracY * view.height);
          }}
        />
      ) : (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          data-view-handle={view.id}
          className={selected ? styles.viewHandleSelected : styles.viewHandle}
          onPointerDown={(event) => {
            onSelect();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragOrigin.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
          }}
          onPointerMove={(event) => {
            if (!dragOrigin.current) return;
            const dx = (event.clientX - dragOrigin.current.x) / SHEET_SCALE;
            const dy = (event.clientY - dragOrigin.current.y) / SHEET_SCALE;
            onMove(dragOrigin.current.vx + dx, dragOrigin.current.vy + dy);
          }}
          onPointerUp={() => {
            dragOrigin.current = null;
          }}
        />
      )}
    </g>
  );
}

/** A freeform text note: drag to move, click to edit inline, a small delete button while
 * selected — the same drag/edit shapes `PlacedView`/`TitleBlockView` already use. */
function NoteView({
  note,
  selected,
  editing,
  onSelect,
  onMove,
  onStartEdit,
  onCommitEdit,
  onDelete,
}: {
  note: DrawingNoteData;
  selected: boolean;
  editing: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onStartEdit: () => void;
  onCommitEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const dragOrigin = useRef<{ x: number; y: number; nx: number; ny: number } | null>(null);
  const width = Math.max(note.text.length * note.fontSize * 0.6, 30);
  const height = note.fontSize + 4;

  return (
    <g>
      <rect
        x={note.x}
        y={note.y}
        width={width}
        height={height}
        className={selected ? styles.noteBoxSelected : styles.noteBox}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onStartEdit();
        }}
        onPointerDown={(event) => {
          if (editing) return;
          onSelect();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragOrigin.current = { x: event.clientX, y: event.clientY, nx: note.x, ny: note.y };
        }}
        onPointerMove={(event) => {
          if (!dragOrigin.current) return;
          const dx = (event.clientX - dragOrigin.current.x) / SHEET_SCALE;
          const dy = (event.clientY - dragOrigin.current.y) / SHEET_SCALE;
          onMove(dragOrigin.current.nx + dx, dragOrigin.current.ny + dy);
        }}
        onPointerUp={() => {
          dragOrigin.current = null;
        }}
      />
      {editing ? (
        <foreignObject x={note.x} y={note.y} width={Math.max(width, 60)} height={Math.max(height, 16)}>
          <input
            autoFocus
            defaultValue={note.text}
            className={styles.noteInput}
            style={{ fontSize: note.fontSize }}
            onBlur={(event) => onCommitEdit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") onCommitEdit(note.text);
            }}
          />
        </foreignObject>
      ) : (
        <text
          x={note.x + 1}
          y={note.y + note.fontSize}
          fontSize={note.fontSize}
          className={styles.noteText}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onStartEdit();
          }}
        >
          {note.text || "…"}
        </text>
      )}
      {selected && !editing && (
        <g
          transform={`translate(${note.x + width + 2}, ${note.y - 2})`}
          className={styles.noteDelete}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <circle r={3} />
          <text className={styles.noteDeleteIcon} y={1}>
            ×
          </text>
        </g>
      )}
    </g>
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
 * Update Views / Section / Detail commands (see `types/document.ts`'s `DrawingViewData`);
 * the border and title block come from whichever `SheetFormat` the document has chosen
 * (`state/templateStore.ts`'s shared Drawing Resources library, editable via
 * `TemplateManagerDialog.tsx`). Which interactive tool is active (plain select, placing a
 * note, picking a section/detail source) lives in `drawingToolStore.ts`, armed by the
 * Drawing ribbon's own commands the same way Sketch tools arm `sketchStore.tool`.
 */
export function DrawingSheet() {
  const drawing = useDocumentStore((state) => state.document.drawing);
  const setDrawingSheet = useDocumentStore((state) => state.setDrawingSheet);
  const updateDrawingView = useDocumentStore((state) => state.updateDrawingView);
  const deleteDrawingView = useDocumentStore((state) => state.deleteDrawingView);
  const addDrawingNote = useDocumentStore((state) => state.addDrawingNote);
  const updateDrawingNote = useDocumentStore((state) => state.updateDrawingNote);
  const deleteDrawingNote = useDocumentStore((state) => state.deleteDrawingNote);
  const sheetFormats = useTemplateStore((state) => state.sheetFormats);
  const borders = useTemplateStore((state) => state.borders);
  const titleBlocks = useTemplateStore((state) => state.titleBlocks);
  const { t } = useTranslation();

  const tool = useDrawingToolStore((state) => state.tool);
  const setTool = useDrawingToolStore((state) => state.setTool);
  const sectionSourceViewId = useDrawingToolStore((state) => state.sectionSourceViewId);
  const detailSourceViewId = useDrawingToolStore((state) => state.detailSourceViewId);
  const pickSectionSource = useDrawingToolStore((state) => state.pickSectionSource);
  const pickDetailSource = useDrawingToolStore((state) => state.pickDetailSource);

  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const sheetRef = useRef<SVGSVGElement>(null);

  const views = drawing?.views ?? [];
  const notes = drawing?.notes ?? [];
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

  // Delete/Backspace removes whichever view or note is selected — not while a note is
  // mid-edit, where those keys mean "edit the text", not "delete the annotation".
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (editingNoteId) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedViewId) {
        deleteDrawingView(selectedViewId);
        setSelectedViewId(null);
      } else if (selectedNoteId) {
        deleteDrawingNote(selectedNoteId);
        setSelectedNoteId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedViewId, selectedNoteId, editingNoteId, deleteDrawingView, deleteDrawingNote]);

  const setSheetFormat = (formatId: string) => {
    if (!drawing) return;
    setDrawingSheet({ ...drawing, sheetFormatId: formatId });
  };

  const setTitleBlockValue = (key: string, value: string) => {
    if (!drawing) return;
    setDrawingSheet({ ...drawing, titleBlockValues: { ...drawing.titleBlockValues, [key]: value } });
  };

  const handleBackgroundClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (tool === "note") {
      const svg = sheetRef.current;
      if (!svg) return;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const local = point.matrixTransform(ctm.inverse());
      const id = addDrawingNote({ x: local.x, y: local.y, text: "", fontSize: 4 });
      setEditingNoteId(id);
      setSelectedNoteId(id);
      setTool("select");
      return;
    }
    setSelectedViewId(null);
    setSelectedNoteId(null);
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
        {(selectedViewId || selectedNoteId) && (
          <button
            type="button"
            className={styles.toolbarButton}
            onClick={() => {
              if (selectedViewId) deleteDrawingView(selectedViewId);
              if (selectedNoteId) deleteDrawingNote(selectedNoteId);
              setSelectedViewId(null);
              setSelectedNoteId(null);
            }}
          >
            <Trash2 size={14} strokeWidth={1.75} />
            {t("drawing.delete-selected", "Delete")}
          </button>
        )}
      </div>

      <div className={styles.sheetScroll}>
        <svg
          ref={sheetRef}
          className={styles.sheet}
          width={sheetWidth * SHEET_SCALE}
          height={sheetHeight * SHEET_SCALE}
          viewBox={`0 0 ${sheetWidth} ${sheetHeight}`}
          onClick={handleBackgroundClick}
          style={{ cursor: tool === "note" ? "crosshair" : "default" }}
        >
          <defs>
            {/* ISO 128-50: thin lines at 45°, uniform spacing — one shared pattern so every
                section view on this sheet (all cut from the same part) hatches identically,
                per the standard's "same part, same angle and spacing" rule. `userSpaceOnUse`
                means the 3mm tile is measured in whichever view's own local mm space
                actually references it, so spacing reads consistently regardless of that
                view's individual `scale`. */}
            <pattern id="section-hatch" patternUnits="userSpaceOnUse" width="3" height="3" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="3" className={styles.hatchLine} />
            </pattern>
          </defs>

          {border && <SheetBorder width={sheetWidth} height={sheetHeight} border={border} />}

          {views.map((view) => (
            <PlacedView
              key={view.id}
              view={view}
              selected={view.id === selectedViewId}
              pickable={
                (tool === "section" && !sectionSourceViewId && isSectionable(view)) ||
                (tool === "detail" && !detailSourceViewId)
              }
              onSelect={() => {
                setSelectedViewId(view.id);
                setSelectedNoteId(null);
              }}
              onMove={(x, y) => updateDrawingView(view.id, { x, y })}
              onPick={(localX, localY) => {
                if (tool === "section") pickSectionSource(view.id, localX);
                else if (tool === "detail") pickDetailSource(view.id, localX, localY);
              }}
            />
          ))}

          {notes.map((note) => (
            <NoteView
              key={note.id}
              note={note}
              selected={note.id === selectedNoteId}
              editing={note.id === editingNoteId}
              onSelect={() => {
                setSelectedNoteId(note.id);
                setSelectedViewId(null);
              }}
              onMove={(x, y) => updateDrawingNote(note.id, { x, y })}
              onStartEdit={() => setEditingNoteId(note.id)}
              onCommitEdit={(text) => {
                updateDrawingNote(note.id, { text });
                setEditingNoteId(null);
              }}
              onDelete={() => {
                deleteDrawingNote(note.id);
                setSelectedNoteId(null);
              }}
            />
          ))}

          {tool === "section" && <SectionOverlay />}
          {tool === "detail" && <DetailOverlay />}

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
