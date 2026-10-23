import { create } from "zustand";

import type { ProjectedViews } from "@/kernel/drawingProjection";
import type { DrawingSourceStamp, ScreenAxis } from "@/types/document";

/** Insert Model View: every direction is already projected (cheap — `rebuildAndProjectPart`
 * always computes all seven), waiting for the user to pick which one becomes the drawing's
 * own "front" — `ModelViewOrientationDialog.tsx` renders this, `runPlaceModelView` consumes
 * it. `null` while no picker is open. */
export interface ModelViewPickerState {
  fileName: string;
  path: string | null;
  sourceStamp: DrawingSourceStamp | undefined;
  sourceContentHash: string;
  views: ProjectedViews;
}

/**
 * Which interactive tool the Drawing sheet is in — the same "arm a tool, then pick/drag on
 * the canvas" shape `sketchStore.ts`'s `tool`/`pendingConstraintKind` already uses for the
 * 3D/sketch side of the app, scoped instead to `DrawingSheet.tsx`.
 *
 * "select" (the default) is plain click-to-select/drag-to-move on views, notes and title
 * block fields. "note", "hole-callout", "datum", "gdt", "surface-finish" and "weld" each place one
 * annotation on the next sheet click and self-disarm back to "select" (see
 * `DrawingSheet.tsx`'s `handleBackgroundClick`). "section", "detail", "auxiliary", "crop",
 * and "broken" each need a source view picked first, then their own overlay is configured
 * before confirming.
 * "smart-dimension" needs two picked points (see `dimensionFirstPoint` below); "ordinate"
 * needs a datum pick followed by any number of further point picks added to the same chain.
 */
export type DrawingTool =
  | "select"
  | "note"
  | "hole-callout"
  | "section"
  | "detail"
  | "projected"
  | "auxiliary"
  | "crop"
  | "broken"
  | "smart-dimension"
  | "ordinate"
  | "datum"
  | "gdt"
  | "surface-finish"
  | "weld";

interface DrawingToolStore {
  tool: DrawingTool;
  setTool: (tool: DrawingTool) => void;

  /** Insert Model View's orientation picker — see `ModelViewPickerState`'s own comment.
   * Not reset by `setTool`/`resetPicking`: it's a modal dialog opened directly by the
   * command, not a tool's own armed-picking state, and closes itself on pick or Cancel. */
  modelViewPicker: ModelViewPickerState | null;
  openModelViewPicker: (picker: ModelViewPickerState) => void;
  closeModelViewPicker: () => void;

  /** Projected View: the standard view just clicked while the tool is armed, waiting for a
   * direction pick from `ProjectedViewOverlay`'s cardinal arrows or its Iso corner button —
   * replaces auto-picking "the next missing view" with a real directional choice. `null`
   * until a standard view is clicked. */
  projectedSourceViewId: string | null;
  pickProjectedSource: (viewId: string) => void;

  /** Section tool: which existing Front/Top/Right view the cut is taken from, `null` until
   * picked. Reset (along with the rest below) whenever the tool changes or the cut is
   * confirmed/cancelled. */
  sectionSourceViewId: string | null;
  sectionOrientation: ScreenAxis;
  /** Cut line position, in the source view's own rendered (Y-down, unscaled) local space —
   * converted to a world-space axis/offset only once, at confirm time
   * (`sectionAxisAndOffset` in `kernel/drawingProjection.ts`). */
  sectionLocalPosition: number;
  sectionFlipped: boolean;
  pickSectionSource: (viewId: string, initialPosition: number) => void;
  setSectionOrientation: (orientation: ScreenAxis) => void;
  setSectionLocalPosition: (value: number) => void;
  toggleSectionFlip: () => void;

  /** Detail tool: source view + the crop circle, in that view's own local space. */
  detailSourceViewId: string | null;
  detailCentreX: number;
  detailCentreY: number;
  detailRadius: number;
  pickDetailSource: (viewId: string, cx: number, cy: number) => void;
  setDetailCircle: (cx: number, cy: number, radius: number) => void;

  /** Auxiliary view: a standard orthographic source plus a controlled screen-axis tilt. */
  auxiliarySourceViewId: string | null;
  auxiliaryTiltAxis: ScreenAxis;
  auxiliaryAngle: number;
  pickAuxiliarySource: (viewId: string) => void;
  setAuxiliaryTilt: (axis: ScreenAxis, angle: number) => void;

