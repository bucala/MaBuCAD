import { useRef, useState } from "react";

import { useDrawingToolStore } from "@/state/drawingToolStore";
import type { DrawingWeldData, WeldSideData, WeldSymbolType } from "@/types/document";

import styles from "./DrawingSheet.module.css";

/** Matches `DrawingSheet.tsx`'s own constant — see its doc comment for why every drag
 * handler on this sheet divides by it rather than sharing one export. */
const SHEET_SCALE = 2.5;

const REF_LINE_LENGTH = 24;
const SIDE_OFFSET = 3;
const GLYPH_SIZE = 5;

const WELD_SYMBOL_LABELS: Record<WeldSymbolType, string> = {
  fillet: "Fillet",
  square: "Square groove",
  "v-groove": "V-groove",
  "bevel-groove": "Bevel-groove",
  "u-groove": "U-groove",
  "j-groove": "J-groove",
  "flare-v": "Flare-V",
  "flare-bevel": "Flare-bevel",
  plug: "Plug/Slot",
  spot: "Spot/Projection",
  seam: "Seam",
  backing: "Backing",
  surfacing: "Surfacing",
};

/**
 * One weld symbol's own glyph, ISO 2553 / AWS A2.4 shapes drawn in a fixed `GLYPH_SIZE`
 * box assuming the "below the reference line" (arrow-side) orientation — `y` grows from 0
 * (on the line) down to `GLYPH_SIZE` (away from it). The caller flips this vertically for
 * the other side, so only one orientation needs drawing per symbol.
 */
function WeldGlyph({ type }: { type: WeldSymbolType }) {
  const s = GLYPH_SIZE;
  switch (type) {
    case "fillet":
      return <polygon points={`0,0 ${s},0 0,${s}`} className={styles.weldMark} />;
    case "square":
      return <path d={`M1,0 L1,${s} M${s - 1},0 L${s - 1},${s}`} className={styles.weldMark} />;
    case "v-groove":
      return <polyline points={`0,0 ${s / 2},${s} ${s},0`} className={styles.weldMark} />;
    case "bevel-groove":
      return <path d={`M0,0 L0,${s} L${s},0`} className={styles.weldMark} />;
    case "u-groove":
      return <path d={`M0,0 L0,${s * 0.6} A${s / 2},${s * 0.4} 0 0 0 ${s},${s * 0.6} L${s},0`} className={styles.weldMark} />;
    case "j-groove":
      return <path d={`M0,0 L0,${s * 0.6} Q${s * 0.2},${s} ${s},0`} className={styles.weldMark} />;
    case "flare-v":
      return <path d={`M0,0 Q${s / 2},${s * 0.6} ${s / 2},${s} Q${s / 2},${s * 0.6} ${s},0`} className={styles.weldMark} />;
    case "flare-bevel":
      return <path d={`M0,0 L0,${s} Q${s / 2},${s * 0.6} ${s},0`} className={styles.weldMark} />;
    case "plug":
      return <rect x={0.5} y={0} width={s - 1} height={s - 1} className={styles.weldMark} />;
    case "spot":
      return <circle cx={s / 2} cy={s / 2} r={s / 2 - 0.5} className={styles.weldMark} />;
    case "seam":
      return <circle cx={s / 2} cy={s / 2} r={s / 2 - 0.5} className={styles.weldMarkFilled} />;
    case "backing":
      return <rect x={0.5} y={s - 1.5} width={s - 1} height={1.5} className={styles.weldMarkFilled} />;
    case "surfacing":
      return <path d={`M0,${s / 2} Q${s / 4},0 ${s / 2},${s / 2} T${s},${s / 2}`} className={styles.weldMark} />;
    default:
      return null;
  }
}

/** One side's own contour mark, drawn right on the reference line span the symbol sits
 * under/over — flat is a plain reinforcement of the line, convex bulges away from the
 * joint, concave bulges into it (the finished weld face's own cross-section, ISO 2553's own
 * "contour symbol" convention). */
function ContourMark({ contour }: { contour: NonNullable<WeldSideData["contour"]> }) {
  const bulge = contour === "convex" ? -1.5 : contour === "concave" ? 1.5 : 0;
  return <path d={`M0,0 Q${GLYPH_SIZE / 2},${bulge} ${GLYPH_SIZE},0`} className={styles.weldMark} />;
}

/** One side of a weld callout (arrow side or other side) — symbol glyph, size to the left,
 * length/pitch to the right, contour along the line. `mirrored` flips the whole thing above
 * the reference line for the other side. */
