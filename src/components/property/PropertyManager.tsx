import { SlidersHorizontal } from "lucide-react";

import styles from "./PropertyManager.module.css";

/**
 * Context-sensitive property panel.
 *
 * From Step 5 onwards the active command supplies its own form here — extrude depth and
 * end condition, fillet radius and edge selection, and so on. Without an active command
 * the panel shows its empty state.
 */
export function PropertyManager() {
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
          Start a tool from the ribbon, or select geometry in the viewport, and its options
          appear here.
        </p>
      </div>
    </div>
  );
}
