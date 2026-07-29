import type { RibbonGroup as RibbonGroupModel, RibbonItem } from "@/types/ui";

import { RibbonButton } from "./RibbonButton";
import styles from "./RibbonGroup.module.css";

interface RibbonGroupProps {
  group: RibbonGroupModel;
  onInvoke: (item: RibbonItem) => void;
}

const SMALL_ITEMS_PER_COLUMN = 3;

/** Splits the compact commands into fixed-height columns so the ribbon stays one row tall. */
function chunk<T>(items: T[], size: number): T[][] {
  const columns: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    columns.push(items.slice(index, index + size));
  }
  return columns;
}

export function RibbonGroup({ group, onInvoke }: RibbonGroupProps) {
  const largeItems = group.items.filter((item) => item.size === "large");
  const smallColumns = chunk(
    group.items.filter((item) => item.size === "small"),
    SMALL_ITEMS_PER_COLUMN,
  );

  return (
    <section className={styles.group} aria-label={group.label}>
      <div className={styles.items}>
        {largeItems.map((item) => (
          <RibbonButton key={item.id} item={item} onInvoke={onInvoke} />
        ))}

        {smallColumns.map((column) => (
          <div key={column[0].id} className={styles.smallColumn}>
            {column.map((item) => (
              <RibbonButton key={item.id} item={item} onInvoke={onInvoke} />
            ))}
          </div>
        ))}
      </div>

      <div className={styles.label}>{group.label}</div>
    </section>
  );
}
