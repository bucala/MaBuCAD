import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { X } from "lucide-react";

import { normalizeKeyEvent, SHORTCUT_ACTIONS } from "@/commands/keyboardShortcuts";
import { runExportSettings, runImportSettings } from "@/commands/settingsIO";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { LANGUAGES } from "@/i18n/languages";
import { useTranslation } from "@/i18n/useTranslation";
import { useDocumentStore } from "@/state/documentStore";
import {
  ACCENT_PRESETS,
  useSettingsStore,
  type ThemePreference,
  type ViewportBackground,
} from "@/state/settingsStore";
import { useViewportStore } from "@/state/viewportStore";
import type { UnitSystem, UnitSystemId } from "@/types/ui";

import styles from "./SettingsDialog.module.css";

const UNIT_SYSTEMS: UnitSystem[] = [
  { id: "MMGS", label: "MMGS", description: "Millimetre, gram, second" },
  { id: "CGS", label: "CGS", description: "Centimetre, gram, second" },
  { id: "MKS", label: "MKS", description: "Metre, kilogram, second" },
  { id: "IPS", label: "IPS", description: "Inch, pound, second" },
];

const TABS = ["General", "Colours", "Display", "Sketch", "Shortcuts", "File"] as const;
type TabId = (typeof TABS)[number];

/** Toggle-button row shared by every tab. */
function ToggleRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; title?: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className={styles.toggleRow} role="group">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={styles.toggleButton}
          aria-pressed={value === option.id}
          title={option.title}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function GeneralTab() {
  const confirmBeforeDiscard = useSettingsStore((state) => state.confirmBeforeDiscard);
  const setConfirmBeforeDiscard = useSettingsStore((state) => state.setConfirmBeforeDiscard);
  const resetToDefaults = useSettingsStore((state) => state.resetToDefaults);
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const { t } = useTranslation();

  return (
    <>
      <div className={styles.section}>
        <span className={styles.sectionTitle}>{t("settings.language", "Language")}</span>
        <select
          className={styles.numberInput}
          style={{ width: "100%", textAlign: "left" }}
          value={language}
          onChange={(event) => setLanguage(event.target.value as typeof language)}
          aria-label={t("settings.language", "Language")}
        >
          {LANGUAGES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.nativeName}
              {option.id !== "en" ? ` — ${option.englishName}` : ""}
            </option>
          ))}
        </select>
        <p className={styles.sectionHint}>
          Only English and Slovak are fully translated so far — the rest fall back to
          English one string at a time as they're translated.
        </p>
      </div>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>Prompting</span>
        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={confirmBeforeDiscard}
            onChange={(event) => setConfirmBeforeDiscard(event.target.checked)}
          />
          Confirm before discarding unsaved changes (New / Open)
        </label>
      </div>

      <div className={styles.section}>
        <button type="button" className={styles.footerButton} onClick={resetToDefaults}>
          Reset to Defaults
        </button>
      </div>
    </>
  );
}

// Mirrors `SolidModel.tsx`'s own hardcoded fallbacks — shown as the swatch's resting
// colour whenever the matching override is `null` ("Automatic").
const AUTO_MODEL_COLOR = { light: "#c9d4e0", dark: "#b8c4d0" };
const AUTO_MODEL_EDGE_COLOR = { light: "#2b3138", dark: "#1b1f24" };

/** A colour swatch backed by a native colour picker, with a button to fall back to the
 * app's own automatic (theme-matched) default — used for every override in this tab that
 * isn't one of the fixed `ACCENT_PRESETS` swatches. */
function ColorField({
  label,
  hint,
  value,
  autoValue,
  onChange,
}: {
  label: string;
  hint: string;
  value: string | null;
  autoValue: string;
  onChange: (hex: string | null) => void;
}) {
  return (
    <div className={styles.section}>
      <span className={styles.sectionTitle}>{label}</span>
      <div className={styles.colorFieldRow}>
        <input
          type="color"
          className={styles.colorInput}
          value={value ?? autoValue}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className={styles.footerButton}
          disabled={value === null}
          onClick={() => onChange(null)}
        >
          Automatic
        </button>
      </div>
      <p className={styles.sectionHint}>{hint}</p>
    </div>
  );
}

