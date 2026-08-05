import { useRef, useState } from "react";

import { useDrawingToolStore } from "@/state/drawingToolStore";
import type { DrawingDatumData, DrawingGdtData, DrawingSurfaceFinishData, GdtSymbol } from "@/types/document";

import styles from "./DrawingSheet.module.css";

/** Matches `DrawingSheet.tsx`'s own constant — see its doc comment for why every drag
 * handler on this sheet divides by it rather than sharing one export. */
const SHEET_SCALE = 2.5;

/** Short, always-renderable labels for each GD&T characteristic — real ASME Y14.5 symbols
 * live in a Unicode range (Miscellaneous Technical) this app can't guarantee is covered by
 * whatever font the host renders with, so a plain abbreviation that always shows something
 * legible beats a glyph that might render as a blank box. */
const GDT_LABELS: Record<GdtSymbol, string> = {
  position: "POS",
  flatness: "FLT",
  straightness: "STR",
  circularity: "CIRC",
  cylindricity: "CYL",
  perpendicularity: "⊥",
  parallelism: "∥",
  angularity: "∠",
  runout: "RUN",
  concentricity: "◎",
};

function useDrag(onMove: (x: number, y: number) => void, x: number, y: number) {
  const zoom = useDrawingToolStore((state) => state.zoom);
  const dragOrigin = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);

  return {
    onPointerDown: (event: React.PointerEvent) => {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragOrigin.current = { pointerX: event.clientX, pointerY: event.clientY, x, y };
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (!dragOrigin.current) return;
      const dx = (event.clientX - dragOrigin.current.pointerX) / (SHEET_SCALE * zoom);
      const dy = (event.clientY - dragOrigin.current.pointerY) / (SHEET_SCALE * zoom);
      onMove(dragOrigin.current.x + dx, dragOrigin.current.y + dy);
    },
    onPointerUp: () => {
      dragOrigin.current = null;
    },
  };
}

/** A datum feature symbol — boxed letter + filled triangle, leadered to the feature it
 * references (ASME Y14.5's own "named reference" convention). Double-click renames the
 * letter, the same inline-edit shape `NoteView` uses for its text. */
