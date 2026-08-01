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
  /**
   * Feature ids individually hidden — a reference plane, the origin, or (see
   * `SolidModel.tsx`) any modelling feature, which hides the whole solid: the kernel
   * fuses every modelling feature into one combined mesh, so there is no per-feature
   * partial geometry to hide independently yet, only the body as a whole. Hiding any one
   * contributing feature hides that whole body, which is the closest honest approximation
   * of "hide this feature's contribution" the current single-mesh pipeline can offer.
   */
  hiddenFeatureIds: string[];
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
  /**
   * The Fillet/Chamfer feature currently in "pick edges in the viewport" mode, or `null`
   * when nothing is being picked. Lives here rather than local state in `PropertyManager.tsx`
   * (which starts the mode) because `SolidModel.tsx` (which handles the actual edge clicks) is
   * a sibling, not a descendant — the two need a shared place to agree "picking is on, for
   * this feature" the same way `hiddenFeatureIds` already crosses that same sibling boundary.
   */
  edgePickModeFeatureId: string | null;
  /** Ground grid in the 3D viewport (not the sketcher's own in-plane grid, which is
   * unaffected). Defaults on, matching every other CAD viewport. */
  gridVisible: boolean;

  cycleDisplayMode: () => void;
  toggleFeatureVisibility: (id: string) => void;
  requestZoomFit: () => void;
  setProjection: (mode: ProjectionMode) => void;
  toggleConstraintsVisible: () => void;
  setEdgePickMode: (featureId: string | null) => void;
  toggleGridVisible: () => void;
}

export const useViewportStore = create<ViewportStore>((set) => ({
  displayMode: "shaded-edges",
  hiddenFeatureIds: [],
  zoomFitRequest: 0,
  projection: "orthographic",
  constraintsVisible: true,
  edgePickModeFeatureId: null,
  gridVisible: true,

  cycleDisplayMode: () =>
    set((state) => {
      const index = DISPLAY_MODE_CYCLE.indexOf(state.displayMode);
      return { displayMode: DISPLAY_MODE_CYCLE[(index + 1) % DISPLAY_MODE_CYCLE.length] };
    }),

  toggleFeatureVisibility: (id) =>
    set((state) => ({
      hiddenFeatureIds: state.hiddenFeatureIds.includes(id)
        ? state.hiddenFeatureIds.filter((hiddenId) => hiddenId !== id)
        : [...state.hiddenFeatureIds, id],
    })),

  requestZoomFit: () => set((state) => ({ zoomFitRequest: state.zoomFitRequest + 1 })),

  setProjection: (mode) => set({ projection: mode }),

  toggleConstraintsVisible: () =>
    set((state) => ({ constraintsVisible: !state.constraintsVisible })),

  setEdgePickMode: (featureId) => set({ edgePickModeFeatureId: featureId }),

  toggleGridVisible: () => set((state) => ({ gridVisible: !state.gridVisible })),
}));
