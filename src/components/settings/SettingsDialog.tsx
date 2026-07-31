import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { runExportSettings, runImportSettings } from "@/commands/settingsIO";
import { useDocumentStore } from "@/state/documentStore";
import { useSettingsStore, type ThemePreference } from "@/state/settingsStore";
import { useViewportStore } from "@/state/viewportStore";
import type { UnitSystem, UnitSystemId } from "@/types/ui";

import styles from "./SettingsDialog.module.css";

const UNIT_SYSTEMS: UnitSystem[] = [
  { id: "MMGS", label: "MMGS", description: "Millimetre, gram, second" },
  { id: "CGS", label: "CGS", description: "Centimetre, gram, second" },
  { id: "MKS", label: "MKS", description: "Metre, kilogram, second" },
  { id: "IPS", label: "IPS", description: "Inch, pound, second" },
];

const TABS = ["General", "Display", "Sketch", "File"] as const;
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
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const confirmBeforeDiscard = useSettingsStore((state) => state.confirmBeforeDiscard);
  const setConfirmBeforeDiscard = useSettingsStore((state) => state.setConfirmBeforeDiscard);
  const resetToDefaults = useSettingsStore((state) => state.resetToDefaults);

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
            { id: "dark", label: "Dark" },
          ]}
        />
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

function DisplayTab() {
  const projection = useViewportStore((state) => state.projection);
  const setProjection = useViewportStore((state) => state.setProjection);
  const linePickTolerance = useSettingsStore((state) => state.linePickTolerance);
  const setLinePickTolerance = useSettingsStore((state) => state.setLinePickTolerance);

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
          <h2 className={styles.title}>Application Options</h2>
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
              {tab}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          {activeTab === "General" && <GeneralTab />}
          {activeTab === "Display" && <DisplayTab />}
          {activeTab === "Sketch" && <SketchTab />}
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
