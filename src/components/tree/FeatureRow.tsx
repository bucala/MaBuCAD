import { useCallback, useState } from "react";
import { CircleAlert, EyeOff, Pencil, Trash2, Undo2 } from "lucide-react";

import { featureIcon } from "@/state/featureCatalog";
import type { Feature } from "@/types/document";

import styles from "./FeatureTree.module.css";

interface FeatureRowProps {
  feature: Feature;
  depth: number;
  isSelected: boolean;
  isRolledBack: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onToggleSuppressed: (id: string) => void;
  onRollbackToBefore: (id: string) => void;
  onEditSketch: (id: string) => void;
}

export function FeatureRow({
  feature,
  depth,
  isSelected,
  isRolledBack,
  onSelect,
  onRename,
  onDelete,
  onToggleSuppressed,
  onRollbackToBefore,
  onEditSketch,
}: FeatureRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(feature.name);

  const Icon = featureIcon(feature.kind);

  /**
   * Focus and select on mount via a callback ref rather than an effect: an effect runs
   * after the browser can already deliver keystrokes, so a fast typist (or an automated
   * test) loses the first characters when the late `select()` wipes them.
   */
  const focusOnMount = useCallback((node: HTMLInputElement | null) => {
    node?.focus();
    node?.select();
  }, []);

  const beginRename = () => {
    setDraftName(feature.name);
    setIsRenaming(true);
  };

  const commitRename = () => {
    setIsRenaming(false);
    onRename(feature.id, draftName);
  };

  return (
    <div
      className={styles.row}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isSelected}
      data-selected={isSelected}
      data-rolled-back={isRolledBack}
      data-suppressed={feature.suppressed}
      data-feature-id={feature.id}
      style={{ paddingLeft: `${depth * 14 + 6}px` }}
      // F2 renames, matching Windows list conventions.
      onKeyDown={(event) => {
        if (event.key === "F2" && !feature.isDefault) {
          event.preventDefault();
          beginRename();
        }
      }}
    >
      <span className={styles.chevronPlaceholder} />

      <span
        className={`${styles.icon} ${feature.isDefault ? styles.iconDefault : ""}`}
        aria-hidden="true"
      >
        <Icon size={14} strokeWidth={1.75} />
      </span>

      {isRenaming ? (
        <input
          ref={focusOnMount}
          className={styles.renameInput}
          value={draftName}
          aria-label={`Rename ${feature.name}`}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commitRename();
            } else if (event.key === "Escape") {
              setIsRenaming(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className={styles.rowInner}
          onClick={(event) => onSelect(feature.id, event.ctrlKey || event.metaKey)}
          onDoubleClick={() => {
            // A sketch is edited on double-click, matching SolidWorks; renaming it still
            // works via F2 or the pencil action. Without this, an exited sketch has no
            // way back in — it just looks deleted, since its geometry only renders while
            // it is the active sketch.
            if (feature.kind === "sketch") {
              onEditSketch(feature.id);
            } else if (!feature.isDefault) {
              beginRename();
            }
          }}
        >
          <span className={styles.label}>{feature.name}</span>
        </button>
      )}

      {feature.error && (
        <span className={styles.errorBadge} title={feature.error}>
          <CircleAlert size={13} />
        </span>
      )}

      {!isRenaming && !feature.isDefault && (
        <span className={styles.rowActions}>
          <button
            type="button"
            className={styles.rowAction}
            title="Rename (F2)"
            aria-label={`Rename ${feature.name}`}
            onClick={beginRename}
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            className={styles.rowAction}
            title={feature.suppressed ? "Unsuppress" : "Suppress"}
            aria-label={`${feature.suppressed ? "Unsuppress" : "Suppress"} ${feature.name}`}
            onClick={() => onToggleSuppressed(feature.id)}
          >
            <EyeOff size={12} />
          </button>
          <button
            type="button"
            className={styles.rowAction}
            title="Roll back to before this feature"
            aria-label={`Roll back to before ${feature.name}`}
            onClick={() => onRollbackToBefore(feature.id)}
          >
            <Undo2 size={12} />
          </button>
          <button
            type="button"
            className={styles.rowAction}
            title="Delete"
            aria-label={`Delete ${feature.name}`}
            onClick={() => onDelete(feature.id)}
          >
            <Trash2 size={12} />
          </button>
        </span>
      )}
    </div>
  );
}
