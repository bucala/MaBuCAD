import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Frame, Maximize, RotateCw, Settings2, Trash2, ZoomIn, ZoomOut } from "lucide-react";

import { runCommand } from "@/commands/commandRegistry";
import { runCreateProjectedView, runToggleProjectionMethod } from "@/commands/drawingCommands";
import { DEFAULT_PROJECTION_METHOD } from "@/commands/drawingViewLayout";
import { nearestHoleTarget } from "@/commands/holeCallout";
import { useTranslation } from "@/i18n/useTranslation";
import { statAtPath } from "@/io/files";
import { nearestVertex, viewScaleFor } from "@/kernel/drawingGeometry";
import { sectionArrowSign, type OrthoProjection } from "@/kernel/drawingProjection";
import { viewsAreStale } from "@/kernel/drawingStaleness";
import { useDocumentStore } from "@/state/documentStore";
import { useDrawingToolStore } from "@/state/drawingToolStore";
import { DEFAULT_SHEET_FORMAT_ID, useTemplateStore } from "@/state/templateStore";
import { paperDimensions } from "@/types/drawingTemplates";
import type { BorderTemplate, SheetFormat, TitleBlockField, TitleBlockTemplate } from "@/types/drawingTemplates";
import type { DrawingNoteData, DrawingViewData } from "@/types/document";

import { DetailOverlay } from "./DetailOverlay";
import { DimensionView, OrdinateChainView } from "./DimensionAnnotations";
import styles from "./DrawingSheet.module.css";
import { HoleCalloutView } from "./HoleCalloutAnnotations";
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
  "hole-callout",
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
const PASSTHROUGH_TOOLS = new Set(["note", "hole-callout", "datum", "gdt", "surface-finish", "weld", "smart-dimension", "ordinate"]);

/** px per sheet-mm the outer sheet `<svg>` is rendered at — every drag handler in this
 * file (views, notes) converts screen-pixel deltas back to sheet-mm by dividing by this. */
const SHEET_SCALE = 2.5;

/** Views only Front/Top/Right can take a Section cut from — Iso's projection axes aren't
 * world-axis-aligned (see `kernel/drawingProjection.ts`'s `sectionAxisAndOffset`), and a
 * Section/Detail view has nothing meaningful to further section/detail from itself. */
function isSectionable(view: DrawingViewData): boolean {
  return view.kind !== "detail" && view.projection !== "iso";
}

/**
 * A hand-torn-looking closed circle, ISO 128's own "continuous freehand thin line" break
 * convention — the boundary a Detail view's own crop is drawn with, since it was lifted out
 * of the surrounding material the same way a broken-out section's own boundary is. Jitter is
 * a deterministic function of the segment index rather than `Math.random()`, so the same
 * view renders the identical wobble every time instead of visibly reshuffling on each React
 * re-render.
 */
