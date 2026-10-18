import { useRef, useState } from "react";

import { useDrawingToolStore } from "@/state/drawingToolStore";
import type { DrawingDimensionData, DrawingOrdinateChainData } from "@/types/document";

import styles from "./DrawingSheet.module.css";

/** Matches `DrawingSheet.tsx`'s own constant — see its doc comment for why every drag
 * handler on this sheet divides by it rather than sharing one export. */
const SHEET_SCALE = 2.5;

const ARROW_LENGTH = 2;
const ARROW_WIDTH = 0.7;

type ToleranceMode = NonNullable<DrawingDimensionData["toleranceMode"]>;

/** A small "V" arrowhead at `(tipX, tipY)`, pointing back along the unit vector
 * `(dirX, dirY)` — the same shape `SketchDimensions.tsx`'s own `arrowheadPoints` draws for
 * the 3D viewport's sketch dimensions, reimplemented here in plain SVG-point-string form
 * since this sheet renders with raw `<polygon>`s, not three.js `<Line>`s. */
function arrowheadPoints(tipX: number, tipY: number, dirX: number, dirY: number): string {
  const backX = tipX + dirX * ARROW_LENGTH;
  const backY = tipY + dirY * ARROW_LENGTH;
  const perpX = -dirY * ARROW_WIDTH;
  const perpY = dirX * ARROW_WIDTH;
  return `${tipX},${tipY} ${backX + perpX},${backY + perpY} ${backX - perpX},${backY - perpY}`;
}

/** The label background rect's own size per tolerance mode — deviation/limits both need a
 * taller box for their own stacked second line, and deviation needs the extra width its
 * nominal-plus-stacked-pair layout takes up. */
const LABEL_BOX: Record<ToleranceMode, { width: number; height: number }> = {
  none: { width: 18, height: 6.4 },
  basic: { width: 18, height: 6.4 },
  symmetric: { width: 24, height: 6.4 },
  fit: { width: 22, height: 6.4 },
  deviation: { width: 28, height: 9 },
  limits: { width: 18, height: 9 },
};

