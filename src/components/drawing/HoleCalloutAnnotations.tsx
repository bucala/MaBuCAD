import { useRef } from "react";

import { formatHoleCallout } from "@/commands/holeCallout";
import type { Language } from "@/i18n/languages";
import { useDrawingToolStore } from "@/state/drawingToolStore";
import type { DrawingHoleCalloutData } from "@/types/document";

import styles from "./DrawingSheet.module.css";

const SHEET_SCALE = 2.5;
const LINE_HEIGHT = 4.2;

export function HoleCalloutView({
  callout,
  language,
  selected,
  onSelect,
  onMove,
}: {
  callout: DrawingHoleCalloutData;
  language: Language;
  selected: boolean;
  onSelect: () => void;
  onMove: (labelX: number, labelY: number) => void;
}) {
  const zoom = useDrawingToolStore((state) => state.zoom);
  const dragOrigin = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const lines = formatHoleCallout(callout.metadata, language);
  // The sheet has no text-measurement API, so the background width is estimated: average
  // character width × count, with the callout's dense technical glyphs (⌀ ↧ ⌴ ⌵, the
  // U+2000–U+23FF symbol range) counted double since each renders wider than the average
  // letter a plain character count assumes.
  const estimateWidth = (line: string): number =>
    [...line].reduce(
      (width, char) => width + (char.charCodeAt(0) >= 0x2000 && char.charCodeAt(0) <= 0x23ff ? 2 : 1),
      0,
    );
  const width = Math.max(...lines.map(estimateWidth)) * 1.9 + 4;
  const height = lines.length * LINE_HEIGHT + 2;
  const dx = callout.labelX - callout.anchorX;
  const dy = callout.labelY - callout.anchorY;
  const length = Math.max(Math.hypot(dx, dy), 0.001);
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const arrow = [
    `${callout.anchorX},${callout.anchorY}`,
    `${callout.anchorX + ux * 3 + px * 1.2},${callout.anchorY + uy * 3 + py * 1.2}`,
    `${callout.anchorX + ux * 3 - px * 1.2},${callout.anchorY + uy * 3 - py * 1.2}`,
  ].join(" ");

  return (
    <g className={selected ? styles.dimensionSelected : styles.dimension}>
      <line
        x1={callout.anchorX}
        y1={callout.anchorY}
        x2={callout.labelX}
        y2={callout.labelY}
        className={styles.leaderLine}
      />
      <polygon points={arrow} className={styles.holeCalloutArrow} />
      <g
        transform={`translate(${callout.labelX} ${callout.labelY})`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragOrigin.current = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            x: callout.labelX,
            y: callout.labelY,
          };
        }}
        onPointerMove={(event) => {
          if (!dragOrigin.current) return;
          const nextX = dragOrigin.current.x + (event.clientX - dragOrigin.current.pointerX) / (SHEET_SCALE * zoom);
          const nextY = dragOrigin.current.y + (event.clientY - dragOrigin.current.pointerY) / (SHEET_SCALE * zoom);
          onMove(nextX, nextY);
        }}
        onPointerUp={() => {
          dragOrigin.current = null;
        }}
      >
        <rect
          x={-1}
          y={-height / 2}
          width={width}
          height={height}
          className={styles.holeCalloutBg}
        />
        <text x={1} y={-(lines.length - 1) * LINE_HEIGHT / 2} className={styles.holeCalloutText}>
          {lines.map((line, index) => (
            <tspan key={index} x={1} dy={index === 0 ? 0 : LINE_HEIGHT}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    </g>
  );
}
