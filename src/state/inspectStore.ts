import { create } from "zustand";

import type { MeasurePick } from "@/kernel/measure";

export type InspectTool =
  | "measure"
  | "mass"
  | "section"
  | "geometry"
  | "draft-analysis"
  | "parent-child"
  | "equations"
  | "sensors"
  | "appearance"
  | null;

export type Axis = "x" | "y" | "z";

/** Appearance's starting swatch — an accent-adjacent blue, distinct from the default grey
 * model colour so a freshly painted face is obviously different at a glance. */
const DEFAULT_APPEARANCE_COLOR = "#3b82f6";

interface InspectStore {
  /** Which Inspect tool has taken over the viewport/property panel, or `null` when
   * Inspect isn't open. Tools that pick viewport entities ("measure", "section",
   * "appearance") arm a click handler in `SolidModel.tsx`; the rest need no picking. */
  activeTool: InspectTool;
  /** Up to two entities picked for the Measure tool, in click order. */
  measurePicks: MeasurePick[];
  /** The single face picked for Section Properties, or `null`. */
  sectionFacePick: number | null;
  /** Draft Analysis' pull direction and the angle below which a face is flagged. */
  draftAxis: Axis;
  draftLimitDegrees: number;
  /** Appearance's currently selected paint colour — applied to whichever face is clicked
   * next in the viewport, the same "arm a colour, then click targets" flow a paint bucket
   * tool uses. */
  appearanceColor: string;
  /** Appearance's per-face colour overrides, keyed by `FaceGroup.id` — like every other
   * face id in this app, only valid for the mesh it was picked from (see `rebuild.ts`'s
   * `FaceGroup` doc comment); cleared whenever the committed mesh changes. */
  faceColors: Record<number, string>;

  openTool: (tool: Exclude<InspectTool, null>) => void;
  closeInspect: () => void;

  pickForMeasure: (pick: MeasurePick) => void;
  clearMeasurePicks: () => void;

  pickForSection: (faceId: number) => void;
  clearSectionPick: () => void;

  setDraftAxis: (axis: Axis) => void;
  setDraftLimitDegrees: (degrees: number) => void;

  setAppearanceColor: (color: string) => void;
  /** Applies the current `appearanceColor` to a face — clicking a face that already has
   * that exact colour clears the override instead, the same toggle-off-on-repeat-click
   * convention every other pick tool in this app already uses. */
  paintFace: (faceId: number) => void;
  clearFaceColor: (faceId: number) => void;
  clearAllFaceColors: () => void;

  /** Drops every pick/highlight keyed by a face or edge id — called whenever the
   * committed mesh changes, since `rebuild.ts` renumbers both fresh on every rebuild. */
  resetMeshDerivedState: () => void;
}

export const useInspectStore = create<InspectStore>((set, get) => ({
  activeTool: null,
  measurePicks: [],
  sectionFacePick: null,
  draftAxis: "z",
  draftLimitDegrees: 5,
  appearanceColor: DEFAULT_APPEARANCE_COLOR,
  faceColors: {},

  openTool: (tool) => set({ activeTool: tool, measurePicks: [], sectionFacePick: null }),
  closeInspect: () => set({ activeTool: null, measurePicks: [], sectionFacePick: null }),

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

  // Section Properties only ever looks at one face — a second click just replaces the
  // first rather than toggling, since there is no meaningful "deselect back to nothing"
  // gesture a single-entity tool needs.
  pickForSection: (faceId) => set({ sectionFacePick: faceId }),
  clearSectionPick: () => set({ sectionFacePick: null }),

  setDraftAxis: (axis) => set({ draftAxis: axis }),
  setDraftLimitDegrees: (degrees) => set({ draftLimitDegrees: degrees }),

  setAppearanceColor: (color) => set({ appearanceColor: color }),
  paintFace: (faceId) =>
    set((state) => {
      const faceColors = { ...state.faceColors };
      if (faceColors[faceId] === get().appearanceColor) delete faceColors[faceId];
      else faceColors[faceId] = state.appearanceColor;
      return { faceColors };
    }),
  clearFaceColor: (faceId) =>
    set((state) => {
      const faceColors = { ...state.faceColors };
      delete faceColors[faceId];
      return { faceColors };
    }),
  clearAllFaceColors: () => set({ faceColors: {} }),

  resetMeshDerivedState: () => set({ measurePicks: [], sectionFacePick: null, faceColors: {} }),
}));
