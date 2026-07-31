import { create } from "zustand";

import { rebuildDocument, type MeshData } from "@/kernel/rebuild";
import type { Sketch } from "@/sketch/types";
import type { Feature } from "@/types/document";

export type GeometryStatus = "empty" | "loading-kernel" | "building" | "ready" | "error";

/** Feature kinds that the kernel actually contributes geometry for. */
export const GEOMETRY_FEATURE_KINDS = new Set([
  "extrude",
  "cut-extrude",
  "revolve",
  "cut-revolve",
  "hole",
  "rib",
  "loft",
  "sweep",
  "cut-sweep",
  "imported",
  "linear-pattern",
  "circular-pattern",
  "mirror",
]);

interface GeometryStore {
  status: GeometryStatus;
  mesh: MeshData | null;
  /** Feature id -> rebuild error, surfaced as badges in the feature tree. */
  errors: Record<string, string>;
  message: string | null;
  /**
   * Transient notice from interchange (import/export progress, success, failure).
   *
   * Kept separate from `message` on purpose: a rebuild triggered by the same import (the
   * new feature entering the document) would otherwise overwrite "Imported x.step" with
   * "Model up to date" within a couple hundred milliseconds, so the two need independent
   * lifetimes rather than sharing one field.
   */
  toast: string | null;
  /**
   * The body as it was *before* the feature currently being edge-picked for (see
   * `viewportStore.ts`'s `edgePickModeFeatureId`), used only while picking. A Fillet/Chamfer
   * already applied to every edge by default rounds the whole body the moment it's created —
   * picking specific edges on *that* result would mean clicking already-rounded surfaces
   * whose edges have moved from where the original sharp ones were, which is exactly the kind
   * of mismatch `EdgeFinder.withinDistance`'s tolerance can't paper over. `SolidModel.tsx`
   * swaps to showing this mesh instead of the real one while picking is active, so what the
   * user clicks is what the picked points are actually measured against.
   */
  previewMesh: MeshData | null;

  rebuild: (features: Feature[], sketches: Record<string, Sketch>) => Promise<void>;
  /** Rebuilds with `hideFeatureId` suppressed, into `previewMesh` rather than `mesh` — the
   * document itself is untouched, this is display-only. */
  rebuildPreview: (features: Feature[], sketches: Record<string, Sketch>, hideFeatureId: string) => Promise<void>;
  clearPreview: () => void;
  showToast: (message: string, durationMs?: number) => void;
}

/**
 * Rebuilds are async and can be triggered faster than they complete — dragging a depth
 * field fires one per keystroke. Only the newest request is allowed to publish its
 * result, so a slow earlier rebuild cannot overwrite a newer one.
 */
let latestRequest = 0;
let latestPreviewRequest = 0;
let kernelReady = false;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useGeometryStore = create<GeometryStore>((set) => ({
  status: "empty",
  mesh: null,
  errors: {},
  message: null,
  toast: null,
  previewMesh: null,

  showToast: (toastMessage, durationMs = 4000) => {
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    set({ toast: toastMessage });
    toastTimer = setTimeout(() => set({ toast: null }), durationMs);
  },

  rebuild: async (features, sketches) => {
    const modelling = features.filter(
      (feature) => !feature.suppressed && GEOMETRY_FEATURE_KINDS.has(feature.kind),
    );

    if (modelling.length === 0) {
      latestRequest += 1;
      set({ status: "empty", mesh: null, errors: {}, message: null });
      return;
    }

    const request = (latestRequest += 1);
    set({
      status: kernelReady ? "building" : "loading-kernel",
      message: kernelReady ? null : "Loading geometry kernel…",
    });

    try {
      const result = await rebuildDocument(features, sketches);
      kernelReady = true;
      if (request !== latestRequest) return;

      set({
        status: "ready",
        mesh: result.mesh,
        errors: result.errors,
        message: null,
      });
    } catch (error) {
      if (request !== latestRequest) return;
      set({
        status: "error",
        message: error instanceof Error ? error.message : "Geometry rebuild failed",
      });
    }
  },

  rebuildPreview: async (features, sketches, hideFeatureId) => {
    const request = (latestPreviewRequest += 1);
    const withoutPicked = features.map((feature) =>
      feature.id === hideFeatureId ? { ...feature, suppressed: true } : feature,
    );

    try {
      const result = await rebuildDocument(withoutPicked, sketches);
      if (request !== latestPreviewRequest) return;
      set({ previewMesh: result.mesh });
    } catch {
      if (request !== latestPreviewRequest) return;
      set({ previewMesh: null });
    }
  },

  clearPreview: () => {
    latestPreviewRequest += 1;
    set({ previewMesh: null });
  },
}));
