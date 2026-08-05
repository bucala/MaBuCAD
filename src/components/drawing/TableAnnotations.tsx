import { useRef } from "react";

import { useDrawingToolStore } from "@/state/drawingToolStore";
import type { DrawingTableData } from "@/types/document";

import styles from "./DrawingSheet.module.css";

/** Matches `DrawingSheet.tsx`'s own constant — see its doc comment for why every drag
 * handler on this sheet divides by it rather than sharing one export. */
const SHEET_SCALE = 2.5;

const ROW_HEIGHT = 6;
const CHAR_WIDTH = 1.8;
const CELL_PADDING = 3;

/** A table inserted onto the sheet (`table.bom`/`table.hole`) — a plain grid with the first
 * row rendered as a header, column widths sized to whichever cell in that column is widest.
 * Drag the title bar to reposition; the cells themselves are a static snapshot (see
 * `DrawingTableData`'s own doc comment), not editable in place. */
export function TableView({
  table,
  selected,
  onSelect,
  onMove,
}: {
  table: DrawingTableData;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const zoom = useDrawingToolStore((state) => state.zoom);
  const dragOrigin = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);

  const columnCount = table.rows[0]?.length ?? 0;
  const columnWidths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(...table.rows.map((row) => (row[column]?.length ?? 0) * CHAR_WIDTH + CELL_PADDING * 2), 16),
  );
  const columnOffsets = columnWidths.reduce<number[]>((offsets, _width, index) => {
    offsets.push((offsets[index - 1] ?? 0) + (index === 0 ? 0 : columnWidths[index - 1]));
    return offsets;
  }, []);
  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const totalHeight = ROW_HEIGHT * table.rows.length + ROW_HEIGHT;

  const titleBar = {
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      onSelect();
    },
    onPointerDown: (event: React.PointerEvent) => {
      event.stopPropagation();
      onSelect();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragOrigin.current = { pointerX: event.clientX, pointerY: event.clientY, x: table.x, y: table.y };
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

  return (
    <g transform={`translate(${table.x} ${table.y})`}>
      <rect x={0} y={0} width={totalWidth} height={ROW_HEIGHT} className={styles.tableTitleBar} {...titleBar} />
      <text x={totalWidth / 2} y={ROW_HEIGHT / 2} textAnchor="middle" dominantBaseline="middle" className={styles.tableTitle}>
        {table.title}
      </text>
      <rect
        x={0}
        y={ROW_HEIGHT}
        width={totalWidth}
        height={totalHeight - ROW_HEIGHT}
        className={selected ? styles.tableBorderSelected : styles.tableBorder}
      />
      {table.rows.map((row, rowIndex) => (
        <g key={rowIndex} transform={`translate(0 ${ROW_HEIGHT + rowIndex * ROW_HEIGHT})`}>
          {row.map((cell, columnIndex) => (
            <g key={columnIndex}>
              {columnIndex > 0 && (
                <line
                  x1={columnOffsets[columnIndex]}
                  y1={0}
                  x2={columnOffsets[columnIndex]}
                  y2={ROW_HEIGHT}
                  className={styles.tableGridLine}
                />
              )}
              <text
                x={columnOffsets[columnIndex] + CELL_PADDING}
                y={ROW_HEIGHT / 2}
                dominantBaseline="middle"
                className={rowIndex === 0 ? styles.tableHeaderText : styles.tableCellText}
              >
                {cell}
              </text>
            </g>
          ))}
          {rowIndex > 0 && <line x1={0} y1={0} x2={totalWidth} y2={0} className={styles.tableGridLine} />}
        </g>
      ))}
    </g>
  );
}
