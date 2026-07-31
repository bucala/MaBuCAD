import { useAppInfo } from "@/hooks/useAppInfo";
import { useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";
import { selectSketchStatus, useSketchStore } from "@/state/sketchStore";
import type { SketchStatus } from "@/types/ui";

import styles from "./StatusBar.module.css";

const SKETCH_STATUS_LABEL: Record<SketchStatus, string> = {
  "fully-defined": "Fully Defined",
  "under-defined": "Under Defined",
  "over-defined": "Over Defined",
  "no-sketch": "No active sketch",
};

const SKETCH_STATUS_CLASS: Record<SketchStatus, string> = {
  "fully-defined": styles.statusFullyDefined,
  "under-defined": styles.statusUnderDefined,
  "over-defined": styles.statusOverDefined,
  "no-sketch": styles.statusNoSketch,
};

/**
 * Bottom status bar: sketch constraint state, cursor readout and build info.
 *
 * The sketch status is fixed at "no active sketch" until the sketcher lands in Step 4.
 * The unit system selector used to live here; it's now in the Settings panel
 * (`MenuBar.tsx`) alongside the other app-wide display options.
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

  return (
    <footer className={styles.statusbar}>
      <div
        className={`${styles.statusChip} ${SKETCH_STATUS_CLASS[sketchStatus]}`}
        data-testid="sketch-status"
      >
        <span className={styles.statusDot} aria-hidden="true" />
        {SKETCH_STATUS_LABEL[sketchStatus]}
      </div>

      {isSketchMode && (
        <>
          <div className={styles.divider} aria-hidden="true" />
          <div className={styles.item}>
            {dof} {dof === 1 ? "DOF" : "DOF"}
          </div>
        </>
      )}

      <div className={styles.divider} aria-hidden="true" />

      <div className={`${styles.item} ${styles.coordinates}`} title="Cursor position">
        X 0.00 &nbsp; Y 0.00 &nbsp; Z 0.00
      </div>

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
        {featureCount} {featureCount === 1 ? "feature" : "features"}
      </div>

      <div className={styles.divider} aria-hidden="true" />

      <div className={styles.item}>Editing Part</div>

      <div className={styles.divider} aria-hidden="true" />

      <div className={styles.version} title={appInfo ? `Tauri ${appInfo.tauriVersion}` : undefined}>
        {appInfo ? `v${appInfo.version}` : "v— (browser preview)"}
      </div>
    </footer>
  );
}
