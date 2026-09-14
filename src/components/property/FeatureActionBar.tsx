import { Check, Power, PowerOff, Trash2, X } from "lucide-react";

import { useTranslation } from "@/i18n/useTranslation";
import { useDocumentStore } from "@/state/documentStore";
import { useViewportStore } from "@/state/viewportStore";
import type { Feature } from "@/types/document";

import styles from "./PropertyManager.module.css";

/**
 * The one place a feature is confirmed, cancelled, suppressed or deleted.
 *
 * Before this, each of those meant something different depending on where you did it: a
 * feature was created straight into the document with no way to back out, every keystroke
 * in the property panel was its own undo step, "Done Selecting" ended edge picking but
 * confirmed nothing, and Suppress/Delete existed three times over with three different
 * icons. This component is the single implementation, shared by feature *creation* and
 * feature *editing* — both are the same `documentStore.featureEdit` session — so OK, Cancel
 * and Suppress behave identically for every feature kind on every surface. The tree row
 * actions and the right-click menu now use the same icons and the same store actions, and
 * `PropertyManager` renders this bar for anything editable.
 *
 * `onBeforeEnd` lets the panel drop transient UI state that only makes sense inside a
 * session (edge-pick mode) before the session ends either way.
 */
export function FeatureActionBar({
  feature,
  onBeforeEnd,
}: {
  feature: Feature;
  onBeforeEnd?: () => void;
}) {
  const { t } = useTranslation();
  const featureEdit = useDocumentStore((state) => state.featureEdit);
  const endFeatureEdit = useDocumentStore((state) => state.endFeatureEdit);
  const toggleSuppressed = useDocumentStore((state) => state.toggleSuppressed);
  const deleteFeature = useDocumentStore((state) => state.deleteFeature);
  const setEdgePickMode = useViewportStore((state) => state.setEdgePickMode);
  const setHolePlacementActive = useViewportStore((state) => state.setHolePlacementActive);

  const isEditing = featureEdit?.featureId === feature.id;

  const end = (outcome: "commit" | "cancel") => {
    onBeforeEnd?.();
    setEdgePickMode(null);
    setHolePlacementActive(false);
    endFeatureEdit(outcome);
  };

  return (
    <div className={styles.actions} role="group" aria-label={t("feature.actionsAria", "Feature actions")}>
      <button
        type="button"
        className={`${styles.actionButton} ${styles.primary}`}
        title={t("feature.okTitle", "Confirm feature (Enter)")}
        disabled={!isEditing}
        onClick={() => end("commit")}
      >
        <Check size={13} />
        {t("feature.ok", "OK")}
      </button>

      <button
        type="button"
        className={styles.actionButton}
        title={t("feature.cancelTitle", "Discard changes (Esc)")}
        disabled={!isEditing}
        onClick={() => end("cancel")}
      >
        <X size={13} />
        {t("feature.cancel", "Cancel")}
      </button>

      <button
        type="button"
        className={styles.actionButton}
        aria-pressed={feature.suppressed}
        title={feature.suppressed ? t("feature.unsuppress", "Unsuppress") : t("feature.suppress", "Suppress")}
        onClick={() => toggleSuppressed(feature.id)}
      >
        {feature.suppressed ? <Power size={13} /> : <PowerOff size={13} />}
        {feature.suppressed ? t("feature.unsuppress", "Unsuppress") : t("feature.suppress", "Suppress")}
      </button>

      <button
        type="button"
        className={`${styles.actionButton} ${styles.danger}`}
        title={t("feature.delete", "Delete")}
        onClick={() => {
          onBeforeEnd?.();
          setEdgePickMode(null);
          setHolePlacementActive(false);
          deleteFeature(feature.id);
        }}
      >
        <Trash2 size={13} />
        {t("feature.delete", "Delete")}
      </button>
    </div>
  );
}
