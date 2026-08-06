import { create } from "zustand";

import type { ProjectedViews } from "@/kernel/drawingProjection";

/**
 * Which interactive tool the Drawing sheet is in — the same "arm a tool, then pick/drag on
 * the canvas" shape `sketchStore.ts`'s `tool`/`pendingConstraintKind` already uses for the
 * 3D/sketch side of the app, scoped instead to `DrawingSheet.tsx`.
 *
 * "select" (the default) is plain click-to-select/drag-to-move on views, notes and title
 * block fields. "note", "datum", "gdt", "surface-finish" and "weld" each place one
 * annotation on the next sheet click and self-disarm back to "select" (see
 * `DrawingSheet.tsx`'s `handleBackgroundClick`). "section" and "detail" each need a source
 * view picked first, then a cut line / crop circle dragged into place before confirming.
 * "smart-dimension" needs two picked points (see `dimensionFirstPoint` below); "ordinate"
 * needs a datum pick followed by any number of further point picks added to the same chain.
 */
export type DrawingTool =
  | "select"
  | "note"
  | "section"
  | "detail"
  | "projected"
  | "smart-dimension"
  | "ordinate"
  | "datum"
  | "gdt"
  | "surface-finish"
  | "weld";

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

  /** Projected View tool: which existing standard view the directional-arrow overlay
   * (`ProjectedViewOverlay.tsx`) is currently showing arrows around, `null` until picked.
   * `drawingViewLayout.ts`'s `projectableDirections` is what turns this into the actual set
   * of arrows offered. */
  projectedSourceViewId: string | null;
  pickProjectedSource: (viewId: string) => void;

  /** Detail tool: source view + the crop circle, in that view's own local space. */
  detailSourceViewId: string | null;
  detailCentreX: number;
  detailCentreY: number;
  detailRadius: number;
  pickDetailSource: (viewId: string, cx: number, cy: number) => void;
  setDetailCircle: (cx: number, cy: number, radius: number) => void;

  /** Smart Dimension: the first of the two points a linear dimension needs, sheet-mm plus
   * which view it was snapped from (a dimension's real-world value only makes sense read
   * against one view's own scale — see `kernel/drawingGeometry.ts`'s `viewScaleFor`). `null`
   * before the first pick, and reset to `null` again once the second pick commits the
   * dimension (so the tool stays armed for the next one, matching a sketch's own Smart
   * Dimension not disarming after a single use). */
  dimensionFirstPoint: { viewId: string; x: number; y: number } | null;
  pickDimensionFirstPoint: (viewId: string, x: number, y: number) => void;

  /** Ordinate: the shared datum every point in the current chain measures from, plus which
   * chain (once started) further picks append to and along which axis. `null` fields mean
   * "chain not started yet" — the very next pick becomes the datum. */
  ordinateDatum: { x: number; y: number } | null;
  ordinateChainId: string | null;
  ordinateAxis: "x" | "y" | null;
  pickOrdinateDatum: (x: number, y: number) => void;
  startOrdinateChain: (chainId: string, axis: "x" | "y") => void;

  /** Common exit for every armed tool — a confirm, a cancel, Escape, or switching away all
   * go through this, so nothing but `setTool`/`pickXSource` ever needs to remember every
   * field above. */
  resetPicking: () => void;

  /**
   * Insert Model View's own orientation choice, open between picking a Part file and
   * placing the one view the user actually wants — `runInsertModelView` projects every
   * standard direction up front (the same all-seven-directions computation
   * `rebuildAndProjectPart` was already doing per file), stashes them here, and
   * `ModelViewOrientationDialog.tsx` shows all seven as pickable cards. `runPlaceModelView`
   * reads the direction the user clicked out of `views` and clears this back to `null`.
   * `null` means the dialog isn't showing. */
  modelViewPicker: { fileName: string; path: string | null; views: ProjectedViews } | null;
  openModelViewPicker: (fileName: string, path: string | null, views: ProjectedViews) => void;
  closeModelViewPicker: () => void;

  /** Sheet-level zoom/pan, applied as a CSS transform on the rendered `<svg>` in
   * `DrawingSheet.tsx` (`translate(panX, panY) scale(zoom)`, in on-screen CSS px) rather
   * than touching the SVG's own `viewBox`/mm coordinates, so every existing drag handler
   * that converts a pointer-pixel delta back to sheet-mm only needs one extra `/ zoom`
   * term, not a coordinate-space rewrite. Lives here rather than component state so
   * `SectionOverlay`/`DetailOverlay` (separate files, same sheet) read the same value the
   * main sheet's own drag math uses. */
  zoom: number;
  panX: number;
  panY: number;
  setZoom: (zoom: number) => void;
  /** Zooms by `factor` while keeping the sheet-space point currently under
   * (`clientX`, `clientY`) — measured relative to the transformed container's own
   * top-left — visually fixed, the same "zoom to cursor" the 3D viewport already does. */
  zoomAt: (factor: number, clientX: number, clientY: number, containerLeft: number, containerTop: number) => void;
  setPan: (x: number, y: number) => void;
  resetZoomPan: () => void;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;