function WeldSideGlyph({ side, mirrored }: { side: WeldSideData; mirrored: boolean }) {
  return (
    <g transform={mirrored ? "scale(1,-1)" : undefined}>
      <WeldGlyph type={side.symbol} />
      {side.contour && <ContourMark contour={side.contour} />}
      {side.size && (
        <text x={-1} y={GLYPH_SIZE / 2} textAnchor="end" dominantBaseline="middle" className={styles.dimensionLabelSmall}>
          {side.size}
        </text>
      )}
      {(side.length || side.pitch) && (
        <text x={GLYPH_SIZE + 1} y={GLYPH_SIZE / 2} dominantBaseline="middle" className={styles.dimensionLabelSmall}>
          {side.length}
          {side.pitch ? `-${side.pitch}` : ""}
        </text>
      )}
      {side.angle && (
        <text x={GLYPH_SIZE / 2} y={-1} textAnchor="middle" className={styles.dimensionLabelSmall}>
          {side.angle}°
        </text>
      )}
    </g>
  );
}

/** A small pennant flag at the bend point — ISO 2553's own "field weld" (made on site,
 * rather than in the shop) marker. */
function FieldWeldFlag() {
  return (
    <g>
      <line x1={0} y1={0} x2={0} y2={-6} className={styles.weldMark} />
      <polygon points="0,-6 4,-4.5 0,-3" className={styles.weldMarkFilled} />
    </g>
  );
}

/**
 * An ISO 2553 / AWS A2.4 weld symbol — a leader from the joint to a bend point, then a
 * horizontal reference line carrying the arrow-side symbol below it and the other-side
 * symbol above it. Double-click opens a form covering both sides plus all-around/field-weld/
 * tail — see `DrawingWeldData`'s own doc comment for the full field list.
 */
export function WeldView({
  weld,
  selected,
  onSelect,
  onMove,
  onMoveAnchor,
  onEdit,
}: {
  weld: DrawingWeldData;
  selected: boolean;
  onSelect: () => void;
  onMove: (labelX: number, labelY: number) => void;
  onMoveAnchor: (anchorX: number, anchorY: number) => void;
  onEdit: (patch: Partial<DrawingWeldData>) => void;
}) {
  const zoom = useDrawingToolStore((state) => state.zoom);
  const dragOrigin = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const anchorDragOrigin = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);

  return (
    <g className={selected ? styles.dimensionSelected : styles.dimension}>
      <line x1={weld.anchorX} y1={weld.anchorY} x2={weld.labelX} y2={weld.labelY} className={styles.leaderLine} />
      {/* The leader's own anchor end, draggable independently of the reference line —
          visible only while selected, matching `SymbolAnnotations.tsx`'s own `AnchorHandle`. */}
      {selected && (
        <circle
          cx={weld.anchorX}
          cy={weld.anchorY}
          r={1.4}
          className={styles.anchorHandle}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            anchorDragOrigin.current = { pointerX: event.clientX, pointerY: event.clientY, x: weld.anchorX, y: weld.anchorY };
          }}
          onPointerMove={(event) => {
            if (!anchorDragOrigin.current) return;
            const dx = (event.clientX - anchorDragOrigin.current.pointerX) / (SHEET_SCALE * zoom);
            const dy = (event.clientY - anchorDragOrigin.current.pointerY) / (SHEET_SCALE * zoom);
            onMoveAnchor(anchorDragOrigin.current.x + dx, anchorDragOrigin.current.y + dy);
          }}
          onPointerUp={() => {
            anchorDragOrigin.current = null;
          }}
        />
      )}
      <g transform={`translate(${weld.labelX} ${weld.labelY})`}>
        {weld.allAround && <circle cx={0} cy={0} r={1.4} className={styles.weldMark} />}
        {weld.fieldWeld && <FieldWeldFlag />}
        <g
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            setEditing(true);
          }}
          onPointerDown={(event) => {
            if (editing) return;
            event.stopPropagation();
            onSelect();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragOrigin.current = { pointerX: event.clientX, pointerY: event.clientY, x: weld.labelX, y: weld.labelY };
          }}
          onPointerMove={(event) => {
            if (!dragOrigin.current) return;
            const dx = (event.clientX - dragOrigin.current.pointerX) / (SHEET_SCALE * zoom);
            const dy = (event.clientY - dragOrigin.current.pointerY) / (SHEET_SCALE * zoom);
            onMove(dragOrigin.current.x + dx, dragOrigin.current.y + dy);
          }}
          onPointerUp={() => {
            dragOrigin.current = null;
          }}
        >
          <line x1={0} y1={0} x2={REF_LINE_LENGTH} y2={0} className={styles.weldReferenceLine} />
          {weld.arrowSide && (
            <g transform={`translate(${SIDE_OFFSET} 0)`}>
              <WeldSideGlyph side={weld.arrowSide} mirrored={false} />
            </g>
          )}
          {weld.otherSide && (
            <g transform={`translate(${SIDE_OFFSET} 0)`}>
              <WeldSideGlyph side={weld.otherSide} mirrored={true} />
            </g>
          )}
          {weld.tail && (
            <text x={REF_LINE_LENGTH + 2} y={0} dominantBaseline="middle" className={styles.dimensionLabelSmall}>
              {weld.tail}
            </text>
          )}
        </g>
        {editing && (
          <foreignObject x={-10} y={8} width={260} height={175}>
            <WeldEditForm
              weld={weld}
              onDone={(patch) => {
                onEdit(patch);
                setEditing(false);
              }}
            />
          </foreignObject>
        )}
      </g>
    </g>
  );
}

