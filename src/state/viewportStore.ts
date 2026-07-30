import { create } from "zustand";

import type { ProjectionMode } from "@/components/viewport/scene/CameraRig";

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
  /** Lives here (rather than local state in `Viewport.tsx`) so the Settings panel in
   * `MenuBar.tsx` — a sibling of the viewport, not an ancestor — can read and change it. */
  projection: ProjectionMode;
  /** Whether constraint glyphs (horizontal/vertical/parallel/.../fix) draw over sketch
   * geometry. Defaults on: they're new, and a feature nobody knows exists is a feature
   * nobody uses. */
  constraintsVisible: boolean;

  cycleDisplayMode: () => void;
  toggleReferenceGeometry: () => void;
  requestZoomFit: () => void;
  setProjection: (mode: ProjectionMode) => void;
  toggleConstraintsVisible: () => void;
}

export const useViewportStore = create<ViewportStore>((set) => ({
  displayMode: "shaded-edges",
  referenceGeometryVisible: true,
  zoomFitRequest: 0,
  projection: "orthographic",
  constraintsVisible: true,

  cycleDisplayMode: () =>
    set((state) => {
      const index = DISPLAY_MODE_CYCLE.indexOf(state.displayMode);
      return { displayMode: DISPLAY_MODE_CYCLE[(index + 1) % DISPLAY_MODE_CYCLE.length] };
    }),

  toggleReferenceGeometry: () =>
    set((state) => ({ referenceGeometryVisible: !state.referenceGeometryVisible })),

  requestZoomFit: () => set((state) => ({ zoomFitRequest: state.zoomFitRequest + 1 })),

  setProjection: (mode) => set({ projection: mode }),

  toggleConstraintsVisible: () =>
    set((state) => ({ constraintsVisible: !state.constraintsVisible })),
}));