const BACKGROUND_MODES: { id: ViewportBackground["mode"]; label: string; title?: string }[] = [
  { id: "theme", label: "Theme", title: "The current theme's default gradient" },
  { id: "solid", label: "Solid" },
  { id: "gradient-center", label: "Gradient (centre)" },
  { id: "gradient-bottom", label: "Gradient (bottom)" },
  { id: "image", label: "Image" },
];

/** Settings > Colours' "Viewport Background" section — see `Viewport.tsx`'s own
 * `backgroundStyle` for how each mode actually renders. */
function ViewportBackgroundField() {
  const background = useSettingsStore((state) => state.viewportBackground);
  const setViewportBackground = useSettingsStore((state) => state.setViewportBackground);

  const handleImageFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setViewportBackground({ imageDataUrl: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className={styles.section}>
      <span className={styles.sectionTitle}>Viewport Background</span>
      <ToggleRow<ViewportBackground["mode"]>
        value={background.mode}
        onChange={(mode) => setViewportBackground({ mode })}
        options={BACKGROUND_MODES}
      />

      {background.mode !== "theme" && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Colour</span>
          <input
            type="color"
            className={styles.colorInput}
            value={background.color}
            aria-label="Viewport background colour"
            onChange={(event) => setViewportBackground({ color: event.target.value })}
          />
        </div>
      )}

      {(background.mode === "gradient-center" || background.mode === "gradient-bottom") && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Intensity</span>
          <input
            type="range"
            className={styles.rangeInput}
            min={0}
            max={100}
            value={Math.round(background.intensity * 100)}
            aria-label="Gradient intensity"
            onChange={(event) => setViewportBackground({ intensity: Number(event.target.value) / 100 })}
          />
        </div>
      )}

      {background.mode === "image" && (
        <>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Image</span>
            <label className={styles.footerButton}>
              Choose…
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => handleImageFile(event.target.files?.[0])}
              />
            </label>
          </div>
          {background.imageDataUrl && (
            <>
              <div
                className={styles.backgroundPreview}
                style={{ backgroundImage: `url(${background.imageDataUrl})`, opacity: background.imageOpacity }}
              />
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Opacity</span>
                <input
                  type="range"
                  className={styles.rangeInput}
                  min={0}
                  max={100}
                  value={Math.round(background.imageOpacity * 100)}
                  aria-label="Image opacity"
                  onChange={(event) => setViewportBackground({ imageOpacity: Number(event.target.value) / 100 })}
                />
              </div>
            </>
          )}
        </>
      )}

      <p className={styles.sectionHint}>
        Overrides the current theme's default gradient in the 3D and sketch viewport.
      </p>
    </div>
  );
}

function ColoursTab() {
  const isDark = useIsDarkTheme();
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const setAccentColor = useSettingsStore((state) => state.setAccentColor);
  const modelColor = useSettingsStore((state) => state.modelColor);
  const setModelColor = useSettingsStore((state) => state.setModelColor);
  const modelEdgeColor = useSettingsStore((state) => state.modelEdgeColor);
  const setModelEdgeColor = useSettingsStore((state) => state.setModelEdgeColor);

  return (
    <>
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Theme</span>
        <ToggleRow<ThemePreference>
          value={theme}
          onChange={setTheme}
          options={[
            { id: "system", label: "System", title: "Follow the OS light/dark setting" },
            { id: "light", label: "Light" },
            { id: "gray", label: "Gray", title: "A neutral mid-grey workspace between light and dark" },
            { id: "dark", label: "Dark" },
          ]}
        />
      </div>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>Accent Colour</span>
        <div className={styles.swatchRow} role="group" aria-label="Accent colour">
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={styles.swatch}
              style={{ "--swatch-color": preset.hex } as CSSProperties}
              aria-pressed={accentColor.toLowerCase() === preset.hex.toLowerCase()}
              title={preset.label}
              aria-label={preset.label}
              onClick={() => setAccentColor(preset.hex)}
            />
          ))}
        </div>
        <p className={styles.sectionHint}>
          Recolours buttons, selection highlights and sketch previews throughout the app.
        </p>
      </div>

      <ColorField
        label="Model Colour"
        hint="The shaded solid's surface colour. Automatic picks a neutral grey tuned for the current theme."
        value={modelColor}
        autoValue={isDark ? AUTO_MODEL_COLOR.dark : AUTO_MODEL_COLOR.light}
        onChange={setModelColor}
      />

      <ColorField
        label="Model Edge Colour"
        hint="The B-Rep edge overlay drawn on top of the solid in Shaded with Edges and Wireframe."
        value={modelEdgeColor}
        autoValue={isDark ? AUTO_MODEL_EDGE_COLOR.dark : AUTO_MODEL_EDGE_COLOR.light}
        onChange={setModelEdgeColor}
      />

      <ViewportBackgroundField />
    </>
  );
}

