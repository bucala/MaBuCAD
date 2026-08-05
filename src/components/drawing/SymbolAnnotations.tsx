import { useRef, useState } from "react";

import { useDrawingToolStore } from "@/state/drawingToolStore";
import type {
  DrawingDatumData,
  DrawingGdtData,
  DrawingSurfaceFinishData,
  GdtDatumReference,
  GdtModifier,
  GdtSymbol,
  SurfaceFinishSymbolType,
  SurfaceLaySymbol,
} from "@/types/document";

import styles from "./DrawingSheet.module.css";

/** Matches `DrawingSheet.tsx`'s own constant — see its doc comment for why every drag
 * handler on this sheet divides by it rather than sharing one export. */
const SHEET_SCALE = 2.5;

/**
 * ASME Y14.5's own geometric-characteristic glyphs. Unicode's Miscellaneous Technical block
 * (U+2300–U+23FF) and Mathematical Operators block carry dedicated code points for most of
 * these — ⌖ position, ⏥ flatness, ⏤ straightness, ⌭ cylindricity, ⌰ total runout, ⌯
 * symmetry, ⌒ profile of a line, ⌓ profile of a surface — with solid coverage in the
 * symbol fonts this app's Windows-native target ships (Segoe UI Symbol). Circularity has no
 * dedicated point (every CAD package's own UI falls back to a plain circle too); runout has
 * none either — a single arrow (↗) is the closest common approximation, not a real ISO/ASME
 * glyph, since Unicode carries no runout-specific arrowhead shape.
 */
const GDT_LABELS: Record<GdtSymbol, string> = {
  position: "⌖",
  flatness: "⏥",
  straightness: "⏤",
  circularity: "○",
  cylindricity: "⌭",
  perpendicularity: "⊥",
  parallelism: "∥",
  angularity: "∠",
  runout: "↗",
  "total-runout": "⌰",
  concentricity: "◎",
  symmetry: "⌯",
  "profile-line": "⌒",
  "profile-surface": "⌓",
};

/** ASME Y14.5's circled-letter material-condition modifiers. */
const MODIFIER_GLYPHS: Record<GdtModifier, string> = { MMC: "Ⓜ", LMC: "Ⓛ" };

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

/**
 * The leader's own anchor end, draggable independently of the label — every leadered
 * annotation on this sheet (Datum/GD&T/Surface Finish/Weld) placed its anchor once at
 * creation time (a `nearestVertex` snap or a raw click) and offered no way to move it
 * afterward; if the referenced view is later repositioned, or the wrong vertex was picked,
 * the leader stayed stuck. A small filled circle at the anchor point, visible only while
 * this annotation is selected (so it doesn't clutter a dense drawing's every symbol at
 * once), re-attaches it to wherever it's dragged.
 */
