import type { RibbonItem } from "@/types/ui";

import styles from "./RibbonButton.module.css";

interface RibbonButtonProps {
  item: RibbonItem;
  onInvoke: (item: RibbonItem) => void;
}

export function RibbonButton({ item, onInvoke }: RibbonButtonProps) {
  const { icon: Icon, label, size, description, enabled = true } = item;
  const isLarge = size === "large";

  return (
    <button
      type="button"
      className={`${styles.button} ${isLarge ? styles.large : styles.small}`}
      title={description ?? label}
      aria-label={label}
      disabled={!enabled}
      onClick={() => onInvoke(item)}
    >
      <span className={styles.icon} aria-hidden="true">
        <Icon size={isLarge ? 24 : 15} strokeWidth={isLarge ? 1.5 : 1.75} />
      </span>
      <span className={isLarge ? styles.largeLabel : styles.smallLabel}>{label}</span>
    </button>
  );
}
