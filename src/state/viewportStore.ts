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

/** See `ViewRotationSteps.tsx` for what each direction actually does to the camera. */
export type RotateStepDirection = "up" | "down" | "left" | "right" | "roll-cw" | "roll-ccw";

/**
 * Selection-priority filter for clicking the solid, à la Inventor's Select dropdown.
 * "body" (the default, and the only behaviour that existed before this) treats a click
 * anywhere on the solid as picking the whole body/feature. "face" instead resolves the
 * exact kernel Face the click landed on (via `MeshData.faceGroups` — see its own doc
 * comment in `kernel/rebuild.ts`) and highlights just that face. Point/edge priority are
 * not implemented yet; edge-picking already exists but only inside Fillet/Chamfer's own
 * pick mode (`edgePickModeFeatureId`), not as a general selection filter.
 */
export type SelectionFilterMode = "body" | "face";

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
  /**
   * Whether the Hole Wizard is waiting for a click on a solid face to place its first
   * hole. Set by `commandRegistry.ts`'s `feature.hole-wizard` when no sketch with an
   * existing point could be resolved, and read by `SolidModel.tsx`, which is the one
   * component that can turn a raycaster hit into a world point + face normal — the same
   * sibling-store pattern `edgePickModeFeatureId` already uses, except there is no
   * feature id yet to key this by: the sketch and the hole feature are only created once
   * a suitable face is actually clicked (`placeHoleAtPick` in `commandRegistry.ts`).
   */
  holePlacementActive: boolean;
  /** Ground grid in the 3D viewport and, while a sketch is open, the sketcher's own
   * in-plane grid too — one toggle, since they're never both visible at once. */
  gridVisible: boolean;
  /** Whether newly drawn/dragged sketch points snap to the sketch grid's intersections,
   * on top of the existing snap-to-nearby-point behaviour (see `SketchCanvas.tsx`'s
   * `toSketch`). Off by default: existing point/entity snapping already covers the common
   * case, and forcing every click onto the grid would surprise anyone not expecting it. */
  snapToGridEnabled: boolean;
  /** Set by the ViewCube's navigation arrows (a plain DOM overlay, outside the r3f tree —
   * see `ZoomToFit.tsx`'s own doc comment for why a request object here, rather than a
   * direct call, is how DOM controls reach the camera). `null` until the first click; the
   * `nonce` is what the in-canvas handler actually watches, since two consecutive clicks in
   * the same direction still need to trigger a step each time. `up`/`down`/`left`/`right`
   * orbit the camera around the model; `roll-cw`/`roll-ccw` spin the camera's own up vector
   * around the current view axis instead, tilting the horizon without changing what's
   * actually facing the camera. */
  rotateStepRequest: { direction: RotateStepDirection; nonce: number } | null;
  /** See `SelectionFilterMode`'s own doc comment. */
  selectionFilterMode: SelectionFilterMode;
  /**
   * The kernel Face id (`FaceGroup.id`, from the currently committed `MeshData`) currently
   * highlighted under "face" priority, or `null`. Face ids are only stable for the mesh
   * they came from — a rebuild can renumber them — so `SolidModel.tsx` clears this whenever
   * the committed mesh reference changes, not just when the filter mode itself changes.
   */
  selectedFaceId: number | null;
  /** Incremented, never read for its own value — same "request counter" shape as
   * `zoomFitRequest`, watched by `PrintCapture.tsx` inside the `Canvas` (the only place
   * that can reach the WebGL renderer to grab a snapshot of what's actually on screen). */
  printRequest: number;
  /** The most recently captured viewport snapshot as a data URL, or `null` between
   * prints. Set by `PrintCapture.tsx`, consumed by `PrintOverlay.tsx` (a plain DOM
   * sibling of the app, outside the `Canvas`) which renders it into a print-only layer
   * and triggers the browser's print dialog once it's actually in the DOM. */
  printSnapshot: string | null;

  cycleDisplayMode: () => void;
  toggleFeatureVisibility: (id: string) => void;
  requestZoomFit: () => void;
  setProjection: (mode: ProjectionMode) => void;
  toggleConstraintsVisible: () => void;
  setEdgePickMode: (featureId: string | null) => void;
  setHolePlacementActive: (active: boolean) => void;
  toggleGridVisible: () => void;
  toggleSnapToGrid: () => void;
  requestRotateStep: (direction: RotateStepDirection) => void;
  setSelectionFilterMode: (mode: SelectionFilterMode) => void;
  setSelectedFaceId: (id: number | null) => void;
  requestPrint: () => void;
  setPrintSnapshot: (dataUrl: string | null) => void;
}

export const useViewportStore = create<ViewportStore>((set) => ({
  displayMode: "shaded-edges",
  hiddenFeatureIds: [],
  zoomFitRequest: 0,
  projection: "orthographic",
  constraintsVisible: true,
  edgePickModeFeatureId: null,
  holePlacementActive: false,
  gridVisible: true,
  snapToGridEnabled: false,
  rotateStepRequest: null,
  selectionFilterMode: "body",
  selectedFaceId: null,
  printRequest: 0,
  printSnapshot: null,

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
  setHolePlacementActive: (active) => set({ holePlacementActive: active }),

  toggleGridVisible: () => set((state) => ({ gridVisible: !state.gridVisible })),
  toggleSnapToGrid: () => set((state) => ({ snapToGridEnabled: !state.snapToGridEnabled })),

  requestRotateStep: (direction) =>
    set((state) => ({
      rotateStepRequest: { direction, nonce: (state.rotateStepRequest?.nonce ?? 0) + 1 },
    })),

  // Switching away from "face" drops whatever was highlighted — there's nothing to show it
  // for once the filter no longer resolves individual faces.
  setSelectionFilterMode: (mode) => set({ selectionFilterMode: mode, selectedFaceId: null }),
  setSelectedFaceId: (id) => set({ selectedFaceId: id }),

  requestPrint: () => set((state) => ({ printRequest: state.printRequest + 1 })),
  setPrintSnapshot: (dataUrl) => set({ printSnapshot: dataUrl }),
}));
