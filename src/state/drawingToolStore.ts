import { create } from "zustand";

/**
 * Which interactive tool the Drawing sheet is in — the same "arm a tool, then pick/drag on
 * the canvas" shape `sketchStore.ts`'s `tool`/`pendingConstraintKind` already uses for the
 * 3D/sketch side of the app, scoped instead to `DrawingSheet.tsx`.
 *
 * "select" (the default) is plain click-to-select/drag-to-move on views, notes and title
 * block fields. "note" places a new text note on the next sheet click. "section" and
 * "detail" each need a source view picked first, then a cut line / crop circle dragged
 * into place before confirming — see their own state below.
 */
export type DrawingTool = "select" | "note" | "section" | "detail";

interface DrawingToolStore {
  tool: DrawingTool;
  setTool: (tool: DrawingTool) => void;

  /** Section tool: which existing Front/Top/Right view the cut is taken from, `null` until
   * picked. Reset (along with the rest below) whenever the tool changes or the cut is
   * confirmed/cancelled. */
  sectionSourceViewId: string | null;
  sectionOrientation: "horizontal" | "vertical";
  /** Cut line position, in the source view's own rendered (Y-down, unscaled) local space —
   * converted to a world-space axis/offset only once, at confirm time
   * (`sectionAxisAndOffset` in `kernel/drawingProjection.ts`). */
  sectionLocalPosition: number;
  sectionFlipped: boolean;
  pickSectionSource: (viewId: string, initialPosition: number) => void;
  setSectionOrientation: (orientation: "horizontal" | "vertical") => void;
  setSectionLocalPosition: (value: number) => void;
  toggleSectionFlip: () => void;

  /** Detail tool: source view + the crop circle, in that view's own local space. */
  detailSourceViewId: string | null;
  detailCentreX: number;
  detailCentreY: number;
  detailRadius: number;
  pickDetailSource: (viewId: string, cx: number, cy: number) => void;
  setDetailCircle: (cx: number, cy: number, radius: number) => void;

  /** Common exit for both tools — a confirm, a cancel, or switching away all go through
   * this, so nothing but `setTool`/`pickXSource` ever needs to remember every field above. */
  resetPicking: () => void;
}

export const useDrawingToolStore = create<DrawingToolStore>((set) => ({
  tool: "select",
  setTool: (tool) => set({ tool, sectionSourceViewId: null, detailSourceViewId: null }),

  sectionSourceViewId: null,
  sectionOrientation: "vertical",
  sectionLocalPosition: 0,
  sectionFlipped: false,
  pickSectionSource: (viewId, initialPosition) =>
    set({ sectionSourceViewId: viewId, sectionLocalPosition: initialPosition, sectionFlipped: false }),
  setSectionOrientation: (orientation) => set({ sectionOrientation: orientation }),
  setSectionLocalPosition: (value) => set({ sectionLocalPosition: value }),
  toggleSectionFlip: () => set((state) => ({ sectionFlipped: !state.sectionFlipped })),

  detailSourceViewId: null,
  detailCentreX: 0,
  detailCentreY: 0,
  detailRadius: 20,
  pickDetailSource: (viewId, cx, cy) => set({ detailSourceViewId: viewId, detailCentreX: cx, detailCentreY: cy }),
  setDetailCircle: (cx, cy, radius) => set({ detailCentreX: cx, detailCentreY: cy, detailRadius: radius }),

  resetPicking: () =>
    set({
      tool: "select",
      sectionSourceViewId: null,
      detailSourceViewId: null,
    }),
}));
