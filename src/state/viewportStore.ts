import { create } from "zustand";

/**
 * Shaded is the solid's material only; Shaded + Edges (the default) adds the B-Rep edge
 * overlay on top; Wireframe drops the shaded material and shows only those edges — a
 * CAD "wireframe" means the model's real edges, not the raw triangulation, which is
 * exactly what `SolidModel.tsx` already draws as a separate edge overlay.
 */
export type DisplayMode = "shaded" | "shaded-edges" | "wireframe";

const DISPLAY_MODE_CYCLE: readonly DisplayMode[] = ["shaded", "shaded-edges", "wireframe"];

interface ViewportStore {
  displayMode: DisplayMode;
  /** Reference planes and the origin triad; there is no per-body visibility yet since a
   * document only ever has the one modelled body. */
  referenceGeometryVisible: boolean;
  /** Incremented, never read for its own value — components that can fit the camera
   * watch this to know a fresh request came in, since two identical requests in a row
   * (re-fitting the same model) still need to trigger the effect both times. */
  zoomFitRequest: number;

  cycleDisplayMode: () => void;
  toggleReferenceGeometry: () => void;
  requestZoomFit: () => void;
}

export const useViewportStore = create<ViewportStore>((set) => ({
  displayMode: "shaded-edges",
  referenceGeometryVisible: true,
  zoomFitRequest: 0,

  cycleDisplayMode: () =>
    set((state) => {
      const index = DISPLAY_MODE_CYCLE.indexOf(state.displayMode);
      return { displayMode: DISPLAY_MODE_CYCLE[(index + 1) % DISPLAY_MODE_CYCLE.length] };
    }),

  toggleReferenceGeometry: () =>
    set((state) => ({ referenceGeometryVisible: !state.referenceGeometryVisible })),

  requestZoomFit: () => set((state) => ({ zoomFitRequest: state.zoomFitRequest + 1 })),
}));
