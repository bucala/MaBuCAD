import { useTranslation } from "@/i18n/useTranslation";
import type { RibbonItem } from "@/types/ui";

import styles from "./RibbonButton.module.css";

interface RibbonButtonProps {
  item: RibbonItem;
  onInvoke: (item: RibbonItem) => void;
}

export function RibbonButton({ item, onInvoke }: RibbonButtonProps) {
  const { icon: Icon, label: englishLabel, size, description, enabled = true } = item;
  const isLarge = size === "large";
  const { t } = useTranslation();
  // The command's own `id` doubles as its translation key — see `translations.ts`'s doc
  // comment on why that needed no new keys invented for the whole ribbon. The hover
  // tooltip follows the same scheme with a `.description` suffix; when a command has no
  // description at all the tooltip falls back to the (translated) label itself.
  const label = t(item.id, englishLabel);
  const tooltip = description ? t(`${item.id}.description`, description) : label;

  return (
    <button
      type="button"
      className={`${styles.button} ${isLarge ? styles.large : styles.small}`}
      title={tooltip}
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
