import { create } from "zustand";
import { persist } from "zustand/middleware";

/** "system" tracks the OS light/dark preference; the other two pin it explicitly — see
 * `useIsDarkTheme.ts` and `tokens.css`'s own `[data-theme]` selectors, which this setting
 * is the missing UI for: the override mechanism already existed, nothing ever set it. */
export type ThemePreference = "system" | "light" | "dark";

interface SettingsValues {
  theme: ThemePreference;
  /** Gates the `window.confirm()` in `documentIO.ts` before New/Open discards unsaved
   * work. Still safe with this off — nothing is destroyed silently by anything other than
   * an explicit New/Open the user just asked for — just less naggy for someone who saves
   * constantly and never wants the prompt. */
  confirmBeforeDiscard: boolean;
  /** Sketch units. How close a click needs to land to an existing point to snap to it
   * instead of creating a new coincident one — was a hardcoded constant
   * (`sketchStore.ts`'s old `SNAP_TOLERANCE`) with no way to change it. */
  snapTolerance: number;
  /** Screen pixels. Extra raycasting tolerance around a sketch line beyond its own drawn
   * width, added straight onto `material.linewidth` (`RaycasterTuning.tsx`) — was a
   * hardcoded constant in `Viewport.tsx`'s `Canvas` `onCreated` callback. */
  linePickTolerance: number;
}

interface SettingsStore extends SettingsValues {
  setTheme: (theme: ThemePreference) => void;
  setConfirmBeforeDiscard: (value: boolean) => void;
  setSnapTolerance: (value: number) => void;
  setLinePickTolerance: (value: number) => void;
  /** Replaces every value at once — what Import Settings uses, so an imported file fully
   * determines the result rather than merging over whatever was already set. */
  replaceAll: (values: SettingsValues) => void;
  resetToDefaults: () => void;
}

export const DEFAULT_SETTINGS: SettingsValues = {
  theme: "system",
  confirmBeforeDiscard: true,
  snapTolerance: 2.5,
  linePickTolerance: 6,
};

/**
 * App-wide preferences: the ones that don't belong to one document (unlike
 * `documentStore.unitSystem`, saved inside a `.mabucad` file) or to display state a
 * ribbon toggle already owns (`viewportStore.projection`/`constraintsVisible`) — those
 * stay where they are and the Settings dialog just reads/writes them directly, so this
 * store only holds what's genuinely new here.
 *
 * Persisted to `localStorage` so a choice survives a restart without needing an explicit
 * export/import round-trip for the common case — Export/Import Settings (`settingsIO.ts`)
 * is for moving preferences to a different machine or keeping a backup, not for every day.
 */
export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      setTheme: (theme) => set({ theme }),
      setConfirmBeforeDiscard: (confirmBeforeDiscard) => set({ confirmBeforeDiscard }),
      setSnapTolerance: (value) => set({ snapTolerance: Math.max(0.5, value) }),
      setLinePickTolerance: (value) => set({ linePickTolerance: Math.max(1, value) }),
      replaceAll: (values) => set(values),
      resetToDefaults: () => set(DEFAULT_SETTINGS),
    }),
    { name: "mabucad-settings" },
  ),
);
