import { create } from "zustand";
import { persist } from "zustand/middleware";

/** "system" tracks the OS light/dark preference; "gray" is a third explicit skin between
 * light and dark (a neutral, lower-contrast surface for long sketching sessions) — see
 * `useIsDarkTheme.ts` and `tokens.css`'s own `[data-theme]` selectors, which this setting
 * is the missing UI for: the override mechanism already existed, nothing ever set it. */
export type ThemePreference = "system" | "light" | "dark" | "gray";

/** Hex colour driving `--accent` in `tokens.css` — every derived shade (hover, active,
 * subtle fills, selection highlight, accent text) is computed from this one value via
 * `color-mix()`, so picking a swatch re-tints the whole app without touching CSS. */
export interface AccentPreset {
  id: string;
  label: string;
  hex: string;
}

/** Five swatches: the original Fluent blue this app shipped with, the new default, and
 * three more spanning enough hue to read as genuinely different accents, not shades of
 * one colour. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "coral", label: "Coral", hex: "#DE7356" },
  { id: "blue", label: "Blue", hex: "#0078D4" },
  { id: "teal", label: "Teal", hex: "#1FB6A6" },
  { id: "violet", label: "Violet", hex: "#7C6FEF" },
  { id: "amber", label: "Amber", hex: "#E0A83E" },
];

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].hex;

interface SettingsValues {
  theme: ThemePreference;
  /** Hex accent colour; not restricted to `ACCENT_PRESETS` — Import Settings can carry a
   * custom value, and the picker itself may grow a custom swatch later. */
  accentColor: string;
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
  /** Solid material colour override; `null` keeps `SolidModel.tsx`'s own light/dark
   * default (a neutral grey chosen to read well against either skin). Unlike
   * `accentColor`, this is genuinely optional — most users never need to move off the
   * default, so there is no preset row, just a colour picker and a way back to auto. */
  modelColor: string | null;
  /** B-Rep edge overlay colour override — same `null`-is-automatic convention as
   * `modelColor`. Matches SolidWorks' "Model Edge Color" option in Display Appearance. */
  modelEdgeColor: string | null;
}

interface SettingsStore extends SettingsValues {
  setTheme: (theme: ThemePreference) => void;
  setAccentColor: (hex: string) => void;
  setConfirmBeforeDiscard: (value: boolean) => void;
  setSnapTolerance: (value: number) => void;
  setLinePickTolerance: (value: number) => void;
  setModelColor: (hex: string | null) => void;
  setModelEdgeColor: (hex: string | null) => void;
  /** Replaces every value at once — what Import Settings uses, so an imported file fully
   * determines the result rather than merging over whatever was already set. */
  replaceAll: (values: SettingsValues) => void;
  resetToDefaults: () => void;
}

export const DEFAULT_SETTINGS: SettingsValues = {
  theme: "system",
  accentColor: DEFAULT_ACCENT,
  confirmBeforeDiscard: true,
  snapTolerance: 2.5,
  linePickTolerance: 6,
  modelColor: null,
  modelEdgeColor: null,
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
      setAccentColor: (accentColor) => set({ accentColor }),
      setConfirmBeforeDiscard: (confirmBeforeDiscard) => set({ confirmBeforeDiscard }),
      setSnapTolerance: (value) => set({ snapTolerance: Math.max(0.5, value) }),
      setLinePickTolerance: (value) => set({ linePickTolerance: Math.max(1, value) }),
      setModelColor: (hex) => set({ modelColor: hex }),
      setModelEdgeColor: (hex) => set({ modelEdgeColor: hex }),
      replaceAll: (values) => set(values),
      resetToDefaults: () => set(DEFAULT_SETTINGS),
    }),
    { name: "mabucad-settings" },
  ),
);
