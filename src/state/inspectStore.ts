import { create } from "zustand";

import type { MeasurePick } from "@/kernel/measure";

export type InspectTool = "measure" | "mass" | null;

interface InspectStore {
  /** Which Inspect tool has taken over the viewport/property panel, or `null` when
   * Inspect isn't open. "measure" arms face/edge picking in `SolidModel.tsx`; "mass"
   * needs no picking — it summarises the whole current body as soon as it's opened. */
  activeTool: InspectTool;
  /** Up to two entities picked for the Measure tool, in click order. */
  measurePicks: MeasurePick[];

  openMeasure: () => void;
  openMassProperties: () => void;
  closeInspect: () => void;
  pickForMeasure: (pick: MeasurePick) => void;
  clearMeasurePicks: () => void;
}

export const useInspectStore = create<InspectStore>((set) => ({
  activeTool: null,
  measurePicks: [],

  openMeasure: () => set({ activeTool: "measure", measurePicks: [] }),
  openMassProperties: () => set({ activeTool: "mass", measurePicks: [] }),
  closeInspect: () => set({ activeTool: null, measurePicks: [] }),

  // Clicking an already-picked entity again deselects it; a third pick bumps the oldest
  // one out, since `computeMeasureSummary` only ever uses the two most recent for its
  // distance calculation.
  pickForMeasure: (pick) =>
    set((state) => {
      const existingIndex = state.measurePicks.findIndex((p) => p.kind === pick.kind && p.id === pick.id);
      if (existingIndex >= 0) {
        return { measurePicks: state.measurePicks.filter((_, index) => index !== existingIndex) };
      }
      const next = [...state.measurePicks, pick];
      return { measurePicks: next.length > 2 ? next.slice(next.length - 2) : next };
    }),

  clearMeasurePicks: () => set({ measurePicks: [] }),
}));