function tornCirclePath(cx: number, cy: number, r: number): string {
  const segments = 28;
  const jitter = r * 0.04;
  const points: string[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const wobble = Math.sin(i * 2.7) * jitter + Math.sin(i * 5.3) * jitter * 0.5;
    const radius = r + wobble;
    points.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`);
  }
  return `M ${points[0]} L ${points.slice(1).join(" L ")} Z`;
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
            {/* ISO 128-3 hatching: the newly exposed cut face(s)' own outline, filled with
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
            {/* ISO 6410's own thread-major-diameter circle — see
                `kernel/drawingProjection.ts`'s `threadOverlaysFor` for how it's found. */}
            {view.threadPaths?.map((d, index) => (
              <path key={`thread-${index}`} d={d} className={styles.threadEdge} />
            ))}
          </g>
        </g>
        {/* Drawn outside the clip so the torn edge itself stays visible rather than being
            cropped away by the very circle it traces — see `tornCirclePath`'s own doc
            comment for why this is jagged rather than a plain `<circle>`. */}
        {detail && <path d={tornCirclePath(detail.cx, detail.cy, detail.radius)} className={styles.detailTornBoundary} />}
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
  active,
  pickable,
  passthrough,
  onSelect,
  onMove,
  onPick,
  onToggleActive,
}: {
  view: DrawingViewData;
  selected: boolean;
  active: boolean;
  pickable: boolean;
  passthrough: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onPick: (localX: number, localY: number) => void;
  onToggleActive: () => void;
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
          onDoubleClick={(event) => {
            event.stopPropagation();
            onToggleActive();
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
      {active && !passthrough && <rect x={x} y={y} width={width} height={height} className={styles.viewFrameActive} />}
    </g>
  );
}

/** How far past the source view's own bounding box the cutting-plane line and its arrows
 * extend, sheet mm — ISO 128-3's own convention draws it clear of the view outline rather
 * than flush with it. */
const SECTION_MARK_OVERHANG = 6;
const SECTION_ARROW_LENGTH = 4;
const SECTION_ARROW_WIDTH = 2;

/**
 * The ISO 128-3 cutting-plane line an existing Section view's own source view is missing
 * until now: a line across the source view at the position it was cut, an arrowhead at
 * each end pointing in the direction of sight for the resulting section, and the same
 * `letter-letter` designation (e.g. "A-A") the section view's own "SECTION A-A" label
 * already carries — drawn from `section.orientation`/`localScreenPosition`, the exact
 * values captured when the cut line was originally placed (`types/document.ts`'s
 * `DrawingViewData.section`'s own doc comment).
 */
function SectionCutMarkView({ sourceView, section }: { sourceView: DrawingViewData; section: NonNullable<DrawingViewData["section"]> }) {
  const width = sourceView.width * sourceView.scale;
  const height = sourceView.height * sourceView.scale;
  const left = sourceView.x - width / 2;
  const top = sourceView.y - height / 2;
  const scaledPosition = section.localScreenPosition * sourceView.scale;
  const arrowSign = sectionArrowSign(sourceView.projection as OrthoProjection, section.orientation, section.keepPositiveSide);

  const vertical = section.orientation === "vertical";
  const lineX1 = vertical ? left + scaledPosition : left - SECTION_MARK_OVERHANG;
  const lineX2 = vertical ? left + scaledPosition : left + width + SECTION_MARK_OVERHANG;
  const lineY1 = vertical ? top - SECTION_MARK_OVERHANG : top + scaledPosition;
  const lineY2 = vertical ? top + height + SECTION_MARK_OVERHANG : top + scaledPosition;

  // Arrows point perpendicular to the cutting line itself (ISO 128-3's own "direction of
  // sight" convention) — a *vertical* line's normal runs along screen X, a *horizontal*
  // line's along screen Y, so each axis's own tip/perpendicular-width pair is keyed the
  // opposite way from the line's own orientation flag.
  const arrowAt = (baseX: number, baseY: number) => {
    const tipX = vertical ? baseX + SECTION_ARROW_LENGTH * arrowSign : baseX;
    const tipY = vertical ? baseY : baseY + SECTION_ARROW_LENGTH * arrowSign;
    const perpX = vertical ? 0 : SECTION_ARROW_WIDTH / 2;
    const perpY = vertical ? SECTION_ARROW_WIDTH / 2 : 0;
    return `${baseX - perpX},${baseY - perpY} ${baseX + perpX},${baseY + perpY} ${tipX},${tipY}`;
  };
  const labelOffset = SECTION_ARROW_LENGTH + 3;
  const labelAt = (baseX: number, baseY: number) => ({
    x: vertical ? baseX + labelOffset * arrowSign : baseX,
    y: vertical ? baseY + 1 : baseY + labelOffset * arrowSign,
  });
  const start = { x: lineX1, y: lineY1 };
  const end = { x: lineX2, y: lineY2 };
  const startLabel = labelAt(start.x, start.y);
  const endLabel = labelAt(end.x, end.y);

  return (
    <g className={styles.sectionMark}>
      <line x1={lineX1} y1={lineY1} x2={lineX2} y2={lineY2} className={styles.sectionMarkLine} />
      <polygon points={arrowAt(start.x, start.y)} className={styles.sectionMarkArrow} />
      <polygon points={arrowAt(end.x, end.y)} className={styles.sectionMarkArrow} />
      <text x={startLabel.x} y={startLabel.y} textAnchor="middle" dominantBaseline="middle" className={styles.sectionMarkLabel}>
        {section.letter}
      </text>
      <text x={endLabel.x} y={endLabel.y} textAnchor="middle" dominantBaseline="middle" className={styles.sectionMarkLabel}>
        {section.letter}
      </text>
    </g>
  );
}

/**
 * The boundary circle + leadered letter callout an existing Detail view's own source view
 * is missing until now — matches `detailOf`'s own crop circle exactly, with a leader to a
 * letter callout positioned the same way `runCreateDetailView` parks the detail view itself
 * (up and to the right of the cropped circle), so it reads as "this circle became DETAIL A,
 * over there."
 */
function DetailCalloutView({ sourceView, detailOf, label }: { sourceView: DrawingViewData; detailOf: NonNullable<DrawingViewData["detailOf"]>; label: string }) {
  const width = sourceView.width * sourceView.scale;
  const height = sourceView.height * sourceView.scale;
  const left = sourceView.x - width / 2;
  const top = sourceView.y - height / 2;
  const cx = left + detailOf.cx * sourceView.scale;
  const cy = top + detailOf.cy * sourceView.scale;
  const r = detailOf.radius * sourceView.scale;
  const labelX = cx + r * 0.85;
  const labelY = cy - r * 0.85 - 6;

  return (
    <g className={styles.sectionMark}>
      <circle cx={cx} cy={cy} r={r} className={styles.detailCalloutCircle} />
      <line x1={cx + r * 0.7} y1={cy - r * 0.7} x2={labelX} y2={labelY + 2} className={styles.sectionMarkLine} />
      <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle" className={styles.sectionMarkLabel}>
        {label}
      </text>
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

/** ISO 128-30's own projection-method symbol: a truncated cone (the frustum outline every
 * such symbol shows, wide end always drawn on the left) and a circle, on a shared
 * chain-dotted axis line — cone-then-circle for ISO-E (1st angle), circle-then-cone for
 * ISO-A (3rd angle), the same left-to-right order the standard's own reference diagrams
 * use (see the PDF this app's own drawing overhaul was speced against, "evrópske
 * uspořádání pohledů" vs "americké uspořádání pohledů"). Sized to fit inside whatever cell
 * rect it's given, centred both ways. */
function ProjectionMethodGlyph({ method, width, height }: { method: "ISO-E" | "ISO-A"; width: number; height: number }) {
  const size = Math.min(width, height) * 0.7;
  const coneWidth = size * 1.1;
  const gap = size * 0.35;
  const circleR = size / 2;
  const totalWidth = coneWidth + gap + circleR * 2;
  const startX = width / 2 - totalWidth / 2;
  const midY = height / 2;

  const cone =
    method === "ISO-E" ? (
      <polygon
        points={`${startX},${midY - size / 2} ${startX + coneWidth},${midY - circleR * 0.55} ${startX + coneWidth},${midY + circleR * 0.55} ${startX},${midY + size / 2}`}
        className={styles.projectionGlyph}
      />
    ) : (
      <polygon
        points={`${startX + totalWidth - coneWidth},${midY - circleR * 0.55} ${startX + totalWidth},${midY - size / 2} ${startX + totalWidth},${midY + size / 2} ${startX + totalWidth - coneWidth},${midY + circleR * 0.55}`}
        className={styles.projectionGlyph}
      />
    );
  const circleCx = method === "ISO-E" ? startX + coneWidth + gap + circleR : startX + circleR;

  return (
    <g>
      <line x1={startX - size * 0.15} y1={midY} x2={startX + totalWidth + size * 0.15} y2={midY} className={styles.projectionAxis} />
      {cone}
      <circle cx={circleCx} cy={midY} r={circleR} className={styles.projectionGlyph} />
    </g>
  );
}

/** The title block's own projection-method cell content: the `ProjectionMethodGlyph` plus
 * the method's own short text underneath. Purely visual — the click-to-toggle handler that
 * makes this interactive lives on the shared full-cell background rect one level up
 * (`TitleBlockView`), the same painted-and-therefore-hit-testable element every other title
 * block cell already uses to catch its own click; the glyph's own `fill: none` strokes
 * would otherwise only catch a click landing exactly on a stroke pixel. */
function ProjectionSymbolCell({ field, method }: { field: TitleBlockField; method: "ISO-E" | "ISO-A" }) {
  return (
    <g>
      <title>{method === "ISO-E" ? "ISO E — first-angle (click to switch to ISO A)" : "ISO A — third-angle (click to switch to ISO E)"}</title>
      <ProjectionMethodGlyph method={method} width={field.width} height={field.height - 3} />
      <g transform={`translate(0, ${field.height - 1.5})`}>
        <text x={field.x + 1} y={0} fontSize={field.fontSize} className={styles.titleBlockValue}>
          {method}
        </text>
      </g>
    </g>
  );
}

/**
 * The title block, anchored so its own bottom-right corner sits at the border's
 * bottom-right corner. Each field is a labelled cell; clicking one turns it into a plain
 * text input (via `foreignObject`, which inherits the surrounding SVG's mm-per-unit scale
 * automatically) for typing that field's value — Enter or blur commits it, Escape cancels.
 * A `"projection-symbol"` field is the one exception: it's never editable text, always the
 * document's own projection-method glyph (`ProjectionSymbolCell`).
 */
function TitleBlockView({
  titleBlock,
  values,
  projectionMethod,
  onEditValue,
}: {
  titleBlock: TitleBlockTemplate;
  values: Record<string, string>;
  projectionMethod: "ISO-E" | "ISO-A";
  onEditValue: (key: string, value: string) => void;
}) {
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);

  return (
    <g>
      <rect x={0} y={0} width={titleBlock.width} height={titleBlock.height} className={styles.titleBlockOutline} />
      {titleBlock.fields.map((field) => {
        if (field.fieldType === "projection-symbol") {
          return (
            <g key={field.id} transform={`translate(${field.x}, ${field.y})`} className={styles.titleBlockProjectionCell}>
              <rect
                x={0}
                y={0}
                width={field.width}
                height={field.height}
                className={styles.titleBlockCell}
                data-field-key={field.key}
                onClick={(event) => {
                  event.stopPropagation();
                  runToggleProjectionMethod();
                }}
              />
              <text x={1} y={2.4} className={styles.titleBlockLabel}>
                {field.label}
              </text>
              <ProjectionSymbolCell field={{ ...field, x: 0, y: 0 }} method={projectionMethod} />
            </g>
          );
        }
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
 * The toolbar's zoom-out / readout / zoom-in / reset cluster, isolated in its own memoized
 * component so its `zoom` subscription doesn't re-render the whole sheet — before this,
 * the sheet itself subscribed to `zoom` for these three buttons and the readout, which
 * dragged the entire view/annotation/border tree through a render on every wheel tick.
 * Nothing else in the sheet needs zoom in React; the pan/zoom transform itself is written
 * imperatively (see the effect below).
 */
const ZoomCluster = memo(function ZoomCluster({ resetZoomPan }: { resetZoomPan: () => void }) {
  const zoom = useDrawingToolStore((state) => state.zoom);
  const { t } = useTranslation();

  return (
    <>
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
    </>
  );
});

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
  const beginDragEdit = useDocumentStore((state) => state.beginDragEdit);
  const endDragEdit = useDocumentStore((state) => state.endDragEdit);
  const moveDrawingView = useDocumentStore((state) => state.moveDrawingView);
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
  const addDrawingHoleCallout = useDocumentStore((state) => state.addDrawingHoleCallout);
  const updateDrawingHoleCallout = useDocumentStore((state) => state.updateDrawingHoleCallout);
  const deleteDrawingHoleCallout = useDocumentStore((state) => state.deleteDrawingHoleCallout);
  const updateDrawingTable = useDocumentStore((state) => state.updateDrawingTable);
  const deleteDrawingTable = useDocumentStore((state) => state.deleteDrawingTable);
  const sheetFormats = useTemplateStore((state) => state.sheetFormats);
  const borders = useTemplateStore((state) => state.borders);
  const titleBlocks = useTemplateStore((state) => state.titleBlocks);
  const { t, language } = useTranslation();

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
  const zoomAt = useDrawingToolStore((state) => state.zoomAt);
  const setPan = useDrawingToolStore((state) => state.setPan);
  const resetZoomPan = useDrawingToolStore((state) => state.resetZoomPan);

  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  /** Double-click a view's frame to activate it as the binding context new leadered
   * annotations pick up automatically when they aren't snapped to any specific view's own
   * geometry — see `DrawingViewData`'s "bound annotations" doc comment. Double-click empty
   * sheet, or delete the active view itself, clears it back to `null`. */
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  /** The one dead-button annotation kind (dimension/ordinate chain/datum/GD&T/surface
   * finish/weld/table) currently selected, if any — a single tagged-union field rather than
   * seven more parallel `useState`s, since only one of these can be selected at a time and
   * every consumer (Delete key, toolbar's Delete button) needs to branch on "which kind"
   * anyway. */
  const [selectedAnnotation, setSelectedAnnotation] = useState<
    { kind: "dimension" | "ordinate" | "datum" | "gdt" | "surfaceFinish" | "weld" | "holeCallout" | "table"; id: string } | null
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
  const holeCallouts = drawing?.holeCallouts ?? [];
  const tables = drawing?.tables ?? [];
  const sourcePart = drawing?.sourcePart ?? null;
  const sourcePartPath = sourcePart?.path;
  const sourceStamp = drawing?.sourceStamp;
  const titleBlockValues = drawing?.titleBlockValues ?? {};
  const projectionMethod = drawing?.projectionMethod ?? DEFAULT_PROJECTION_METHOD;

  /** Whether the referenced part file changed since these views were projected — the
   * amber "out of date" hint on the Update Views button (see `viewsAreStale`). False
   * while unverified, so an unverifiable drawing never alarms. */
  const [viewsStale, setViewsStale] = useState(false);

  /** Snaps a dragged leader anchor to the nearest view vertex within tolerance and, if one's
   * found, rebinds the annotation to that vertex's own view — the "!!" auto-bind-on-
   * reattach rule from `DrawingViewData`'s "bound annotations" doc comment. Missing the
   * snap (dropped over empty space) just moves the anchor and leaves any existing binding
   * alone, rather than unbinding on a merely-imprecise drag. */
  const anchorMovePatch = (x: number, y: number): { anchorX: number; anchorY: number; parentViewId?: string } => {
    const vertex = nearestVertex(views, { x, y }, PICK_TOLERANCE);
    return vertex ? { anchorX: vertex.x, anchorY: vertex.y, parentViewId: vertex.viewId } : { anchorX: x, anchorY: y };
  };

  const selectAnnotation = (
    kind: "dimension" | "ordinate" | "datum" | "gdt" | "surfaceFinish" | "weld" | "holeCallout" | "table",
    id: string,
  ) => {
    setSelectedAnnotation({ kind, id });
    setSelectedViewId(null);
    setSelectedNoteId(null);
  };

  // Stable across renders while the selection holds, so the window-level Delete handler
  // below does not tear down and re-register on every render — the store actions it
  // dispatches to are stable zustand setters, so only the selection itself changes it.
  const deleteSelectedAnnotation = useCallback(() => {
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
      case "holeCallout":
        deleteDrawingHoleCallout(selectedAnnotation.id);
        break;
      case "table":
        deleteDrawingTable(selectedAnnotation.id);
        break;
    }
    setSelectedAnnotation(null);
  }, [
    selectedAnnotation,
    deleteDrawingDimension,
    deleteDrawingOrdinateChain,
    deleteDrawingDatum,
    deleteDrawingGdt,
    deleteDrawingSurfaceFinish,
    deleteDrawingWeld,
    deleteDrawingHoleCallout,
    deleteDrawingTable,
    setSelectedAnnotation,
  ]);

  const sheetFormat: SheetFormat | undefined =
    sheetFormats.find((format) => format.id === (drawing?.sheetFormatId ?? DEFAULT_SHEET_FORMAT_ID)) ??
    sheetFormats[0];
  const border = sheetFormat ? borders.find((b) => b.id === sheetFormat.borderTemplateId) : undefined;
  const titleBlock = sheetFormat ? titleBlocks.find((b) => b.id === sheetFormat.titleBlockTemplateId) : undefined;
  const { width: sheetWidth, height: sheetHeight } = sheetFormat
    ? paperDimensions(sheetFormat.size, sheetFormat.orientation)
    : { width: 420, height: 297 };

  /**
   * Zoom/pan is applied imperatively to the `<svg>`'s own transform, outside React —
   * subscribing this component to `zoom`/`panX`/`panY` re-rendered the entire sheet tree
   * (views, annotations, borders, toolbar) on every wheel tick and middle-drag
   * pointermove for what is a single style write. Annotation children that genuinely need
   * zoom (counter-scaling their text) already subscribe to the store themselves; everything
   * else is pure SVG geometry the CSS transform scales without a re-render. React never
   * manages the transform key, so its own re-renders don't touch what this effect wrote.
   */
  useEffect(() => {
    const apply = (state: { zoom: number; panX: number; panY: number }) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      sheet.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    };
    apply(useDrawingToolStore.getState());
    return useDrawingToolStore.subscribe(apply);
  }, []);

  // Wheel zoom goes through a native non-passive listener: React attaches `onWheel`
  // passively, where `event.preventDefault()` was a logged no-op — the scroll container is
  // `overflow: hidden` so nothing actually scrolled anyway, but the listener might as well
  // do what it claims.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(factor, event.clientX, event.clientY, rect.left, rect.top);
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [zoomAt]);

  // Staleness check: stat the referenced part file (Tauri only — the browser build has no
  // reused path) and flag the Update Views button when it differs from the stamp captured
  // at projection time (`viewsAreStale`). Runs on mount — a drawing tab mounts when it's
  // opened or switched to — and on window focus, which covers the part being changed and
  // saved by another window entirely while this drawing sat unfocused. Everything
  // unverifiable (no stamp on a pre-feature drawing, an unblessed path) reads as up to
  // date: the amber hint must never cry wolf, only point at a change it can prove.
  useEffect(() => {
    if (!sourcePartPath || !sourceStamp) {
      setViewsStale(false);
      return;
    }
    const check = () => {
      statAtPath(sourcePartPath)
        .then((current) => setViewsStale(viewsAreStale(sourceStamp, current)))
        .catch(() => setViewsStale(false));
    };
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [sourcePartPath, sourceStamp]);

  // Delete/Backspace removes whichever view or note is selected — not while a note is
  // mid-edit, where those keys mean "edit the text", not "delete the annotation".
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (editingNoteId) return;
      // Any other focused editable surface — a title-block cell mid-edit, an annotation
      // text field, a toolbar input — keeps its keys too, for the same reason as
      // `editingNoteId` above: Delete/Backspace there mean "edit the text", never "delete
      // the sheet selection". Guarded on the event target itself rather than each
      // editor's own editing flag, which is exactly what the title-block cells' local
      // state previously left invisible to this handler.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedViewId) {
        deleteDrawingView(selectedViewId);
        if (selectedViewId === activeViewId) setActiveViewId(null);
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
  }, [selectedViewId, activeViewId, selectedNoteId, editingNoteId, selectedAnnotation, deleteDrawingView, deleteDrawingNote, deleteSelectedAnnotation]);

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

    if (tool === "hole-callout") {
      const local = sheetPointFromEvent(event);
      if (!local) return;
      const match = nearestHoleTarget(views, local, PICK_TOLERANCE);
      if (!match) return;
      const id = addDrawingHoleCallout({
        parentViewId: match.viewId,
        sourceTargetId: match.target.id,
        anchorX: match.x,
        anchorY: match.y,
        labelX: match.x + 12,
        labelY: match.y - 10,
        metadata: match.target.metadata,
      });
      selectAnnotation("holeCallout", id);
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
      // Snapped to a specific view's own geometry: bound to that view, full stop — a leader
      // attached to a real edge/vertex always means "this belongs to that view", regardless
      // of whatever else is active. Otherwise, free-floating in empty space, it picks up
      // whichever view is currently active (if any) — see `DrawingViewData`'s "bound
      // annotations" doc comment.
      const parentViewId = vertex?.viewId ?? activeViewId ?? undefined;
      if (tool === "datum") {
        const nextLetter = String.fromCharCode(65 + (datums.length % 26));
        const id = addDrawingDatum({
          letter: nextLetter,
          anchorX: anchor.x,
          anchorY: anchor.y,
          labelX: label.x,
          labelY: label.y,
          parentViewId,
        });
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
          parentViewId,
        });
        selectAnnotation("gdt", id);
      } else if (tool === "surface-finish") {
        const id = addDrawingSurfaceFinish({
          roughness: "Ra 1.6",
          anchorX: anchor.x,
          anchorY: anchor.y,
          labelX: label.x,
          labelY: label.y,
          parentViewId,
        });
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
          parentViewId,
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
        parentViewId: vertex.viewId,
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
          parentViewId: vertex.viewId,
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
          <button
            type="button"
            className={`${styles.toolbarButton}${viewsStale ? ` ${styles.toolbarButtonStale}` : ""}`}
            onClick={() => runCommand("drawing.update-views")}
            title={
              viewsStale
                ? t(
                    "drawing.viewsStaleTitle",
                    "The referenced part changed since these views were projected — Update Views re-projects them from the current geometry.",
                  )
                : undefined
            }
          >
            {viewsStale && <span className={styles.staleDot} aria-hidden="true" />}
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
              if (selectedViewId) {
                deleteDrawingView(selectedViewId);
                if (selectedViewId === activeViewId) setActiveViewId(null);
              }
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
        <ZoomCluster resetZoomPan={resetZoomPan} />
      </div>

      <div
        ref={scrollRef}
        className={styles.sheetScroll}
        /*
          * One undo step per drag gesture, not per pointer-move. Every draggable thing on
          * the sheet (views, notes, annotation labels/anchors, tables) fires its
          * documentStore update on each pointermove, and each of those would otherwise
          * push its own history entry — one view drag evicting everything before it from
          * the 30-step history. Capture phase so the gesture is armed before the child's
          * own pointerdown (the child calls setPointerCapture there, which retargets
          * later events but keeps them bubbling through here), and pointercancel so an
          * interrupted press doesn't leave a stale armed gesture behind. A press that
          * never changes anything never pushes: see `beginDragEdit`'s own doc comment.
        */
        onPointerDownCapture={() => beginDragEdit()}
        onPointerUpCapture={() => endDragEdit()}
        onPointerCancelCapture={() => endDragEdit()}
        onPointerDown={(event) => {
          // Middle-mouse drag pans the sheet, the same button the 3D viewport already
          // reserves for panning — left click stays free for select/place/pick.
          if (event.button !== 1) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const { panX: originPanX, panY: originPanY } = useDrawingToolStore.getState();
          panOrigin.current = { x: event.clientX, y: event.clientY, panX: originPanX, panY: originPanY };
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
          onDoubleClick={(event) => {
            // A view's own frame already stops this from bubbling up (see `PlacedView`'s
            // `onDoubleClick`), so reaching here means empty sheet — deactivates whatever
            // view was active. Skipped for the Ctrl/Cmd zoom-reset gesture so the two don't
            // fight over the same double-click.
            if (!event.ctrlKey && !event.metaKey) setActiveViewId(null);
          }}
          style={{ cursor: PICKING_TOOLS.has(tool) ? "crosshair" : "default" }}
        >
          <defs>
            {/* ISO 128-3: thin lines at 45°, uniform spacing — one shared pattern so every
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
              active={view.id === activeViewId}
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
              onToggleActive={() => setActiveViewId((current) => (current === view.id ? null : view.id))}
              onMove={(x, y) => moveDrawingView(view.id, x, y)}
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

          {/* Every Section/Detail view's own cutting-plane line / crop-boundary callout,
              drawn back onto whichever view it was cut/cropped from — see
              `SectionCutMarkView`/`DetailCalloutView`'s own doc comments. */}
          {views.map((sourceView) =>
            views
              .filter((view) => view.kind === "section" && view.section?.sourceViewId === sourceView.id)
              .map((sectionView) => (
                <SectionCutMarkView key={`cut-${sectionView.id}`} sourceView={sourceView} section={sectionView.section!} />
              )),
          )}
          {views.map((sourceView) =>
            views
              .filter((view) => view.kind === "detail" && view.detailOf?.sourceViewId === sourceView.id)
              .map((detailView) => (
                <DetailCalloutView
                  key={`detail-${detailView.id}`}
                  sourceView={sourceView}
                  detailOf={detailView.detailOf!}
                  label={detailView.label}
                />
              )),
          )}

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
              onMoveAnchor={(x, y) => updateDrawingDatum(datum.id, anchorMovePatch(x, y))}
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
              onMoveAnchor={(x, y) => updateDrawingGdt(gdt.id, anchorMovePatch(x, y))}
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
              onMoveAnchor={(x, y) => updateDrawingSurfaceFinish(finish.id, anchorMovePatch(x, y))}
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
              onMoveAnchor={(x, y) => updateDrawingWeld(weld.id, anchorMovePatch(x, y))}
              onEdit={(patch) => updateDrawingWeld(weld.id, patch)}
            />
          ))}

          {holeCallouts.map((callout) => (
            <HoleCalloutView
              key={callout.id}
              callout={callout}
              language={language}
              selected={selectedAnnotation?.kind === "holeCallout" && selectedAnnotation.id === callout.id}
              onSelect={() => selectAnnotation("holeCallout", callout.id)}
              onMove={(labelX, labelY) => updateDrawingHoleCallout(callout.id, { labelX, labelY })}
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
              <TitleBlockView
                titleBlock={titleBlock}
                values={titleBlockValues}
                projectionMethod={projectionMethod}
                onEditValue={setTitleBlockValue}
              />
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
