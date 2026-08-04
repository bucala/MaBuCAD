/**
 * Drawing Resources: reusable Border and Title Block templates, and the Sheet Formats
 * that pair a paper size with one of each — the same three-way split Inventor's own
 * "Drawing Resources" tree uses (Sheet Formats / Borders / Title Blocks), rather than
 * baking a fixed A3 layout into every Drawing document the way the first pass did.
 *
 * These live in `templateStore.ts`, not on any one `CadDocument` — a border or title
 * block is drawn-office furniture, meant to be defined once and reused across every
 * drawing, the same way a real drafting department has one set of stamped borders rather
 * than redrawing one per job. A Drawing document only ever stores *which* template it
 * uses (`DrawingSheetData.sheetFormatId`) and the per-document values that go in the
 * title block's fields (`titleBlockValues`) — never a copy of the template itself.
 */

export type SheetSize = "A4" | "A3" | "A2" | "A1" | "A0";
export type SheetOrientation = "portrait" | "landscape";

/** ISO 216 paper dimensions, mm, portrait (width < height). */
export const ISO_PAPER_SIZE_MM: Record<SheetSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A2: { width: 420, height: 594 },
  A1: { width: 594, height: 841 },
  A0: { width: 841, height: 1189 },
};

export function paperDimensions(size: SheetSize, orientation: SheetOrientation): { width: number; height: number } {
  const { width, height } = ISO_PAPER_SIZE_MM[size];
  return orientation === "landscape" ? { width: height, height: width } : { width, height };
}

/**
 * A border template: the drawn frame and its zone reference grid — the numbered
 * columns / lettered rows and small filled corner/edge marks a real engineering drawing
 * uses so a callout can say "see zone C4" unambiguously. Purely parametric (no freeform
 * artwork) so one template works at any paper size rather than needing a redraw per size.
 */
export interface BorderTemplate {
  id: string;
  name: string;
  /** mm from the paper edge to the border's own drawn rectangle. */
  margin: number;
  /** Reference-grid divisions along the long (columns, numbered) and short (rows,
   * lettered) edges — Inventor's own default border already uses 8x6 for A3, hence the
   * same default here; a bigger sheet in the same template just spaces them further apart. */
  zoneColumns: number;
  zoneRows: number;
  /** Small filled squares at the edge midpoints, marking the sheet's own centrelines —
   * the ⬛ marks visible at the middle of each border edge in a standard ISO drawing frame. */
  centreMarks: boolean;
}

/** One labelled cell in a title block — position/size relative to the title block's own
 * top-left corner, which `DrawingSheet.tsx` anchors to the sheet's bottom-right (inside
 * the border margin), matching where a title block always sits on a real drawing. */
export interface TitleBlockField {
  id: string;
  /** Key `titleBlockValues` is keyed by — stable even if `label` is later edited/translated. */
  key: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  bold?: boolean;
}

export interface TitleBlockTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  fields: TitleBlockField[];
}

/** Pairs a paper size/orientation with one Border and one Title Block — what a Drawing
 * document actually picks (`DrawingSheetData.sheetFormatId`), matching Inventor's own
 * "Sheet Formats" folder (e.g. "A3 size, 2 views"). */
export interface SheetFormat {
  id: string;
  name: string;
  size: SheetSize;
  orientation: SheetOrientation;
  borderTemplateId: string;
  titleBlockTemplateId: string;
}
