import { Eye, Grid3x3, Magnet } from "lucide-react";

import { useAppInfo } from "@/hooks/useAppInfo";
import { useTranslation } from "@/i18n/useTranslation";
import { useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";
import { useSettingsStore } from "@/state/settingsStore";
import { selectSketchStatus, useSketchStore } from "@/state/sketchStore";
import type { DisplayMode } from "@/state/viewportStore";
import { useViewportStore } from "@/state/viewportStore";
import type { SketchStatus } from "@/types/ui";

import styles from "./StatusBar.module.css";

const SKETCH_STATUS_LABEL: Record<SketchStatus, string> = {
  "fully-defined": "Fully Defined",
  "under-defined": "Under Defined",
  "over-defined": "Over Defined",
  "no-sketch": "No active sketch",
};

const SKETCH_STATUS_KEY: Record<SketchStatus, string> = {
  "fully-defined": "status.fully-defined",
  "under-defined": "status.under-defined",
  "over-defined": "status.over-defined",
  "no-sketch": "status.no-sketch",
};

const SKETCH_STATUS_CLASS: Record<SketchStatus, string> = {
  "fully-defined": styles.statusFullyDefined,
  "under-defined": styles.statusUnderDefined,
  "over-defined": styles.statusOverDefined,
  "no-sketch": styles.statusNoSketch,
};

const DISPLAY_MODE_LABEL: Record<DisplayMode, string> = {
  shaded: "Shaded",
  "shaded-edges": "Shaded with Edges",
  wireframe: "Wireframe",
};

/**
 * Bottom status bar: sketch constraint state, viewport display toggles and build info.
 *
 * The sketch status is fixed at "no active sketch" until the sketcher lands in Step 4.
 * The unit system selector used to live here; it's now in the Settings panel
 * (`MenuBar.tsx`) alongside the other app-wide display options. The cursor coordinate
 * readout that used to sit here was never wired to a live cursor position — it always
 * read "X 0.00 Y 0.00 Z 0.00" — so it's replaced with two toggles that actually do
 * something: cycling the Visual Style and showing/hiding the ground grid.
 */
export function StatusBar() {
  const appInfo = useAppInfo();
  const sketchStatus = useSketchStore(selectSketchStatus);
  const dof = useSketchStore((state) => state.diagnostics.dof);
  const isSketchMode = useSketchStore((state) => state.activeSketchId !== null);
  const featureCount = useDocumentStore(
    (state) => state.document.features.filter((feature) => !feature.isDefault).length,
  );
  const geometryStatus = useGeometryStore((state) => state.status);
  const geometryMessage = useGeometryStore((state) => state.message);
  const toast = useGeometryStore((state) => state.toast);
  const displayMode = useViewportStore((state) => state.displayMode);
  const cycleDisplayMode = useViewportStore((state) => state.cycleDisplayMode);
  const gridVisible = useViewportStore((state) => state.gridVisible);
  const toggleGridVisible = useViewportStore((state) => state.toggleGridVisible);
  const snapToGridEnabled = useViewportStore((state) => state.snapToGridEnabled);
  const toggleSnapToGrid = useViewportStore((state) => state.toggleSnapToGrid);
  const versionVisible = useSettingsStore((state) => state.versionVisible);
  const { t } = useTranslation();

  return (
    <footer className={styles.statusbar}>
      <div
        className={`${styles.statusChip} ${SKETCH_STATUS_CLASS[sketchStatus]}`}
        data-testid="sketch-status"
      >
        <span className={styles.statusDot} aria-hidden="true" />
        {t(SKETCH_STATUS_KEY[sketchStatus], SKETCH_STATUS_LABEL[sketchStatus])}
      </div>

      {isSketchMode && (
        <>
          <div className={styles.divider} aria-hidden="true" />
          <div className={styles.item}>
            {dof} {t("status.dof", "DOF")}
          </div>
        </>
      )}

      <div className={styles.divider} aria-hidden="true" />

      <button
        type="button"
        className={styles.iconButton}
        title={`Visual Style: ${DISPLAY_MODE_LABEL[displayMode]} (click to cycle)`}
        aria-label={`Visual style: ${DISPLAY_MODE_LABEL[displayMode]}`}
        onClick={cycleDisplayMode}
      >
        <Eye size={13} strokeWidth={1.75} />
      </button>

      <button
        type="button"
        className={styles.iconButton}
        aria-pressed={gridVisible}
        title={gridVisible ? "Hide grid" : "Show grid"}
        aria-label={gridVisible ? "Hide grid" : "Show grid"}
        onClick={toggleGridVisible}
      >
        <Grid3x3 size={13} strokeWidth={1.75} />
      </button>

      {isSketchMode && (
        <button
          type="button"
          className={styles.iconButton}
          aria-pressed={snapToGridEnabled}
          title={snapToGridEnabled ? "Snap to grid: on" : "Snap to grid: off"}
          aria-label={snapToGridEnabled ? "Snap to grid: on" : "Snap to grid: off"}
          onClick={toggleSnapToGrid}
        >
          <Magnet size={13} strokeWidth={1.75} />
        </button>
      )}

      {(toast || geometryStatus !== "empty" || geometryMessage) && (
        <>
          <div className={styles.divider} aria-hidden="true" />
          <div className={styles.item} data-testid="geometry-status">
            {toast ??
              geometryMessage ??
              (geometryStatus === "building"
                ? "Rebuilding…"
                : geometryStatus === "error"
                  ? "Rebuild failed"
                  : "Model up to date")}
          </div>
        </>
      )}

      <div className={styles.spacer} />

      <div className={styles.item}>
        {featureCount} {t(featureCount === 1 ? "status.feature-one" : "status.feature-many", featureCount === 1 ? "feature" : "features")}
      </div>

      <div className={styles.divider} aria-hidden="true" />

      <div className={styles.item}>{t("status.editing-part", "Editing Part")}</div>

      {versionVisible && (
        <>
          <div className={styles.divider} aria-hidden="true" />

          <div className={styles.version} title={appInfo ? `Tauri ${appInfo.tauriVersion}` : undefined}>
            {appInfo ? `v${appInfo.version}` : "v— (browser preview)"}
          </div>
        </>
      )}
    </footer>
  );
}