  /** Crop view: a rectangular window in a source view's own local space. */
  cropSourceViewId: string | null;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  pickCropSource: (viewId: string, cx: number, cy: number) => void;
  setCropRect: (x: number, y: number, width: number, height: number) => void;

  /** Broken view: a masked band across a source view. */
  brokenSourceViewId: string | null;
  brokenOrientation: ScreenAxis;
  brokenStart: number;
  brokenEnd: number;
  pickBrokenSource: (viewId: string) => void;
  setBrokenBand: (start: number, end: number) => void;
  setBrokenOrientation: (orientation: ScreenAxis) => void;

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
  ordinateDatum: { viewId: string; x: number; y: number } | null;
  ordinateChainId: string | null;
  ordinateAxis: "x" | "y" | null;
  pickOrdinateDatum: (viewId: string, x: number, y: number) => void;
  startOrdinateChain: (chainId: string, axis: "x" | "y") => void;

  /** Common exit for every armed tool — a confirm, a cancel, Escape, or switching away all
   * go through this, so nothing but `setTool`/`pickXSource` ever needs to remember every
   * field above. */
  resetPicking: () => void;

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

/** Every per-tool picking field back to its empty value — shared by `setTool` and
 * `resetPicking` so a new tool's state only has to be listed here once. */
const PICKING_RESET = {
  sectionSourceViewId: null,
  detailSourceViewId: null,
  auxiliarySourceViewId: null,
  cropSourceViewId: null,
  brokenSourceViewId: null,
  projectedSourceViewId: null,
  dimensionFirstPoint: null,
  ordinateDatum: null,
  ordinateChainId: null,
  ordinateAxis: null,
} as const;

export const useDrawingToolStore = create<DrawingToolStore>((set) => ({
  tool: "select",
  setTool: (tool) => set({ tool, ...PICKING_RESET }),

  modelViewPicker: null,
  openModelViewPicker: (picker) => set({ modelViewPicker: picker }),
  closeModelViewPicker: () => set({ modelViewPicker: null }),

  projectedSourceViewId: null,
  pickProjectedSource: (viewId) => set({ projectedSourceViewId: viewId }),

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

  auxiliarySourceViewId: null,
  auxiliaryTiltAxis: "horizontal",
  auxiliaryAngle: 30,
  pickAuxiliarySource: (viewId) =>
    set({ auxiliarySourceViewId: viewId, auxiliaryTiltAxis: "horizontal", auxiliaryAngle: 30 }),
  setAuxiliaryTilt: (axis, angle) =>
    set({ auxiliaryTiltAxis: axis, auxiliaryAngle: Math.max(-60, Math.min(60, angle)) }),

  cropSourceViewId: null,
  cropX: 0,
  cropY: 0,
  cropWidth: 40,
  cropHeight: 40,
  pickCropSource: (viewId, cx, cy) =>
    set({ cropSourceViewId: viewId, cropX: cx - 20, cropY: cy - 20, cropWidth: 40, cropHeight: 40 }),
  setCropRect: (x, y, width, height) =>
    set({ cropX: x, cropY: y, cropWidth: Math.max(4, width), cropHeight: Math.max(4, height) }),

  brokenSourceViewId: null,
  brokenOrientation: "vertical",
  brokenStart: 0,
  brokenEnd: 0,
  // The band resets with every new source: `BrokenOverlay`'s init effect only fills a
  // degenerate band, so keeping the previous view's band could start out of range here.
  pickBrokenSource: (viewId) =>
    set({ brokenSourceViewId: viewId, brokenOrientation: "vertical", brokenStart: 0, brokenEnd: 0 }),
  setBrokenBand: (start, end) => set({ brokenStart: Math.min(start, end), brokenEnd: Math.max(start, end) }),
  setBrokenOrientation: (orientation) => set({ brokenOrientation: orientation }),

  dimensionFirstPoint: null,
  pickDimensionFirstPoint: (viewId, x, y) => set({ dimensionFirstPoint: { viewId, x, y } }),

  ordinateDatum: null,
  ordinateChainId: null,
  ordinateAxis: null,
  pickOrdinateDatum: (viewId, x, y) => set({ ordinateDatum: { viewId, x, y }, ordinateChainId: null, ordinateAxis: null }),
  startOrdinateChain: (chainId, axis) => set({ ordinateChainId: chainId, ordinateAxis: axis }),

  resetPicking: () => set({ tool: "select", ...PICKING_RESET }),

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