export const useDrawingToolStore = create<DrawingToolStore>((set) => ({
  tool: "select",
  setTool: (tool) =>
    set({
      tool,
      sectionSourceViewId: null,
      detailSourceViewId: null,
      projectedSourceViewId: null,
      dimensionFirstPoint: null,
      ordinateDatum: null,
      ordinateChainId: null,
      ordinateAxis: null,
    }),

  sectionSourceViewId: null,
  sectionOrientation: "vertical",
  sectionLocalPosition: 0,
  sectionFlipped: false,
  pickSectionSource: (viewId, initialPosition) =>
    set({ sectionSourceViewId: viewId, sectionLocalPosition: initialPosition, sectionFlipped: false }),
  setSectionOrientation: (orientation) => set({ sectionOrientation: orientation }),
  setSectionLocalPosition: (value) => set({ sectionLocalPosition: value }),
  toggleSectionFlip: () => set((state) => ({ sectionFlipped: !state.sectionFlipped })),

  projectedSourceViewId: null,
  pickProjectedSource: (viewId) => set({ projectedSourceViewId: viewId }),

  detailSourceViewId: null,
  detailCentreX: 0,
  detailCentreY: 0,
  detailRadius: 20,
  pickDetailSource: (viewId, cx, cy) => set({ detailSourceViewId: viewId, detailCentreX: cx, detailCentreY: cy }),
  setDetailCircle: (cx, cy, radius) => set({ detailCentreX: cx, detailCentreY: cy, detailRadius: radius }),

  dimensionFirstPoint: null,
  pickDimensionFirstPoint: (viewId, x, y) => set({ dimensionFirstPoint: { viewId, x, y } }),

  ordinateDatum: null,
  ordinateChainId: null,
  ordinateAxis: null,
  pickOrdinateDatum: (x, y) => set({ ordinateDatum: { x, y }, ordinateChainId: null, ordinateAxis: null }),
  startOrdinateChain: (chainId, axis) => set({ ordinateChainId: chainId, ordinateAxis: axis }),

  resetPicking: () =>
    set({
      tool: "select",
      sectionSourceViewId: null,
      detailSourceViewId: null,
      projectedSourceViewId: null,
      dimensionFirstPoint: null,
      ordinateDatum: null,
      ordinateChainId: null,
      ordinateAxis: null,
    }),

  modelViewPicker: null,
  openModelViewPicker: (fileName, path, views) => set({ modelViewPicker: { fileName, path, views } }),
  closeModelViewPicker: () => set({ modelViewPicker: null }),

  zoom: 1,
  panX: 0,
  panY: 0,
  setZoom: (zoom) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }),
  zoomAt: (factor, clientX, clientY, containerLeft, containerTop) =>
    set((state) => {
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom * factor));
      const pointerX = clientX - containerLeft;
      const pointerY = clientY - containerTop;
      const sheetX = (pointerX - state.panX) / state.zoom;
      const sheetY = (pointerY - state.panY) / state.zoom;
      return {
        zoom: nextZoom,
        panX: pointerX - sheetX * nextZoom,
        panY: pointerY - sheetY * nextZoom,
      };
    }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  resetZoomPan: () => set({ zoom: 1, panX: 0, panY: 0 }),
}));