function signed(value: number): string {
  return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

/** The label's own content for every tolerance mode — a plain nominal for "none", a boxed
 * nominal for "basic" (ASME Y14.5's "theoretically exact" convention: the frame itself
 * carries no tolerance, so nothing else is drawn), a single ± value for "symmetric", a
 * stacked +upper/-lower pair to the right of the nominal for "deviation", the two absolute
 * limit values stacked in place of the nominal for "limits", and the nominal plus an ISO
 * 286 class designation for "fit". */
function DimensionLabelContent({ dimension }: { dimension: DrawingDimensionData }) {
  const mode: ToleranceMode = dimension.toleranceMode ?? "none";
  const nominal = dimension.value.toFixed(2);
  const upper = dimension.toleranceUpper ?? 0;
  const lower = dimension.toleranceLower ?? 0;

  if (mode === "limits") {
    return (
      <>
        <text y={-1.6} textAnchor="middle" className={styles.dimensionLabel}>
          {(dimension.value + upper).toFixed(2)}
        </text>
        <text y={2.4} textAnchor="middle" className={styles.dimensionLabel}>
          {(dimension.value + lower).toFixed(2)}
        </text>
      </>
    );
  }

  if (mode === "deviation") {
    return (
      <>
        <text x={-3} textAnchor="end" dominantBaseline="middle" className={styles.dimensionLabel}>
          {nominal}
        </text>
        <text x={-1} y={-1.4} textAnchor="start" className={styles.dimensionLabelSmall}>
          {signed(upper)}
        </text>
        <text x={-1} y={2.4} textAnchor="start" className={styles.dimensionLabelSmall}>
          {signed(lower)}
        </text>
      </>
    );
  }

  if (mode === "symmetric") {
    return (
      <text textAnchor="middle" dominantBaseline="middle" className={styles.dimensionLabel}>
        {nominal} ±{Math.abs(upper).toFixed(2)}
      </text>
    );
  }

  if (mode === "fit") {
    return (
      <text textAnchor="middle" dominantBaseline="middle" className={styles.dimensionLabel}>
        {nominal} {dimension.fitClass}
      </text>
    );
  }

  if (mode === "basic") {
    return (
      <>
        <rect
          x={-(nominal.length * 1.5 + 2)}
          y={-3}
          width={nominal.length * 3 + 4}
          height={6}
          className={styles.dimensionBasicBox}
        />
        <text textAnchor="middle" dominantBaseline="middle" className={styles.dimensionLabel}>
          {nominal}
        </text>
      </>
    );
  }

  return (
    <text textAnchor="middle" dominantBaseline="middle" className={styles.dimensionLabel}>
      {nominal}
    </text>
  );
}

/**
 * One drawing-level linear dimension (`annotation.smart-dimension`'s own data) — extension
 * lines from the two measured points out to a draggable dimension line, with the real-world
 * value labelled at its midpoint.
 *
 * Unlike a sketch dimension, this never drives geometry: it is read-only annotation over an
 * already-projected view (see `DrawingDimensionData`'s own doc comment). Double-click opens
 * a tolerance form (none/symmetric/deviation/limits/basic/fit, matching the tolerance-type
 * dropdown every mainstream CAD package's own dimension property panel offers).
 */
export function DimensionView({
  dimension,
  selected,
  onSelect,
  onMove,
  onEdit,
}: {
  dimension: DrawingDimensionData;
  selected: boolean;
  onSelect: () => void;
  onMove: (offsetX: number, offsetY: number) => void;
  onEdit: (patch: Partial<DrawingDimensionData>) => void;
}) {
  const zoom = useDrawingToolStore((state) => state.zoom);
  const dragOrigin = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [editing, setEditing] = useState(false);

  const q1 = { x: dimension.x1 + dimension.offsetX, y: dimension.y1 + dimension.offsetY };
  const q2 = { x: dimension.x2 + dimension.offsetX, y: dimension.y2 + dimension.offsetY };
  const length = Math.max(Math.hypot(q2.x - q1.x, q2.y - q1.y), 1e-6);
  const dirX = (q2.x - q1.x) / length;
  const dirY = (q2.y - q1.y) / length;
  const midX = (q1.x + q2.x) / 2;
  const midY = (q1.y + q2.y) / 2;
  const box = LABEL_BOX[dimension.toleranceMode ?? "none"];

  return (
    <g data-drawing-dimension={dimension.id} className={selected ? styles.dimensionSelected : styles.dimension}>
      <line x1={dimension.x1} y1={dimension.y1} x2={q1.x} y2={q1.y} className={styles.extensionLine} />
      <line x1={dimension.x2} y1={dimension.y2} x2={q2.x} y2={q2.y} className={styles.extensionLine} />
      <line x1={q1.x} y1={q1.y} x2={q2.x} y2={q2.y} className={styles.dimensionLine} />
      <polygon points={arrowheadPoints(q1.x, q1.y, dirX, dirY)} className={styles.dimensionArrow} />
      <polygon points={arrowheadPoints(q2.x, q2.y, -dirX, -dirY)} className={styles.dimensionArrow} />
      <g
        transform={`translate(${midX} ${midY})`}
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
          dragOrigin.current = { x: event.clientX, y: event.clientY, ox: dimension.offsetX, oy: dimension.offsetY };
        }}
        onPointerMove={(event) => {
          if (!dragOrigin.current) return;
          const dx = (event.clientX - dragOrigin.current.x) / (SHEET_SCALE * zoom);
          const dy = (event.clientY - dragOrigin.current.y) / (SHEET_SCALE * zoom);
          onMove(dragOrigin.current.ox + dx, dragOrigin.current.oy + dy);
        }}
        onPointerUp={() => {
          dragOrigin.current = null;
        }}
      >
        {dimension.toleranceMode !== "basic" && (
          <rect x={-box.width / 2} y={-box.height / 2} width={box.width} height={box.height} className={styles.dimensionLabelBg} />
        )}
        <DimensionLabelContent dimension={dimension} />
        {editing && (
          <foreignObject x={-55} y={6} width={110} height={92}>
            <DimensionToleranceForm
              dimension={dimension}
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

const TOLERANCE_MODE_LABELS: Record<ToleranceMode, string> = {
  none: "none",
  symmetric: "symmetric (±)",
  deviation: "deviation (+/-)",
  limits: "limits (stacked)",
  basic: "basic (boxed)",
  fit: "fit (ISO 286)",
};

function DimensionToleranceForm({
  dimension,
  onDone,
}: {
  dimension: DrawingDimensionData;
  onDone: (patch: Partial<DrawingDimensionData>) => void;
}) {
  const [mode, setMode] = useState<ToleranceMode>(dimension.toleranceMode ?? "none");
  const [upper, setUpper] = useState(String(dimension.toleranceUpper ?? 0.1));
  const [lower, setLower] = useState(String(dimension.toleranceLower ?? -0.1));
  const [fitClass, setFitClass] = useState(dimension.fitClass ?? "H7");

  const commit = () =>
    onDone({
      toleranceMode: mode,
      toleranceUpper: Number(upper) || 0,
      toleranceLower: Number(lower) || 0,
      fitClass,
    });

  return (
    <div className={styles.gdtForm} onClick={(event) => event.stopPropagation()}>
      <select value={mode} onChange={(event) => setMode(event.target.value as ToleranceMode)} className={styles.gdtFormInput}>
        {(Object.keys(TOLERANCE_MODE_LABELS) as ToleranceMode[]).map((key) => (
          <option key={key} value={key}>
            {TOLERANCE_MODE_LABELS[key]}
          </option>
        ))}
      </select>
      {(mode === "symmetric" || mode === "deviation" || mode === "limits") && (
        <div className={styles.gdtFormRow}>
          <input
            value={upper}
            placeholder={mode === "symmetric" ? "±" : "+upper"}
            onChange={(event) => setUpper(event.target.value)}
            className={styles.gdtFormInput}
          />
          {mode !== "symmetric" && (
            <input
              value={lower}
              placeholder="-lower"
              onChange={(event) => setLower(event.target.value)}
              className={styles.gdtFormInput}
            />
          )}
        </div>
      )}
      {mode === "fit" && (
        <input
          value={fitClass}
          placeholder="H7"
          onChange={(event) => setFitClass(event.target.value)}
          className={styles.gdtFormInput}
        />
      )}
      <button type="button" className={styles.gdtFormDone} onClick={commit}>
        Done
      </button>
    </div>
  );
}

/**
 * One ordinate dimension chain (`annotation.ordinate`'s own data) — a single baseline from
 * the shared datum along the chain's own axis, with a tick + offset label per point, the
 * ISO 129-1 convention for "every value measured from the same zero" dimensioning.
 */
export function OrdinateChainView({
  chain,
  selected,
  onSelect,
}: {
  chain: DrawingOrdinateChainData;
  selected: boolean;
  onSelect: () => void;
}) {
  if (chain.points.length === 0) return null;

  // The baseline runs from the datum to the farthest point along the chain's own axis, in
  // whichever direction the points actually lie — an ordinate chain's baseline is only ever
  // extended as far as it needs to be, not drawn past the last real value.
  const farthest = chain.points.reduce((max, point) =>
    Math.abs((chain.axis === "x" ? point.x : point.y) - (chain.axis === "x" ? chain.datumX : chain.datumY)) >
    Math.abs((chain.axis === "x" ? max.x : max.y) - (chain.axis === "x" ? chain.datumX : chain.datumY))
      ? point
      : max,
  );
  const baselineEnd =
    chain.axis === "x" ? { x: farthest.x, y: chain.datumY } : { x: chain.datumX, y: farthest.y };

  return (
    <g
      className={selected ? styles.dimensionSelected : styles.dimension}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <line
        x1={chain.datumX}
        y1={chain.datumY}
        x2={baselineEnd.x}
        y2={baselineEnd.y}
        className={styles.dimensionLine}
      />
      <circle cx={chain.datumX} cy={chain.datumY} r={1.2} className={styles.ordinateDatumDot} />
      {chain.points.map((point) => {
        const footX = chain.axis === "x" ? point.x : chain.datumX;
        const footY = chain.axis === "x" ? chain.datumY : point.y;
        const labelX = chain.axis === "x" ? point.x : chain.datumX - 10;
        const labelY = chain.axis === "x" ? chain.datumY - 10 : point.y;
        return (
          <g key={point.id}>
            <line x1={point.x} y1={point.y} x2={footX} y2={footY} className={styles.extensionLine} />
            <text x={labelX} y={labelY} textAnchor="middle" className={styles.dimensionLabel}>
              {point.value.toFixed(2)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