function WeldSideFields({
  label,
  side,
  onChange,
}: {
  label: string;
  side: WeldSideData | null;
  onChange: (side: WeldSideData | null) => void;
}) {
  return (
    <div className={styles.gdtFormGroup}>
      <div className={styles.gdtFormRow}>
        <span className={styles.gdtFormCheckLabel}>{label}</span>
        <select
          value={side?.symbol ?? ""}
          onChange={(event) => {
            const symbol = event.target.value as WeldSymbolType | "";
            onChange(symbol ? { ...side, symbol } : null);
          }}
          className={styles.gdtFormInput}
        >
          <option value="">— none —</option>
          {(Object.keys(WELD_SYMBOL_LABELS) as WeldSymbolType[]).map((type) => (
            <option key={type} value={type}>
              {WELD_SYMBOL_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      {side && (
        <div className={styles.gdtFormRow}>
          <input
            value={side.size ?? ""}
            placeholder="size"
            onChange={(event) => onChange({ ...side, size: event.target.value })}
            className={styles.gdtFormInput}
          />
          <input
            value={side.length ?? ""}
            placeholder="length"
            onChange={(event) => onChange({ ...side, length: event.target.value })}
            className={styles.gdtFormInput}
          />
          <input
            value={side.pitch ?? ""}
            placeholder="pitch"
            onChange={(event) => onChange({ ...side, pitch: event.target.value })}
            className={styles.gdtFormInput}
          />
          <select
            value={side.contour ?? ""}
            onChange={(event) =>
              onChange({ ...side, contour: (event.target.value || undefined) as WeldSideData["contour"] })
            }
            className={styles.gdtFormInput}
          >
            <option value="">as welded</option>
            <option value="flat">flat</option>
            <option value="convex">convex</option>
            <option value="concave">concave</option>
          </select>
        </div>
      )}
    </div>
  );
}

function WeldEditForm({ weld, onDone }: { weld: DrawingWeldData; onDone: (patch: Partial<DrawingWeldData>) => void }) {
  const [arrowSide, setArrowSide] = useState(weld.arrowSide);
  const [otherSide, setOtherSide] = useState(weld.otherSide);
  const [allAround, setAllAround] = useState(weld.allAround);
  const [fieldWeld, setFieldWeld] = useState(weld.fieldWeld);
  const [tail, setTail] = useState(weld.tail ?? "");

  const commit = () => onDone({ arrowSide, otherSide, allAround, fieldWeld, tail: tail || undefined });

  return (
    <div className={styles.gdtForm} onClick={(event) => event.stopPropagation()}>
      <WeldSideFields label="Arrow side" side={arrowSide} onChange={setArrowSide} />
      <WeldSideFields label="Other side" side={otherSide} onChange={setOtherSide} />
      <div className={styles.gdtFormRow}>
        <label className={styles.gdtFormCheckLabel}>
          <input type="checkbox" checked={allAround} onChange={(event) => setAllAround(event.target.checked)} />
          all around
        </label>
        <label className={styles.gdtFormCheckLabel}>
          <input type="checkbox" checked={fieldWeld} onChange={(event) => setFieldWeld(event.target.checked)} />
          field weld
        </label>
      </div>
      <div className={styles.gdtFormRow}>
        <input
          value={tail}
          placeholder="tail (process/spec)"
          onChange={(event) => setTail(event.target.value)}
          className={styles.gdtFormInput}
        />
        <button type="button" className={styles.gdtFormDone} onClick={commit}>
          Done
        </button>
      </div>
    </div>
  );
}