function DisplayTab() {
  const projection = useViewportStore((state) => state.projection);
  const setProjection = useViewportStore((state) => state.setProjection);
  const linePickTolerance = useSettingsStore((state) => state.linePickTolerance);
  const setLinePickTolerance = useSettingsStore((state) => state.setLinePickTolerance);

  const zoomToCursor = useSettingsStore((state) => state.zoomToCursor);
  const toggleZoomToCursor = useSettingsStore((state) => state.toggleZoomToCursor);
  const viewCubeVisible = useSettingsStore((state) => state.viewCubeVisible);
  const toggleViewCubeVisible = useSettingsStore((state) => state.toggleViewCubeVisible);
  const originIndicatorVisible = useSettingsStore((state) => state.originIndicatorVisible);
  const toggleOriginIndicatorVisible = useSettingsStore((state) => state.toggleOriginIndicatorVisible);
  const axisLabelsVisible = useSettingsStore((state) => state.axisLabelsVisible);
  const toggleAxisLabelsVisible = useSettingsStore((state) => state.toggleAxisLabelsVisible);

  return (
    <>
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Projection</span>
        <ToggleRow
          value={projection}
          onChange={setProjection}
          options={[
            {
              id: "orthographic",
              label: "Orthographic",
              title: "Parallel projection — equal lengths measure equal on screen",
            },
            { id: "perspective", label: "Perspective", title: "Natural depth, for presentation views" },
          ]}
        />
      </div>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>Picking</span>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Line pick tolerance (px)</span>
          <input
            className={styles.numberInput}
            type="number"
            min={1}
            step={1}
            value={linePickTolerance}
            onChange={(event) => setLinePickTolerance(Number(event.target.value))}
          />
        </div>
        <p className={styles.sectionHint}>
          Extra invisible margin around a thin sketch line or model edge before a click counts
          as a hit — higher makes clicking easier at the cost of precision when lines run close
          together.
        </p>
      </div>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>3D Navigation</span>

        <label className={styles.checkboxField}>
          <input type="checkbox" checked={zoomToCursor} onChange={toggleZoomToCursor} />
          Zoom to cursor
        </label>
        <p className={styles.sectionHint}>
          The scroll wheel zooms toward whatever is under the pointer instead of the centre of
          the viewport.
        </p>

        <label className={styles.checkboxField}>
          <input type="checkbox" checked={viewCubeVisible} onChange={toggleViewCubeVisible} />
          Show ViewCube
        </label>

        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={originIndicatorVisible}
            onChange={toggleOriginIndicatorVisible}
          />
          Show Origin 3D indicator
        </label>

        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={axisLabelsVisible}
            disabled={!originIndicatorVisible}
            onChange={toggleAxisLabelsVisible}
          />
          Show Origin XYZ axis labels
        </label>
      </div>
    </>
  );
}

function SketchTab() {
  const snapTolerance = useSettingsStore((state) => state.snapTolerance);
  const setSnapTolerance = useSettingsStore((state) => state.setSnapTolerance);
  const constraintsVisible = useViewportStore((state) => state.constraintsVisible);
  const toggleConstraintsVisible = useViewportStore((state) => state.toggleConstraintsVisible);

  return (
    <>
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Snapping</span>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Snap tolerance (sketch units)</span>
          <input
            className={styles.numberInput}
            type="number"
            min={0.5}
            step={0.5}
            value={snapTolerance}
            onChange={(event) => setSnapTolerance(Number(event.target.value))}
          />
        </div>
        <p className={styles.sectionHint}>
          How close a click needs to land to an existing point before it snaps to it instead of
          creating a new coincident one.
        </p>
      </div>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>Constraints</span>
        <label className={styles.checkboxField}>
          <input type="checkbox" checked={constraintsVisible} onChange={toggleConstraintsVisible} />
          Show constraint glyphs (also on View ▸ Constraints)
        </label>
      </div>
    </>
  );
}

