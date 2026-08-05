import { useEffect, useRef, useState } from "react";
import { FileUp, Frame, Maximize, RotateCw, Settings2, Trash2, ZoomIn, ZoomOut } from "lucide-react";

import { runCommand } from "@/commands/commandRegistry";
import { runCreateProjectedView } from "@/commands/drawingCommands";
import { useTranslation } from "@/i18n/useTranslation";
import { nearestVertex, viewScaleFor } from "@/kernel/drawingGeometry";
import { useDocumentStore } from "@/state/documentStore";
import { useDrawingToolStore } from "@/state/drawingToolStore";
import { DEFAULT_SHEET_FORMAT_ID, useTemplateStore } from "@/state/templateStore";
import { paperDimensions } from "@/types/drawingTemplates";
import type { BorderTemplate, SheetFormat, TitleBlockTemplate } from "@/types/drawingTemplates";
import type { DrawingNoteData, DrawingViewData } from "@/types/document";

import { DetailOverlay } from "./DetailOverlay";
import { DimensionView, OrdinateChainView } from "./DimensionAnnotations";
import styles from "./DrawingSheet.module.css";
import { SectionOverlay } from "./SectionOverlay";
import { DatumView, GdtView, SurfaceFinishView } from "./SymbolAnnotations";
import { TableView } from "./TableAnnotations";
import { TemplateManagerDialog } from "./TemplateManagerDialog";
import { WeldView } from "./WeldAnnotations";

/** Sheet-mm snap tolerance for the annotation picking tools (dimension/ordinate/datum/GD&T) —
 * large enough to forgive an imprecise click, small enough not to jump to unrelated geometry
 * on a dense view. */
const PICK_TOLERANCE = 3;

/** Every tool whose next sheet click places or picks something, rather than plain
 * select/drag — used only to pick the crosshair cursor. */
const PICKING_TOOLS = new Set([
  "note",
  "datum",
  "gdt",
  "surface-finish",
  "weld",
  "smart-dimension",
  "ordinate",
  "projected",
]);

/** The subset of `PICKING_TOOLS` that reads the click straight off the background sheet
 * (`sheetPointFromEvent` plus, for the vertex-snapping ones, `nearestVertex` search across
 * every view at once) rather than picking a specific view the way Section/Detail/Projected
 * do — `PlacedView` must not render its own interactive rect for these, or a click over any
 * view's bounding box would claim the click for "select this view" before it ever reaches
 * `handleBackgroundClick`. */
