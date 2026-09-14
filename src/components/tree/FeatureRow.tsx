import { memo, useCallback, useState } from "react";
import { CircleAlert, Eye, EyeOff, Pencil, Power, PowerOff, Trash2, Undo2 } from "lucide-react";

import { featureDisplayName } from "@/i18n/featureNames";
import { fillTemplate, useTranslation } from "@/i18n/useTranslation";
import { featureIcon } from "@/state/featureCatalog";
import type { Feature } from "@/types/document";

import styles from "./FeatureTree.module.css";

interface FeatureRowProps {
  feature: Feature;
  depth: number;
  isSelected: boolean;
  isRolledBack: boolean;
  isHidden: boolean;
  /** Number of other features that reference this one as input (a sketch consumed by
   * more than one extrude/revolve/etc, for example) — 0 for anything not reused. */
  usedByCount: number;
  onSelect: (id: string, additive: boolean) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onToggleSuppressed: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onRollbackToBefore: (id: string) => void;
  onEditSketch: (id: string) => void;
  /** Opens the feature for editing in the property panel — the non-sketch counterpart of
   * `onEditSketch`, so double-click means "edit this" for every row kind. */
  onEditFeature: (id: string) => void;
  onContextMenu: (clientX: number, clientY: number) => void;
}

/**
 * One feature row. Memoised: with all its callbacks stable (the tree passes store actions
 * straight through), a row only re-renders when the values it actually shows change — a
 * selection toggle or a hide/suppress click re-renders just that row instead of every row
 * in a large feature history.
 */
export const FeatureRow = memo(function FeatureRow({
  feature,
  depth,
  isSelected,
  isRolledBack,
  isHidden,
  usedByCount,
  onSelect,
  onRename,
  onDelete,
  onToggleSuppressed,
  onToggleVisibility,
  onRollbackToBefore,
  onEditSketch,
  onEditFeature,
  onContextMenu,
}: FeatureRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(feature.name);
  const { t } = useTranslation();

  const Icon = featureIcon(feature.kind);
  // The *stored* name is what a rename edits and what the document file keeps; this is only
  // what the row shows — see `featureDisplayName`'s own doc comment.
  const label = featureDisplayName(t, feature);

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
      data-hidden={isHidden}
      data-feature-id={feature.id}
      style={{ paddingLeft: `${depth * 14 + 6}px` }}
      // F2 renames, matching Windows list conventions.
      onKeyDown={(event) => {
        if (event.key === "F2" && !feature.isDefault) {
          event.preventDefault();
          beginRename();
        }
      }}
      // Right-clicking a row that isn't already selected selects it first — otherwise a
      // right-click while a *different* row is selected would open a menu acting on the
      // wrong feature, since the menu itself just reads the current selection.
      onContextMenu={(event) => {
        event.preventDefault();
        if (!isSelected) onSelect(feature.id, false);
        onContextMenu(event.clientX, event.clientY);
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
          aria-label={fillTemplate(t("tree.renameAria", "Rename {{name}}"), { name: label })}
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
          title={
            feature.kind === "sketch"
              ? t(
                  "tree.sketchRowHint",
                  "Select, then run a Feature command to use this sketch as its input — the same sketch can feed more than one feature",
                )
              : undefined
          }
          onClick={(event) => onSelect(feature.id, event.ctrlKey || event.metaKey)}
          onDoubleClick={() => {
            // Double-click means "edit this" for every row, matching SolidWorks/Fusion:
            // a sketch reopens in the sketcher, anything else opens its properties ready
            // to change (which is also where OK/Cancel live — see `FeatureActionBar`).
            // Renaming stays a deliberate separate gesture, F2 or the pencil button.
            if (feature.kind === "sketch") {
              onEditSketch(feature.id);
            } else if (!feature.isDefault) {
              onEditFeature(feature.id);
            }
          }}
        >
          <span className={styles.label}>{label}</span>
        </button>
      )}

      {feature.error && (
        <span className={styles.errorBadge} title={feature.error}>
          <CircleAlert size={13} />
        </span>
      )}

      {usedByCount > 0 && (
        <span
          className={styles.usageBadge}
          title={fillTemplate(
            usedByCount === 1
              ? t("tree.usedByOne", "Used as input by {{count}} feature")
              : t("tree.usedByMany", "Used as input by {{count}} features"),
            { count: usedByCount },
          )}
        >
          {usedByCount}
        </span>
      )}

      {!isRenaming && (
        <span className={styles.rowActions}>
          {/* Available on every row, including default reference geometry — a plane or
              the origin has nothing to rename/suppress/roll back/delete, but hiding it
              individually (rather than only all-at-once) is exactly what's missing
              without this. */}
          <button
            type="button"
            className={styles.rowAction}
            title={isHidden ? t("tree.show", "Show") : t("tree.hide", "Hide")}
            aria-label={`${isHidden ? t("tree.show", "Show") : t("tree.hide", "Hide")} ${label}`}
            onClick={() => onToggleVisibility(feature.id)}
          >
            {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>

          {!feature.isDefault && (
            <>
              <button
                type="button"
                className={styles.rowAction}
                title={t("tree.rename", "Rename (F2)")}
                aria-label={fillTemplate(t("tree.renameAria", "Rename {{name}}"), { name: label })}
                onClick={beginRename}
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                className={styles.rowAction}
                title={
                  feature.suppressed
                    ? t("feature.unsuppress", "Unsuppress")
                    : t("feature.suppress", "Suppress")
                }
                aria-label={`${
                  feature.suppressed
                    ? t("feature.unsuppress", "Unsuppress")
                    : t("feature.suppress", "Suppress")
                } ${label}`}
                onClick={() => onToggleSuppressed(feature.id)}
              >
                {feature.suppressed ? <Power size={12} /> : <PowerOff size={12} />}
              </button>
              <button
                type="button"
                className={styles.rowAction}
                title={t("tree.rollbackToBefore", "Roll back to before this feature")}
                aria-label={fillTemplate(t("tree.rollbackToBeforeAria", "Roll back to before {{name}}"), {
                  name: label,
                })}
                onClick={() => onRollbackToBefore(feature.id)}
              >
                <Undo2 size={12} />
              </button>
              <button
                type="button"
                className={styles.rowAction}
                title={t("feature.delete", "Delete")}
                aria-label={fillTemplate(t("tree.deleteAria", "Delete {{name}}"), { name: label })}
                onClick={() => onDelete(feature.id)}
              >
                <Trash2 size={12} />
              </button>
            </>
          )}
        </span>
      )}
    </div>
  );
});