function ShortcutsTab() {
  const shortcuts = useSettingsStore((state) => state.keyboardShortcuts);
  const setShortcutKey = useSettingsStore((state) => state.setShortcutKey);
  const [listeningFor, setListeningFor] = useState<(typeof SHORTCUT_ACTIONS)[number]["id"] | null>(null);

  // Capturing phase + `stopPropagation` so this intercepts the key before the app's own
  // global shortcut listener (`useKeyboardShortcuts.ts`) or this dialog's own Escape-to-
  // close handler ever see it — otherwise pressing "Delete" to rebind it would also
  // delete the current selection, and Escape would close the dialog instead of just
  // cancelling the capture.
  useEffect(() => {
    if (!listeningFor) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key !== "Escape") setShortcutKey(listeningFor, normalizeKeyEvent(event));
      setListeningFor(null);
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [listeningFor, setShortcutKey]);

  return (
    <div className={styles.section}>
      <span className={styles.sectionTitle}>Shortcuts</span>
      {SHORTCUT_ACTIONS.map((action) => (
        <div key={action.id} className={styles.field}>
          <span className={styles.fieldLabel}>{action.label}</span>
          <button
            type="button"
            className={styles.toggleButton}
            aria-pressed={listeningFor === action.id}
            onClick={() => setListeningFor(action.id)}
          >
            {listeningFor === action.id ? "Press a key…" : shortcuts[action.id] || "Not set"}
          </button>
        </div>
      ))}
      <p className={styles.sectionHint}>
        Click a shortcut, then press the key (or combination) to bind it. Escape cancels
        without changing it. Binding a key already used by another shortcut here clears it
        from that one.
      </p>
    </div>
  );
}

function FileTab() {
  const unitSystem = useDocumentStore((state) => state.unitSystem);
  const setUnitSystem = useDocumentStore((state) => state.setUnitSystem);

  return (
    <div className={styles.section}>
      <span className={styles.sectionTitle}>Units</span>
      <ToggleRow<UnitSystemId>
        value={unitSystem}
        onChange={setUnitSystem}
        options={UNIT_SYSTEMS.map((system) => ({
          id: system.id,
          label: system.label,
          title: system.description,
        }))}
      />
      <p className={styles.sectionHint}>Saved with each document, so this only sets the default for new ones.</p>
    </div>
  );
}

/**
 * "Application Options"-style settings dialog, opened from the gear icon or Tools ▸
 * Options in `MenuBar.tsx`.
 *
 * Tabbed like the reference dialog it was modelled on, though with only the tabs that
 * have something real behind them yet — Assembly, Drawing, Content Center and Hardware
 * are all still-unbuilt parts of the app (see the wider roadmap in CHANGELOG.md) with
 * nothing to configure, so adding empty tabs for them would just be decoration.
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<TabId>("General");
  const dialogRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (!dialogRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="Application Options">
        <div className={styles.header}>
          <h2 className={styles.title}>{t("settings.title", "Application Options")}</h2>
          <button type="button" className={styles.closeButton} aria-label="Close Application Options" onClick={onClose}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className={styles.tabStrip} role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              className={styles.tab}
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
            >
              {t(`settings.tab.${tab.toLowerCase()}`, tab)}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          {activeTab === "General" && <GeneralTab />}
          {activeTab === "Colours" && <ColoursTab />}
          {activeTab === "Display" && <DisplayTab />}
          {activeTab === "Sketch" && <SketchTab />}
          {activeTab === "Shortcuts" && <ShortcutsTab />}
          {activeTab === "File" && <FileTab />}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.footerButton} onClick={() => void runExportSettings()}>
            Export Settings…
          </button>
          <button type="button" className={styles.footerButton} onClick={() => void runImportSettings()}>
            Import Settings…
          </button>
          <div className={styles.footerSpacer} />
          <button type="button" className={styles.primaryButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
