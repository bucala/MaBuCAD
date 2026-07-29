import { SlidersHorizontal, Trash2 } from "lucide-react";

import { FEATURE_CATALOG } from "@/state/featureCatalog";
import { useDocumentStore } from "@/state/documentStore";
import type { FeatureParameters } from "@/types/document";

import styles from "./PropertyManager.module.css";

/** Display metadata for the parameters a feature can carry. */
const PARAMETER_FIELDS: {
  key: keyof FeatureParameters;
  label: string;
  unit?: string;
  step?: number;
}[] = [
  { key: "depth", label: "Depth", unit: "mm", step: 1 },
  { key: "radius", label: "Radius", unit: "mm", step: 0.5 },
  { key: "distance", label: "Distance", unit: "mm", step: 1 },
  { key: "thickness", label: "Thickness", unit: "mm", step: 0.5 },
  { key: "angle", label: "Angle", unit: "°", step: 1 },
  { key: "count", label: "Instances", step: 1 },
];

/**
 * Context-sensitive property panel.
 *
 * Shows the selected feature's name and parameters. Editing a value writes straight
 * through to the document store; once the geometry kernel lands in Step 5 the same edit
 * also triggers a rebuild.
 */
export function PropertyManager() {
  const document = useDocumentStore((state) => state.document);
  const selectedFeatureIds = useDocumentStore((state) => state.selectedFeatureIds);
  const renameFeature = useDocumentStore((state) => state.renameFeature);
  const updateParameters = useDocumentStore((state) => state.updateParameters);
  const toggleSuppressed = useDocumentStore((state) => state.toggleSuppressed);
  const deleteFeature = useDocumentStore((state) => state.deleteFeature);

  const feature = document.features.find((candidate) =>
    selectedFeatureIds.includes(candidate.id),
  );

  if (!feature) {
    return (
      <div className={styles.manager}>
        <div className={styles.header}>
          <h2 className={styles.title}>Properties</h2>
        </div>

        <div className={styles.emptyState}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <SlidersHorizontal size={22} strokeWidth={1.5} />
          </span>
          <div className={styles.emptyTitle}>No active command</div>
          <p className={styles.emptyBody}>
            Start a tool from the ribbon, or select a feature in the tree, and its options
            appear here.
          </p>
        </div>
      </div>
    );
  }

  const definition = FEATURE_CATALOG[feature.kind];
  const fields = PARAMETER_FIELDS.filter((field) => feature.parameters[field.key] !== undefined);

  return (
    <div className={styles.manager}>
      <div className={styles.header}>
        <h2 className={styles.title}>{feature.name}</h2>
      </div>

      <div className={styles.body}>
        <p className={styles.kindDescription}>{definition.description}</p>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Name</span>
          <input
            className={styles.input}
            value={feature.name}
            disabled={feature.isDefault}
            onChange={(event) => renameFeature(feature.id, event.target.value)}
          />
        </label>

        {feature.parameters.endCondition !== undefined && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>End condition</span>
            <select
              className={styles.input}
              value={feature.parameters.endCondition}
              onChange={(event) =>
                updateParameters(feature.id, {
                  endCondition: event.target.value as FeatureParameters["endCondition"],
                })
              }
            >
              <option value="blind">Blind</option>
              <option value="through-all">Through All</option>
              <option value="mid-plane">Mid Plane</option>
              <option value="up-to-surface">Up To Surface</option>
            </select>
          </label>
        )}

        {fields.map((field) => (
          <label key={field.key} className={styles.field}>
            <span className={styles.fieldLabel}>
              {field.label}
              {field.unit ? ` (${field.unit})` : ""}
            </span>
            <input
              className={styles.input}
              type="number"
              step={field.step}
              value={String(feature.parameters[field.key] ?? "")}
              onChange={(event) =>
                updateParameters(feature.id, { [field.key]: Number(event.target.value) })
              }
            />
          </label>
        ))}

        {!feature.isDefault && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.actionButton}
              aria-pressed={feature.suppressed}
              onClick={() => toggleSuppressed(feature.id)}
            >
              {feature.suppressed ? "Unsuppress" : "Suppress"}
            </button>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.danger}`}
              onClick={() => deleteFeature(feature.id)}
            >
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
