import { useRef } from "react";

import { useDrawingToolStore } from "@/state/drawingToolStore";
import type { DrawingDimensionData, DrawingOrdinateChainData } from "@/types/document";

import styles from "./DrawingSheet.module.css";

/** Matches `DrawingSheet.tsx`'s own constant — see its doc comment for why every drag
 * handler on this sheet divides by it rather than sharing one export. */
const SHEET_SCALE = 2.5;

const ARROW_LENGTH = 2;
const ARROW_WIDTH = 0.7;

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

/**
 * One drawing-level linear dimension (`annotation.smart-dimension`'s own data) — extension
 * lines from the two measured points out to a draggable dimension line, with the real-world
 * value labelled at its midpoint.
 *
 * Unlike a sketch dimension, this never drives geometry: it is read-only annotation over an
 * already-projected view (see `DrawingDimensionData`'s own doc comment), so there is no
 * inline-edit-the-value affordance here — only drag-to-declutter and delete.
 */
export function DimensionView({
  dimension,
  selected,
  onSelect,
  onMove,
}: {
  dimension: DrawingDimensionData;
  selected: boolean;
  onSelect: () => void;
  onMove: (offsetX: number, offsetY: number) => void;
}) {
  const zoom = useDrawingToolStore((state) => state.zoom);
  const dragOrigin = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const q1 = { x: dimension.x1 + dimension.offsetX, y: dimension.y1 + dimension.offsetY };
  const q2 = { x: dimension.x2 + dimension.offsetX, y: dimension.y2 + dimension.offsetY };
  const length = Math.max(Math.hypot(q2.x - q1.x, q2.y - q1.y), 1e-6);
  const dirX = (q2.x - q1.x) / length;
  const dirY = (q2.y - q1.y) / length;
  const midX = (q1.x + q2.x) / 2;
  const midY = (q1.y + q2.y) / 2;

  return (
    <g className={selected ? styles.dimensionSelected : styles.dimension}>
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
        onPointerDown={(event) => {
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
        <rect x={-9} y={-3.2} width={18} height={6.4} className={styles.dimensionLabelBg} />
        <text textAnchor="middle" dominantBaseline="middle" className={styles.dimensionLabel}>
          {dimension.value.toFixed(2)}
        </text>
      </g>
    </g>
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