function AnchorHandle({
  x,
  y,
  selected,
  onSelect,
  onMove,
}: {
  x: number;
  y: number;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const drag = useDrag(onMove, x, y);
  if (!selected) return null;
  return (
    <circle
      cx={x}
      cy={y}
      r={1.4}
      className={styles.anchorHandle}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      {...drag}
    />
  );
}

/** A datum feature symbol — boxed letter + filled triangle, leadered to the feature it
 * references (ASME Y14.5's own "named reference" convention). Double-click renames the
 * letter, the same inline-edit shape `NoteView` uses for its text. */
export function DatumView({
  datum,
  selected,
  onSelect,
  onMove,
  onMoveAnchor,
  onRename,
}: {
  datum: DrawingDatumData;
  selected: boolean;
  onSelect: () => void;
  onMove: (labelX: number, labelY: number) => void;
  onMoveAnchor: (anchorX: number, anchorY: number) => void;
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
      <AnchorHandle x={datum.anchorX} y={datum.anchorY} selected={selected} onSelect={onSelect} onMove={onMoveAnchor} />
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
const TOLERANCE_CELL_WIDTH = 18;
const DATUM_CELL_WIDTH = 8;

type GdtEditPatch = {
  symbol: GdtSymbol;
  diameter: boolean;
  tolerance: string;
  modifier: GdtModifier | undefined;
  datums: string[];
  datumRefs: GdtDatumReference[];
};

/** A GD&T feature control frame — symbol, an optional ⌀ prefix, tolerance value and its own
 * material-condition modifier, and up to three datum references (each with its own
 * modifier) in their own compartments, leadered to the feature they constrain. Double-click
 * opens an inline form covering every field at once, the same "small popover form" shape
 * `SketchContextMenu.tsx`'s own inline edits use for a multi-field value. */
export function GdtView({
  gdt,
  selected,
  onSelect,
  onMove,
  onMoveAnchor,
  onEdit,
}: {
  gdt: DrawingGdtData;
  selected: boolean;
  onSelect: () => void;
  onMove: (labelX: number, labelY: number) => void;
  onMoveAnchor: (anchorX: number, anchorY: number) => void;
  onEdit: (patch: GdtEditPatch) => void;
}) {
  const [editing, setEditing] = useState(false);
  const drag = useDrag(onMove, gdt.labelX, gdt.labelY);

  const datumRefs: GdtDatumReference[] = gdt.datumRefs ?? gdt.datums.map((letter) => ({ letter }));
  const width = SYMBOL_CELL_WIDTH + TOLERANCE_CELL_WIDTH + datumRefs.length * DATUM_CELL_WIDTH;
  const toleranceText = `${gdt.diameter ? "⌀" : ""}${gdt.tolerance}${gdt.modifier ? MODIFIER_GLYPHS[gdt.modifier] : ""}`;

  return (
    <g className={selected ? styles.dimensionSelected : styles.dimension}>
      <line x1={gdt.anchorX} y1={gdt.anchorY} x2={gdt.labelX} y2={gdt.labelY} className={styles.leaderLine} />
      <AnchorHandle x={gdt.anchorX} y={gdt.anchorY} selected={selected} onSelect={onSelect} onMove={onMoveAnchor} />
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
          {toleranceText}
        </text>
        {datumRefs.map((ref, index) => (
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
              {ref.letter}
              {ref.modifier ? MODIFIER_GLYPHS[ref.modifier] : ""}
            </text>
          </g>
        ))}
      </g>
      {editing && (
        <foreignObject x={gdt.labelX - 55} y={gdt.labelY + 5} width={110} height={92}>
          <GdtEditForm
            gdt={gdt}
            onDone={(patch) => {
              onEdit(patch);
              setEditing(false);
            }}
          />
        </foreignObject>
      )}
    </g>
  );
}

function GdtEditForm({ gdt, onDone }: { gdt: DrawingGdtData; onDone: (patch: GdtEditPatch) => void }) {
  const [symbol, setSymbol] = useState<GdtSymbol>(gdt.symbol);
  const [diameter, setDiameter] = useState(gdt.diameter ?? false);
  const [tolerance, setTolerance] = useState(gdt.tolerance);
  const [modifier, setModifier] = useState<GdtModifier | "">(gdt.modifier ?? "");
  const [datumRefs, setDatumRefs] = useState<GdtDatumReference[]>(() => {
    const seed: GdtDatumReference[] = gdt.datumRefs ?? gdt.datums.map((letter) => ({ letter }));
    const rows = [...seed];
    while (rows.length < 3) rows.push({ letter: "" });
    return rows.slice(0, 3);
  });

  const commit = () => {
    const nonEmpty = datumRefs
      .map((ref) => ({ ...ref, letter: ref.letter.trim().toUpperCase() }))
      .filter((ref) => ref.letter);
    onDone({
      symbol,
      diameter,
      tolerance,
      modifier: modifier || undefined,
      datums: nonEmpty.map((ref) => ref.letter),
      datumRefs: nonEmpty,
    });
  };

  const setDatumLetter = (index: number, letter: string) =>
    setDatumRefs((rows) => rows.map((row, i) => (i === index ? { ...row, letter } : row)));
  const setDatumModifier = (index: number, value: GdtModifier | "") =>
    setDatumRefs((rows) => rows.map((row, i) => (i === index ? { ...row, modifier: value || undefined } : row)));

  return (
    <div className={styles.gdtForm} onClick={(event) => event.stopPropagation()}>
      <select value={symbol} onChange={(event) => setSymbol(event.target.value as GdtSymbol)} className={styles.gdtFormInput}>
        {(Object.keys(GDT_LABELS) as GdtSymbol[]).map((key) => (
          <option key={key} value={key}>
            {GDT_LABELS[key]} {key}
          </option>
        ))}
      </select>
      <div className={styles.gdtFormRow}>
        <label className={styles.gdtFormCheckLabel}>
          <input type="checkbox" checked={diameter} onChange={(event) => setDiameter(event.target.checked)} />
          ⌀
        </label>
        <input
          value={tolerance}
          placeholder="0.05"
          onChange={(event) => setTolerance(event.target.value)}
          className={styles.gdtFormInput}
        />
        <select
          value={modifier}
          onChange={(event) => setModifier(event.target.value as GdtModifier | "")}
          className={styles.gdtFormInput}
        >
          <option value="">RFS</option>
          <option value="MMC">Ⓜ MMC</option>
          <option value="LMC">Ⓛ LMC</option>
        </select>
      </div>
      {datumRefs.map((ref, index) => (
        <div className={styles.gdtFormRow} key={index}>
          <input
            value={ref.letter}
            placeholder={`Datum ${index + 1}`}
            maxLength={1}
            onChange={(event) => setDatumLetter(index, event.target.value)}
            className={styles.gdtFormInput}
          />
          <select
            value={ref.modifier ?? ""}
            onChange={(event) => setDatumModifier(index, event.target.value as GdtModifier | "")}
            className={styles.gdtFormInput}
          >
            <option value="">RFS</option>
            <option value="MMC">Ⓜ MMC</option>
            <option value="LMC">Ⓛ LMC</option>
          </select>
        </div>
      ))}
      <button type="button" className={styles.gdtFormDone} onClick={commit}>
        Done
      </button>
    </div>
  );
}

const LAY_SYMBOLS: SurfaceLaySymbol[] = ["=", "⊥", "X", "M", "C", "R", "P"];

type SurfaceFinishEditPatch = {
  roughness: string;
  symbolType: SurfaceFinishSymbolType;
  allAround: boolean;
  manufacturingMethod: string;
  laySymbol: SurfaceLaySymbol | undefined;
  allowance: string;
};

/**
 * An ISO 1302 surface finish (roughness) symbol, leadered to the surface it applies to —
 * the base tick shape decorated per `symbolType` (a bar for "machining required", a circle
 * at the vertex for "machining prohibited"), plus an optional small circle at the leader
 * attachment point for "all around". Double-click opens a form covering every ISO 1302
 * field this app supports: roughness, manufacturing method, lay direction, and allowance.
 */
export function SurfaceFinishView({
  finish,
  selected,
  onSelect,
  onMove,
  onMoveAnchor,
  onEdit,
}: {
  finish: DrawingSurfaceFinishData;
  selected: boolean;
  onSelect: () => void;
  onMove: (labelX: number, labelY: number) => void;
  onMoveAnchor: (anchorX: number, anchorY: number) => void;
  onEdit: (patch: SurfaceFinishEditPatch) => void;
}) {
  const [editing, setEditing] = useState(false);
  const drag = useDrag(onMove, finish.labelX, finish.labelY);

  const symbolType = finish.symbolType ?? "basic";
  const roughnessLine = [finish.roughness, finish.laySymbol].filter(Boolean).join(" ");

  return (
    <g className={selected ? styles.dimensionSelected : styles.dimension}>
      <line
        x1={finish.anchorX}
        y1={finish.anchorY}
        x2={finish.labelX}
        y2={finish.labelY}
        className={styles.leaderLine}
      />
      <AnchorHandle x={finish.anchorX} y={finish.anchorY} selected={selected} onSelect={onSelect} onMove={onMoveAnchor} />
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
        {/* Basic ISO 1302 symbol: a short tick rising into a longer one, forming a check —
            vertex at (-1,4), the long leg's own tip at (6,-6). */}
        <polyline points="-4,0 -1,4 6,-6" className={styles.surfaceFinishMark} />
        {symbolType === "machining-required" && (
          <path d="M6,-6 L6,-9 M3,-9 L9,-9" className={styles.surfaceFinishMark} />
        )}
        {symbolType === "machining-prohibited" && (
          <circle cx={-1} cy={4} r={3.2} className={styles.surfaceFinishMark} fill="none" />
        )}
        {finish.allAround && <circle cx={0} cy={0} r={1.1} className={styles.surfaceFinishAllAround} />}
        {finish.allowance && (
          <text x={-7} y={4} textAnchor="end" dominantBaseline="middle" className={styles.dimensionLabel}>
            {finish.allowance}
          </text>
        )}
        {roughnessLine && (
          <text x={0} y={-8} textAnchor="middle" className={styles.dimensionLabel}>
            {roughnessLine}
          </text>
        )}
        {finish.manufacturingMethod && (
          <text x={0} y={-13} textAnchor="middle" className={styles.dimensionLabel}>
            {finish.manufacturingMethod}
          </text>
        )}
      </g>
      {editing && (
        <foreignObject x={finish.labelX - 55} y={finish.labelY - 76} width={110} height={70}>
          <SurfaceFinishEditForm
            finish={finish}
            onDone={(patch) => {
              onEdit(patch);
              setEditing(false);
            }}
          />
        </foreignObject>
      )}
    </g>
  );
}

function SurfaceFinishEditForm({
  finish,
  onDone,
}: {
  finish: DrawingSurfaceFinishData;
  onDone: (patch: SurfaceFinishEditPatch) => void;
}) {
  const [roughness, setRoughness] = useState(finish.roughness);
  const [symbolType, setSymbolType] = useState<SurfaceFinishSymbolType>(finish.symbolType ?? "basic");
  const [allAround, setAllAround] = useState(finish.allAround ?? false);
  const [manufacturingMethod, setManufacturingMethod] = useState(finish.manufacturingMethod ?? "");
  const [laySymbol, setLaySymbol] = useState<SurfaceLaySymbol | "">(finish.laySymbol ?? "");
  const [allowance, setAllowance] = useState(finish.allowance ?? "");

  const commit = () =>
    onDone({ roughness, symbolType, allAround, manufacturingMethod, laySymbol: laySymbol || undefined, allowance });

  return (
    <div className={styles.gdtForm} onClick={(event) => event.stopPropagation()}>
      <div className={styles.gdtFormRow}>
        <input
          value={roughness}
          placeholder="Ra 1.6"
          onChange={(event) => setRoughness(event.target.value)}
          className={styles.gdtFormInput}
        />
        <select
          value={laySymbol}
          onChange={(event) => setLaySymbol(event.target.value as SurfaceLaySymbol | "")}
          className={styles.gdtFormInput}
        >
          <option value="">lay: —</option>
          {LAY_SYMBOLS.map((symbol) => (
            <option key={symbol} value={symbol}>
              lay: {symbol}
            </option>
          ))}
        </select>
      </div>
      <select
        value={symbolType}
        onChange={(event) => setSymbolType(event.target.value as SurfaceFinishSymbolType)}
        className={styles.gdtFormInput}
      >
        <option value="basic">any process</option>
        <option value="machining-required">machining required</option>
        <option value="machining-prohibited">machining prohibited</option>
      </select>
      <div className={styles.gdtFormRow}>
        <input
          value={manufacturingMethod}
          placeholder="method (e.g. GROUND)"
          onChange={(event) => setManufacturingMethod(event.target.value)}
          className={styles.gdtFormInput}
        />
        <input
          value={allowance}
          placeholder="allowance"
          onChange={(event) => setAllowance(event.target.value)}
          className={styles.gdtFormInput}
        />
      </div>
      <div className={styles.gdtFormRow}>
        <label className={styles.gdtFormCheckLabel}>
          <input type="checkbox" checked={allAround} onChange={(event) => setAllAround(event.target.checked)} />
          all around
        </label>
        <button type="button" className={styles.gdtFormDone} onClick={commit}>
          Done
        </button>
      </div>
    </div>
  );
}
