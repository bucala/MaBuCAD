import { useState } from "react";

import { useAppInfo } from "@/hooks/useAppInfo";
import type { SketchStatus, UnitSystem, UnitSystemId } from "@/types/ui";

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
  const [unitSystem, setUnitSystem] = useState<UnitSystemId>("MMGS");
  const appInfo = useAppInfo();

  const sketchStatus: SketchStatus = "no-sketch";

  return (
    <footer className={styles.statusbar}>
      <div className={`${styles.statusChip} ${SKETCH_STATUS_CLASS[sketchStatus]}`}>
        <span className={styles.statusDot} aria-hidden="true" />
        {SKETCH_STATUS_LABEL[sketchStatus]}
      </div>

      <div className={styles.divider} aria-hidden="true" />

      <div className={`${styles.item} ${styles.coordinates}`} title="Cursor position">
        X 0.00 &nbsp; Y 0.00 &nbsp; Z 0.00
      </div>

      <div className={styles.spacer} />

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
