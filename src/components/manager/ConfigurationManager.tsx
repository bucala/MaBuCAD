import { Settings2 } from "lucide-react";

import styles from "@/components/property/PropertyManager.module.css";

/** Placeholder for part and assembly configurations (design variants). */
export function ConfigurationManager() {
  return (
    <div className={styles.manager}>
      <div className={styles.header}>
        <h2 className={styles.title}>Configurations</h2>
      </div>

      <div className={styles.emptyState}>
        <span className={styles.emptyIcon} aria-hidden="true">
          <Settings2 size={22} strokeWidth={1.5} />
        </span>
        <div className={styles.emptyTitle}>Default only</div>
        <p className={styles.emptyBody}>
          Configurations capture dimension and feature-suppression variants of one document.
          They become available once the parametric model is in place.
        </p>
      </div>
    </div>
  );
}