const PASSTHROUGH_TOOLS = new Set(["note", "datum", "gdt", "surface-finish", "weld", "smart-dimension", "ordinate"]);

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
        {/* replicad's own `toSVGPathD()` already mirrors CAD-space (Y-up) into SVG
            convention (Y-down) before emitting path data (`bp.mirror([1,0],[0,0],"plane")`
            in `node_modules/replicad/dist/replicad.js`), and combined with `projectOne`'s
            own translate-to-origin, that leaves every path in the range `[-height, 0]`
            rather than `[0, height]`. A plain vertical shift by `height` is the whole fix
            needed to land the geometry inside this view's own `0 0 width height` viewBox —
            no additional axis flip, which would just mirror it a second time. A Detail view
            reuses its source's own paths verbatim, so it needs the exact same shift, just
            keyed by the source's own height rather than its own (`detailOf.sourceHeight`).
            `kernel/drawingGeometry.ts`'s `viewVertices()` mirrors this exact transform for
            picking — keep the two in lockstep. */}
        <g clipPath={clipId ? `url(#${clipId})` : undefined}>
          <g transform={`translate(0, ${flipTranslateY})`}>
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
 * Wraps `View` with a drag/select handle and, while `drawing.section`/`drawing.detail`/
 * `drawing.projected` are armed, a "pick me" overlay — clicking picks this view as the
 * tool's source instead of selecting/dragging it.
 *
 * While one of the vertex-snapping annotation tools is armed (`passthrough`), neither
 * overlay renders at all: those tools search every view's vertices at once
 * (`kernel/drawingGeometry.ts`'s `nearestVertex`), not "whichever view's rect the click
 * happened to land on", so the click needs to reach `DrawingSheet`'s own background handler
 * un-intercepted rather than being claimed by this view first.
 */
function PlacedView({
  view,
  selected,
  pickable,
  passthrough,
  onSelect,
  onMove,
  onPick,
}: {
  view: DrawingViewData;
  selected: boolean;
  pickable: boolean;
  passthrough: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onPick: (localX: number, localY: number) => void;
}) {
  const width = view.width * view.scale;
  const height = view.height * view.scale;
  const x = view.x - width / 2;
  const y = view.y - height / 2;
  const dragOrigin = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const zoom = useDrawingToolStore((state) => state.zoom);

  return (
    <g>
      <View view={view} />
      {passthrough ? null : pickable ? (
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
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          onPointerDown={(event) => {
            onSelect();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragOrigin.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
          }}
          onPointerMove={(event) => {
            if (!dragOrigin.current) return;
            const dx = (event.clientX - dragOrigin.current.x) / (SHEET_SCALE * zoom);
            const dy = (event.clientY - dragOrigin.current.y) / (SHEET_SCALE * zoom);
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
  const zoom = useDrawingToolStore((state) => state.zoom);
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
          const dx = (event.clientX - dragOrigin.current.x) / (SHEET_SCALE * zoom);
          const dy = (event.clientY - dragOrigin.current.y) / (SHEET_SCALE * zoom);
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
  // ISO 5457's grid reference numbers/letters read as one consistent size across every
  // edge — this is the one formula both the horizontal (column) and vertical (row) labels
  // below compute their `fontSize` from, rather than each hand-tuning its own. Capped at
  // 3.5mm (ISO 5457's own character height for the reference grid) but scaled down for a
  // tighter margin band so the glyph never overflows the strip it sits in.
  const zoneLabelSize = Math.min(margin * 0.5, 3.5);

  return (
    <g>
      <rect x={1} y={1} width={width - 2} height={height - 2} className={styles.paperEdge} />
      <rect x={innerX} y={innerY} width={innerW} height={innerH} className={styles.borderLine} />

      {Array.from({ length: zoneColumns }, (_, i) => innerX + colWidth * (i + 0.5)).map((cx, i) => (
        <g key={`col-${i}`}>
          <text
            x={cx}
            y={margin / 2}
            fontSize={zoneLabelSize}
            textAnchor="middle"
            dominantBaseline="middle"
            className={styles.zoneLabel}
          >
            {i + 1}
          </text>
          <text
            x={cx}
            y={height - margin / 2}
            fontSize={zoneLabelSize}
            textAnchor="middle"
            dominantBaseline="middle"
            className={styles.zoneLabel}
          >
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
          <text
            x={margin / 2}
            y={cy}
            fontSize={zoneLabelSize}
            textAnchor="middle"
            dominantBaseline="middle"
            className={styles.zoneLabel}
          >
            {String.fromCharCode(65 + i)}
          </text>
          <text
            x={width - margin / 2}
            y={cy}
            fontSize={zoneLabelSize}
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
  const addDrawingDimension = useDocumentStore((state) => state.addDrawingDimension);
  const updateDrawingDimension = useDocumentStore((state) => state.updateDrawingDimension);
  const deleteDrawingDimension = useDocumentStore((state) => state.deleteDrawingDimension);
  const addDrawingOrdinateChain = useDocumentStore((state) => state.addDrawingOrdinateChain);
  const addOrdinatePoint = useDocumentStore((state) => state.addOrdinatePoint);
  const deleteDrawingOrdinateChain = useDocumentStore((state) => state.deleteDrawingOrdinateChain);
  const addDrawingDatum = useDocumentStore((state) => state.addDrawingDatum);
  const updateDrawingDatum = useDocumentStore((state) => state.updateDrawingDatum);
  const deleteDrawingDatum = useDocumentStore((state) => state.deleteDrawingDatum);
  const addDrawingGdt = useDocumentStore((state) => state.addDrawingGdt);
  const updateDrawingGdt = useDocumentStore((state) => state.updateDrawingGdt);
  const deleteDrawingGdt = useDocumentStore((state) => state.deleteDrawingGdt);
  const addDrawingSurfaceFinish = useDocumentStore((state) => state.addDrawingSurfaceFinish);
  const updateDrawingSurfaceFinish = useDocumentStore((state) => state.updateDrawingSurfaceFinish);
  const deleteDrawingSurfaceFinish = useDocumentStore((state) => state.deleteDrawingSurfaceFinish);
  const addDrawingWeld = useDocumentStore((state) => state.addDrawingWeld);
  const updateDrawingWeld = useDocumentStore((state) => state.updateDrawingWeld);
  const deleteDrawingWeld = useDocumentStore((state) => state.deleteDrawingWeld);
  const updateDrawingTable = useDocumentStore((state) => state.updateDrawingTable);
  const deleteDrawingTable = useDocumentStore((state) => state.deleteDrawingTable);
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
  const dimensionFirstPoint = useDrawingToolStore((state) => state.dimensionFirstPoint);
  const pickDimensionFirstPoint = useDrawingToolStore((state) => state.pickDimensionFirstPoint);
  const ordinateDatum = useDrawingToolStore((state) => state.ordinateDatum);
  const ordinateChainId = useDrawingToolStore((state) => state.ordinateChainId);
  const ordinateAxis = useDrawingToolStore((state) => state.ordinateAxis);
  const pickOrdinateDatum = useDrawingToolStore((state) => state.pickOrdinateDatum);
  const startOrdinateChain = useDrawingToolStore((state) => state.startOrdinateChain);
  const zoom = useDrawingToolStore((state) => state.zoom);
  const panX = useDrawingToolStore((state) => state.panX);
  const panY = useDrawingToolStore((state) => state.panY);
  const zoomAt = useDrawingToolStore((state) => state.zoomAt);
  const setPan = useDrawingToolStore((state) => state.setPan);
  const resetZoomPan = useDrawingToolStore((state) => state.resetZoomPan);

  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  /** The one dead-button annotation kind (dimension/ordinate chain/datum/GD&T/surface
   * finish/weld/table) currently selected, if any — a single tagged-union field rather than
   * seven more parallel `useState`s, since only one of these can be selected at a time and
   * every consumer (Delete key, toolbar's Delete button) needs to branch on "which kind"
   * anyway. */
  const [selectedAnnotation, setSelectedAnnotation] = useState<
    { kind: "dimension" | "ordinate" | "datum" | "gdt" | "surfaceFinish" | "weld" | "table"; id: string } | null
  >(null);
  const sheetRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panOrigin = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const views = drawing?.views ?? [];
  const notes = drawing?.notes ?? [];
  const dimensions = drawing?.dimensions ?? [];
  const ordinateChains = drawing?.ordinateChains ?? [];
  const datums = drawing?.datums ?? [];
  const gdtFrames = drawing?.gdtFrames ?? [];
  const surfaceFinishes = drawing?.surfaceFinishes ?? [];
  const welds = drawing?.welds ?? [];
  const tables = drawing?.tables ?? [];
  const sourcePart = drawing?.sourcePart ?? null;
  const titleBlockValues = drawing?.titleBlockValues ?? {};

  const selectAnnotation = (
    kind: "dimension" | "ordinate" | "datum" | "gdt" | "surfaceFinish" | "weld" | "table",
    id: string,
  ) => {
    setSelectedAnnotation({ kind, id });
    setSelectedViewId(null);
    setSelectedNoteId(null);
  };

  const deleteSelectedAnnotation = () => {
    if (!selectedAnnotation) return;
    switch (selectedAnnotation.kind) {
      case "dimension":
        deleteDrawingDimension(selectedAnnotation.id);
        break;
      case "ordinate":
        deleteDrawingOrdinateChain(selectedAnnotation.id);
        break;
      case "datum":
        deleteDrawingDatum(selectedAnnotation.id);
        break;
      case "gdt":
        deleteDrawingGdt(selectedAnnotation.id);
        break;
      case "surfaceFinish":
        deleteDrawingSurfaceFinish(selectedAnnotation.id);
        break;
      case "weld":
        deleteDrawingWeld(selectedAnnotation.id);
        break;
      case "table":
        deleteDrawingTable(selectedAnnotation.id);
        break;
    }
    setSelectedAnnotation(null);
  };

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
      } else if (selectedAnnotation) {
        deleteSelectedAnnotation();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedViewId, selectedNoteId, editingNoteId, selectedAnnotation, deleteDrawingView, deleteDrawingNote]);

  const setSheetFormat = (formatId: string) => {
    if (!drawing) return;
    setDrawingSheet({ ...drawing, sheetFormatId: formatId });
  };

  const setTitleBlockValue = (key: string, value: string) => {
    if (!drawing) return;
    setDrawingSheet({ ...drawing, titleBlockValues: { ...drawing.titleBlockValues, [key]: value } });
  };

  /** Converts a pointer event to sheet-mm via the sheet `<svg>`'s own screen CTM — the same
   * conversion Note placement already did inline; factored out here so the five annotation
   * tools below share it instead of each re-deriving it. */
  const sheetPointFromEvent = (event: React.MouseEvent): { x: number; y: number } | null => {
    const svg = sheetRef.current;
    if (!svg) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = point.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  const handleBackgroundClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (tool === "note") {
      const local = sheetPointFromEvent(event);
      if (!local) return;
      const id = addDrawingNote({ x: local.x, y: local.y, text: "", fontSize: 4 });
      setEditingNoteId(id);
      setSelectedNoteId(id);
      setTool("select");
      return;
    }

    if (tool === "datum" || tool === "gdt" || tool === "surface-finish" || tool === "weld") {
      const local = sheetPointFromEvent(event);
      if (!local) return;
      const vertex = nearestVertex(views, local, PICK_TOLERANCE);
      const anchor = vertex ?? local;
      // No nearby geometry: still place the symbol at the raw click, leadered to itself —
      // a symbol with no valid feature to reference isn't a case worth blocking on.
      const label = { x: anchor.x + 10, y: anchor.y - 10 };
      if (tool === "datum") {
        const nextLetter = String.fromCharCode(65 + (datums.length % 26));
        const id = addDrawingDatum({ letter: nextLetter, anchorX: anchor.x, anchorY: anchor.y, labelX: label.x, labelY: label.y });
        selectAnnotation("datum", id);
      } else if (tool === "gdt") {
        const id = addDrawingGdt({
          symbol: "position",
          tolerance: "0.1",
          datums: [],
          anchorX: anchor.x,
          anchorY: anchor.y,
          labelX: label.x,
          labelY: label.y,
        });
        selectAnnotation("gdt", id);
      } else if (tool === "surface-finish") {
        const id = addDrawingSurfaceFinish({ roughness: "Ra 1.6", anchorX: anchor.x, anchorY: anchor.y, labelX: label.x, labelY: label.y });
        selectAnnotation("surfaceFinish", id);
      } else {
        const id = addDrawingWeld({
          anchorX: anchor.x,
          anchorY: anchor.y,
          labelX: label.x,
          labelY: label.y,
          arrowSide: { symbol: "fillet", size: "6" },
          otherSide: null,
          allAround: false,
          fieldWeld: false,
        });
        selectAnnotation("weld", id);
      }
      setTool("select");
      return;
    }

    if (tool === "smart-dimension") {
      const local = sheetPointFromEvent(event);
      if (!local) return;
      const vertex = nearestVertex(views, local, PICK_TOLERANCE);
      if (!vertex) return;
      if (!dimensionFirstPoint) {
        pickDimensionFirstPoint(vertex.viewId, vertex.x, vertex.y);
        return;
      }
      const scale = viewScaleFor(views, dimensionFirstPoint.viewId);
      const dx = vertex.x - dimensionFirstPoint.x;
      const dy = vertex.y - dimensionFirstPoint.y;
      const value = Math.hypot(dx, dy) / scale;
      addDrawingDimension({
        kind: Math.abs(dx) < 1e-6 ? "vertical" : Math.abs(dy) < 1e-6 ? "horizontal" : "linear",
        x1: dimensionFirstPoint.x,
        y1: dimensionFirstPoint.y,
        x2: vertex.x,
        y2: vertex.y,
        value,
        offsetX: 0,
        offsetY: -8,
      });
      // `setTool` re-arming its own current tool clears `dimensionFirstPoint` (see
      // `drawingToolStore.ts`) without leaving "select" — stays armed for the next
      // dimension, matching a sketch's own Smart Dimension not disarming after one use.
      setTool("smart-dimension");
      return;
    }

    if (tool === "ordinate") {
      const local = sheetPointFromEvent(event);
      if (!local) return;
      const vertex = nearestVertex(views, local, PICK_TOLERANCE);
      if (!vertex) return;
      if (!ordinateDatum) {
        pickOrdinateDatum(vertex.x, vertex.y);
        return;
      }
      const scale = viewScaleFor(views, vertex.viewId);
      if (!ordinateChainId || !ordinateAxis) {
        const dx = Math.abs(vertex.x - ordinateDatum.x);
        const dy = Math.abs(vertex.y - ordinateDatum.y);
        const axis: "x" | "y" = dx >= dy ? "x" : "y";
        const value = (axis === "x" ? dx : dy) / scale;
        const chainId = addDrawingOrdinateChain({
          axis,
          datumX: ordinateDatum.x,
          datumY: ordinateDatum.y,
          points: [{ x: vertex.x, y: vertex.y, value }],
        });
        startOrdinateChain(chainId, axis);
        return;
      }
      const value = (ordinateAxis === "x" ? Math.abs(vertex.x - ordinateDatum.x) : Math.abs(vertex.y - ordinateDatum.y)) / scale;
      addOrdinatePoint(ordinateChainId, { x: vertex.x, y: vertex.y, value });
      return;
    }

    setSelectedViewId(null);
    setSelectedNoteId(null);
    setSelectedAnnotation(null);
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
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={() => runCommand("drawing.edit-background")}
          title={t("drawing.edit-background-title", "Edit the sheet's border/background template")}
        >
          <Frame size={14} strokeWidth={1.75} />
          {t("drawing.edit-background", "Edit Background")}
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
        {(selectedViewId || selectedNoteId || selectedAnnotation) && (
          <button
            type="button"
            className={styles.toolbarButton}
            onClick={() => {
              if (selectedViewId) deleteDrawingView(selectedViewId);
              if (selectedNoteId) deleteDrawingNote(selectedNoteId);
              if (selectedAnnotation) deleteSelectedAnnotation();
              setSelectedViewId(null);
              setSelectedNoteId(null);
            }}
          >
            <Trash2 size={14} strokeWidth={1.75} />
            {t("drawing.delete-selected", "Delete")}
          </button>
        )}
        <button
          type="button"
          className={styles.toolbarButton}
          title={t("drawing.zoom-out", "Zoom out")}
          onClick={() => useDrawingToolStore.getState().setZoom(zoom / 1.25)}
        >
          <ZoomOut size={14} strokeWidth={1.75} />
        </button>
        <span className={styles.zoomReadout}>{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className={styles.toolbarButton}
          title={t("drawing.zoom-in", "Zoom in")}
          onClick={() => useDrawingToolStore.getState().setZoom(zoom * 1.25)}
        >
          <ZoomIn size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className={styles.toolbarButton}
          title={t("drawing.zoom-reset", "Reset zoom/pan (or Ctrl+double-click the sheet)")}
          onClick={resetZoomPan}
        >
          <Maximize size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div
        ref={scrollRef}
        className={styles.sheetScroll}
        onWheel={(event) => {
          event.preventDefault();
          const container = scrollRef.current?.getBoundingClientRect();
          if (!container) return;
          const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
          zoomAt(factor, event.clientX, event.clientY, container.left, container.top);
        }}
        onPointerDown={(event) => {
          // Middle-mouse drag pans the sheet, the same button the 3D viewport already
          // reserves for panning — left click stays free for select/place/pick.
          if (event.button !== 1) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          panOrigin.current = { x: event.clientX, y: event.clientY, panX, panY };
        }}
        onPointerMove={(event) => {
          if (!panOrigin.current) return;
          setPan(
            panOrigin.current.panX + (event.clientX - panOrigin.current.x),
            panOrigin.current.panY + (event.clientY - panOrigin.current.y),
          );
        }}
        onPointerUp={() => {
          panOrigin.current = null;
        }}
        onDoubleClick={(event) => {
          if (event.ctrlKey || event.metaKey) resetZoomPan();
        }}
      >
        <svg
          ref={sheetRef}
          className={styles.sheet}
          width={sheetWidth * SHEET_SCALE}
          height={sheetHeight * SHEET_SCALE}
          viewBox={`0 0 ${sheetWidth} ${sheetHeight}`}
          onClick={handleBackgroundClick}
          style={{
            cursor: PICKING_TOOLS.has(tool) ? "crosshair" : "default",
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          }}
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
                (tool === "detail" && !detailSourceViewId) ||
                (tool === "projected" && view.kind === "standard")
              }
              passthrough={PASSTHROUGH_TOOLS.has(tool)}
              onSelect={() => {
                setSelectedViewId(view.id);
                setSelectedNoteId(null);
                setSelectedAnnotation(null);
              }}
              onMove={(x, y) => updateDrawingView(view.id, { x, y })}
              onPick={(localX, localY) => {
                if (tool === "section") pickSectionSource(view.id, localX);
                else if (tool === "detail") pickDetailSource(view.id, localX, localY);
                else if (tool === "projected") {
                  void runCreateProjectedView(view);
                  setTool("select");
                }
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
                setSelectedAnnotation(null);
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

          {dimensions.map((dimension) => (
            <DimensionView
              key={dimension.id}
              dimension={dimension}
              selected={selectedAnnotation?.kind === "dimension" && selectedAnnotation.id === dimension.id}
              onSelect={() => selectAnnotation("dimension", dimension.id)}
              onMove={(offsetX, offsetY) => updateDrawingDimension(dimension.id, { offsetX, offsetY })}
              onEdit={(patch) => updateDrawingDimension(dimension.id, patch)}
            />
          ))}

          {ordinateChains.map((chain) => (
            <OrdinateChainView
              key={chain.id}
              chain={chain}
              selected={selectedAnnotation?.kind === "ordinate" && selectedAnnotation.id === chain.id}
              onSelect={() => selectAnnotation("ordinate", chain.id)}
            />
          ))}

          {datums.map((datum) => (
            <DatumView
              key={datum.id}
              datum={datum}
              selected={selectedAnnotation?.kind === "datum" && selectedAnnotation.id === datum.id}
              onSelect={() => selectAnnotation("datum", datum.id)}
              onMove={(labelX, labelY) => updateDrawingDatum(datum.id, { labelX, labelY })}
              onRename={(letter) => updateDrawingDatum(datum.id, { letter })}
            />
          ))}

          {gdtFrames.map((gdt) => (
            <GdtView
              key={gdt.id}
              gdt={gdt}
              selected={selectedAnnotation?.kind === "gdt" && selectedAnnotation.id === gdt.id}
              onSelect={() => selectAnnotation("gdt", gdt.id)}
              onMove={(labelX, labelY) => updateDrawingGdt(gdt.id, { labelX, labelY })}
              onEdit={(patch) => updateDrawingGdt(gdt.id, patch)}
            />
          ))}

          {surfaceFinishes.map((finish) => (
            <SurfaceFinishView
              key={finish.id}
              finish={finish}
              selected={selectedAnnotation?.kind === "surfaceFinish" && selectedAnnotation.id === finish.id}
              onSelect={() => selectAnnotation("surfaceFinish", finish.id)}
              onMove={(labelX, labelY) => updateDrawingSurfaceFinish(finish.id, { labelX, labelY })}
              onEdit={(patch) => updateDrawingSurfaceFinish(finish.id, patch)}
            />
          ))}

          {welds.map((weld) => (
            <WeldView
              key={weld.id}
              weld={weld}
              selected={selectedAnnotation?.kind === "weld" && selectedAnnotation.id === weld.id}
              onSelect={() => selectAnnotation("weld", weld.id)}
              onMove={(labelX, labelY) => updateDrawingWeld(weld.id, { labelX, labelY })}
              onEdit={(patch) => updateDrawingWeld(weld.id, patch)}
            />
          ))}

          {tables.map((table) => (
            <TableView
              key={table.id}
              table={table}
              selected={selectedAnnotation?.kind === "table" && selectedAnnotation.id === table.id}
              onSelect={() => selectAnnotation("table", table.id)}
              onMove={(x, y) => updateDrawingTable(table.id, { x, y })}
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
