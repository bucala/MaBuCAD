import { useAppInfo } from "@/hooks/useAppInfo";
import { useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";
import { selectSketchStatus, useSketchStore } from "@/state/sketchStore";
import type { SketchStatus, UnitSystem } from "@/types/ui";

import styles from "./StatusBar.module.css";

const UNIT_SYSTEMS: UnitSystem[] = [
  { id: "MMGS", label: "MMGS", description: "Millimetre, gram, second" },
  { id: "CGS", label: "CGS", description: "Centimetre, gram, second" },
  { id: "MKS", label: "MKS", description: "Metre, kilogram, second" },
  { id: "IPS", label: "IPS", description: "Inch, pound, second" },
];

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
 * Bottom status bar: sketch constraint state, cursor readout, unit system and build info.
 *
 * The sketch status is fixed at "no active sketch" until the sketcher lands in Step 4;
 * the unit selector is already live because it is pure UI state.
 */
export function StatusBar() {
  const appInfo = useAppInfo();
  const unitSystem = useDocumentStore((state) => state.unitSystem);
  const setUnitSystem = useDocumentStore((state) => state.setUnitSystem);
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

      <div
        className={styles.units}
        role="group"
        aria-label="Unit system"
        title="Unit and dimension system"
      >
        {UNIT_SYSTEMS.map((system) => (
          <button
            key={system.id}
            type="button"
            className={styles.unitButton}
            aria-pressed={unitSystem === system.id}
            title={system.description}
            onClick={() => setUnitSystem(system.id)}
          >
            {system.label}
          </button>
        ))}
      </div>

      <div className={styles.divider} aria-hidden="true" />

      <div className={styles.version} title={appInfo ? `Tauri ${appInfo.tauriVersion}` : undefined}>
        {appInfo ? `v${appInfo.version}` : "v— (browser preview)"}
      </div>
    </footer>
  );
}
