import {
  ArrowUp,
  ArrowUpDown,
  ArrowUpToLine,
  Boxes,
  CircleDot,
  Combine,
  FlipVertical,
  Layers,
  Slice,
  SlidersHorizontal,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { FEATURE_CATALOG } from "@/state/featureCatalog";
import { useDocumentStore } from "@/state/documentStore";
import type { EndCondition, FeatureParameters } from "@/types/document";

import styles from "./PropertyManager.module.css";

const END_CONDITIONS: { id: EndCondition; label: string; icon: LucideIcon }[] = [
  { id: "blind", label: "Blind", icon: ArrowUp },
  { id: "through-all", label: "Through All", icon: ArrowUpToLine },
  { id: "mid-plane", label: "Mid Plane (symmetric)", icon: ArrowUpDown },
  { id: "up-to-surface", label: "Up To Surface", icon: Layers },
];

const OPERATIONS: {
  id: NonNullable<FeatureParameters["operation"]>;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "join", label: "Join — add this to the existing body", icon: Combine },
  { id: "cut", label: "Cut — remove this from the existing body", icon: Slice },
  { id: "intersect", label: "Intersect — keep only the overlap", icon: CircleDot },
];

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
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Direction</span>
            <div className={styles.iconRow} role="group" aria-label="End condition">
              {END_CONDITIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={styles.iconButton}
                  title={label}
                  aria-label={label}
                  aria-pressed={feature.parameters.endCondition === id}
                  onClick={() => updateParameters(feature.id, { endCondition: id })}
                >
                  <Icon size={15} strokeWidth={1.75} />
                </button>
              ))}
            </div>

            {feature.parameters.reversed !== undefined && (
              <button
                type="button"
                className={styles.actionButton}
                title="Reverse direction"
                aria-pressed={feature.parameters.reversed}
                onClick={() =>
                  updateParameters(feature.id, { reversed: !feature.parameters.reversed })
                }
              >
                <FlipVertical size={14} strokeWidth={1.75} />
                Reverse direction
              </button>
            )}
          </div>
        )}

        {feature.parameters.operation !== undefined && (
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Body</span>
            <div className={styles.iconRow} role="group" aria-label="Boolean operation">
              {OPERATIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={styles.iconButton}
                  title={label}
                  aria-label={label}
                  aria-pressed={feature.parameters.operation === id}
                  onClick={() => updateParameters(feature.id, { operation: id })}
                >
                  <Icon size={15} strokeWidth={1.75} />
                </button>
              ))}
              <button
                type="button"
                className={styles.iconButton}
                title="New Body — not available yet: the kernel keeps one combined body per document"
                aria-label="New Body (unavailable)"
                disabled
              >
                <Boxes size={15} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        )}

        {feature.parameters.axis !== undefined && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              {feature.kind === "mirror" ? "Mirror plane" : "Direction"}
            </span>
            <select
              className={styles.input}
              value={feature.parameters.axis}
              onChange={(event) =>
                updateParameters(feature.id, {
                  axis: event.target.value as FeatureParameters["axis"],
                })
              }
            >
              <option value="x">X</option>
              <option value="y">Y</option>
              <option value="z">Z</option>
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
