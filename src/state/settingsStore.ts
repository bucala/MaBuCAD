import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_SHORTCUT_KEYS, type ShortcutActionId } from "@/commands/keyboardShortcuts";
import { DEFAULT_LANGUAGE, type Language } from "@/i18n/languages";

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
  /** Zooms the wheel towards the point under the cursor rather than the viewport centre —
   * passed straight through to `OrbitControls`' own `zoomToCursor` prop in
   * `CadControls.tsx`, which already supports exactly this as a boolean. */
  zoomToCursor: boolean;
  /** The ViewCube navigation gizmo in the viewport's top-right corner. */
  viewCubeVisible: boolean;
  /** The origin axis triad at the intersection of the default planes — a persisted
   * default, separate from `viewportStore.hiddenFeatureIds`'s per-document override
   * (the feature tree's own eye icon on the Origin row), matching how SolidWorks keeps
   * an Application Options default distinct from a document-level visibility toggle. */
  originIndicatorVisible: boolean;
  /** X/Y/Z text labels at the end of each origin axis — only drawn while
   * `originIndicatorVisible` is also on, since a label with no triad to label makes no
   * sense. */
  axisLabelsVisible: boolean;
  /** UI language. Only `en` (the default) and `sk` have a real translation dictionary
   * (`i18n/translations.ts`) yet; the other seven listed in `i18n/languages.ts` fall
   * back to English string-by-string until they get one, rather than being hidden from
   * the switcher. */
  language: Language;
  /** Off by default — "možnosť aktivácie" (the ability to turn it on), not something
   * silently active from first launch. When on, `useAutosave.ts` periodically writes a
   * recovery snapshot of the current document to `localStorage`; it never touches the
   * file system on its own, since every real Save already needs a path the user picks
   * (`io/files.ts`'s `saveBlob`), and a background save that popped a native file dialog
   * every few minutes would be worse than no autosave at all. */
  autosaveEnabled: boolean;
  /** Key bound to each of `keyboardShortcuts.ts`'s fixed action list — Settings ▸
   * Shortcuts is the UI for rebinding these; `useKeyboardShortcuts.ts` is what reads
   * them live. */
  keyboardShortcuts: Record<ShortcutActionId, string>;
}

interface SettingsStore extends SettingsValues {
  setTheme: (theme: ThemePreference) => void;
  setAccentColor: (hex: string) => void;
  setConfirmBeforeDiscard: (value: boolean) => void;
  setSnapTolerance: (value: number) => void;
  setLinePickTolerance: (value: number) => void;
  setModelColor: (hex: string | null) => void;
  setModelEdgeColor: (hex: string | null) => void;
  toggleZoomToCursor: () => void;
  toggleViewCubeVisible: () => void;
  toggleOriginIndicatorVisible: () => void;
  toggleAxisLabelsVisible: () => void;
  setLanguage: (language: Language) => void;
  toggleAutosave: () => void;
  /** Binds `key` (a `normalizeKeyEvent` string) to `id`. If another action already owns
   * that key, it loses the binding first — two actions racing for the same keypress
   * would otherwise only ever fire whichever one `SHORTCUT_ACTIONS` happens to list
   * first, silently. */
  setShortcutKey: (id: ShortcutActionId, key: string) => void;
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
  zoomToCursor: true,
  viewCubeVisible: true,
  originIndicatorVisible: true,
  axisLabelsVisible: true,
  language: DEFAULT_LANGUAGE,
  autosaveEnabled: false,
  keyboardShortcuts: { ...DEFAULT_SHORTCUT_KEYS },
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
      toggleZoomToCursor: () => set((state) => ({ zoomToCursor: !state.zoomToCursor })),
      toggleViewCubeVisible: () => set((state) => ({ viewCubeVisible: !state.viewCubeVisible })),
      toggleOriginIndicatorVisible: () =>
        set((state) => ({ originIndicatorVisible: !state.originIndicatorVisible })),
      toggleAxisLabelsVisible: () => set((state) => ({ axisLabelsVisible: !state.axisLabelsVisible })),
      setLanguage: (language) => set({ language }),
      toggleAutosave: () => set((state) => ({ autosaveEnabled: !state.autosaveEnabled })),
      setShortcutKey: (id, key) =>
        set((state) => {
          const next = { ...state.keyboardShortcuts };
          for (const otherId of Object.keys(next) as ShortcutActionId[]) {
            if (otherId !== id && next[otherId] === key) next[otherId] = "";
          }
          next[id] = key;
          return { keyboardShortcuts: next };
        }),
      replaceAll: (values) => set(values),
      resetToDefaults: () => set(DEFAULT_SETTINGS),
    }),
    { name: "mabucad-settings" },
  ),
);