export function DatumView({
  datum,
  selected,
  onSelect,
  onMove,
  onRename,
}: {
  datum: DrawingDatumData;
  selected: boolean;
  onSelect: () => void;
  onMove: (labelX: number, labelY: number) => void;
  onRename: (letter: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const drag = useDrag(onMove, datum.labelX, datum.labelY);

  return (
    <g className={selected ? styles.dimensionSelected : styles.dimension}>
      <line x1={datum.anchorX} y1={datum.anchorY} x2={datum.labelX} y2={datum.labelY} className={styles.leaderLine} />
      <polygon
        points={`${datum.anchorX},${datum.anchorY} ${datum.anchorX - 1.5},${datum.anchorY - 3} ${datum.anchorX + 1.5},${datum.anchorY - 3}`}
        className={styles.datumTriangle}
      />
      <g
        transform={`translate(${datum.labelX} ${datum.labelY})`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          setEditing(true);
        }}
        {...drag}
      >
        <rect x={-4} y={-4} width={8} height={8} className={styles.datumBox} />
        {editing ? (
          <foreignObject x={-10} y={-5} width={20} height={10}>
            <input
              autoFocus
              defaultValue={datum.letter}
              maxLength={2}
              className={styles.noteInput}
              onClick={(event) => event.stopPropagation()}
              onBlur={(event) => {
                onRename(event.target.value.trim().toUpperCase() || datum.letter);
                setEditing(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") setEditing(false);
              }}
            />
          </foreignObject>
        ) : (
          <text textAnchor="middle" dominantBaseline="middle" className={styles.datumLetter}>
            {datum.letter}
          </text>
        )}
      </g>
    </g>
  );
}

const FRAME_ROW_HEIGHT = 7;
const SYMBOL_CELL_WIDTH = 8;
const TOLERANCE_CELL_WIDTH = 14;
const DATUM_CELL_WIDTH = 6;

/** A GD&T feature control frame — symbol, tolerance and up to three datum references in
 * their own compartments, leadered to the feature they constrain. Double-click opens an
 * inline form for all three fields at once, the same "small popover form" shape
 * `SketchContextMenu.tsx`'s own inline edits use for a multi-field value. */
export function GdtView({
  gdt,
  selected,
  onSelect,
  onMove,
  onEdit,
}: {
  gdt: DrawingGdtData;
  selected: boolean;
  onSelect: () => void;
  onMove: (labelX: number, labelY: number) => void;
  onEdit: (patch: { symbol: GdtSymbol; tolerance: string; datums: string[] }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const drag = useDrag(onMove, gdt.labelX, gdt.labelY);

  const datumCells = gdt.datums.length > 0 ? gdt.datums : [];
  const width = SYMBOL_CELL_WIDTH + TOLERANCE_CELL_WIDTH + datumCells.length * DATUM_CELL_WIDTH;

  return (
    <g className={selected ? styles.dimensionSelected : styles.dimension}>
      <line x1={gdt.anchorX} y1={gdt.anchorY} x2={gdt.labelX} y2={gdt.labelY} className={styles.leaderLine} />
      <g
        transform={`translate(${gdt.labelX - width / 2} ${gdt.labelY - FRAME_ROW_HEIGHT / 2})`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          setEditing(true);
        }}
        {...drag}
      >
        <rect x={0} y={0} width={width} height={FRAME_ROW_HEIGHT} className={styles.gdtFrame} />
        <line x1={SYMBOL_CELL_WIDTH} y1={0} x2={SYMBOL_CELL_WIDTH} y2={FRAME_ROW_HEIGHT} className={styles.gdtDivider} />
        <text x={SYMBOL_CELL_WIDTH / 2} y={FRAME_ROW_HEIGHT / 2} textAnchor="middle" dominantBaseline="middle" className={styles.gdtText}>
          {GDT_LABELS[gdt.symbol]}
        </text>
        <line
          x1={SYMBOL_CELL_WIDTH + TOLERANCE_CELL_WIDTH}
          y1={0}
          x2={SYMBOL_CELL_WIDTH + TOLERANCE_CELL_WIDTH}
          y2={FRAME_ROW_HEIGHT}
          className={styles.gdtDivider}
        />
        <text
          x={SYMBOL_CELL_WIDTH + TOLERANCE_CELL_WIDTH / 2}
          y={FRAME_ROW_HEIGHT / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className={styles.gdtText}
        >
          {gdt.tolerance}
        </text>
        {datumCells.map((letter, index) => (
          <g key={index}>
            {index > 0 && (
              <line
                x1={SYMBOL_CELL_WIDTH + TOLERANCE_CELL_WIDTH + index * DATUM_CELL_WIDTH}
                y1={0}
                x2={SYMBOL_CELL_WIDTH + TOLERANCE_CELL_WIDTH + index * DATUM_CELL_WIDTH}
                y2={FRAME_ROW_HEIGHT}
                className={styles.gdtDivider}
              />
            )}
            <text
              x={SYMBOL_CELL_WIDTH + TOLERANCE_CELL_WIDTH + index * DATUM_CELL_WIDTH + DATUM_CELL_WIDTH / 2}
              y={FRAME_ROW_HEIGHT / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              className={styles.gdtText}
            >
              {letter}
            </text>
          </g>
        ))}
      </g>
      {editing && (
        <foreignObject
          x={gdt.labelX - 40}
          y={gdt.labelY + 5}
          width={80}
          height={34}
         
        >
          <GdtEditForm gdt={gdt} onDone={(patch) => { onEdit(patch); setEditing(false); }} />
        </foreignObject>
      )}
    </g>
  );
}

function GdtEditForm({
  gdt,
  onDone,
}: {
  gdt: DrawingGdtData;
  onDone: (patch: { symbol: GdtSymbol; tolerance: string; datums: string[] }) => void;
}) {
  const [symbol, setSymbol] = useState<GdtSymbol>(gdt.symbol);
  const [tolerance, setTolerance] = useState(gdt.tolerance);
  const [datums, setDatums] = useState(gdt.datums.join(""));

  const commit = () => onDone({ symbol, tolerance, datums: datums.toUpperCase().split("").filter(Boolean) });

  return (
    <div className={styles.gdtForm} onClick={(event) => event.stopPropagation()}>
      <select value={symbol} onChange={(event) => setSymbol(event.target.value as GdtSymbol)} className={styles.gdtFormInput}>
        {(Object.keys(GDT_LABELS) as GdtSymbol[]).map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
      <input
        value={tolerance}
        placeholder="0.05"
        onChange={(event) => setTolerance(event.target.value)}
        className={styles.gdtFormInput}
      />
      <input
        value={datums}
        placeholder="A B C"
        maxLength={3}
        onChange={(event) => setDatums(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && commit()}
        onBlur={commit}
        className={styles.gdtFormInput}
      />
    </div>
  );
}

/** An ISO 1302 surface finish (roughness) symbol — a checkmark with the roughness value
 * above it, leadered to the surface it applies to. Double-click edits the value inline. */
export function SurfaceFinishView({
  finish,
  selected,
  onSelect,
  onMove,
  onEdit,
}: {
  finish: DrawingSurfaceFinishData;
  selected: boolean;
  onSelect: () => void;
  onMove: (labelX: number, labelY: number) => void;
  onEdit: (roughness: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const drag = useDrag(onMove, finish.labelX, finish.labelY);

  return (
    <g className={selected ? styles.dimensionSelected : styles.dimension}>
      <line
        x1={finish.anchorX}
        y1={finish.anchorY}
        x2={finish.labelX}
        y2={finish.labelY}
        className={styles.leaderLine}
      />
      <g
        transform={`translate(${finish.labelX} ${finish.labelY})`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          setEditing(true);
        }}
        {...drag}
      >
        {/* Basic ISO 1302 symbol: a short tick rising into a longer one, forming a check. */}
        <polyline points="-4,0 -1,4 6,-6" className={styles.surfaceFinishMark} />
        {editing ? (
          <foreignObject x={-14} y={-16} width={28} height={10}>
            <input
              autoFocus
              defaultValue={finish.roughness}
              className={styles.noteInput}
              onClick={(event) => event.stopPropagation()}
              onBlur={(event) => {
                onEdit(event.target.value);
                setEditing(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") setEditing(false);
              }}
            />
          </foreignObject>
        ) : (
          finish.roughness && (
            <text x={0} y={-8} textAnchor="middle" className={styles.dimensionLabel}>
              {finish.roughness}
            </text>
          )
        )}
      </g>
    </g>
  );
}
