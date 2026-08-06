import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, Square, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { runPlaceModelView } from "@/commands/drawingCommands";
import { useDrawingToolStore } from "@/state/drawingToolStore";
import type { StandardProjectionKind } from "@/types/document";

import styles from "./ModelViewOrientationDialog.module.css";

const ORIENTATIONS: { direction: StandardProjectionKind; label: string; icon: LucideIcon }[] = [
  { direction: "front", label: "Front", icon: Square },
  { direction: "top", label: "Top", icon: ArrowUp },
  { direction: "right", label: "Right", icon: ArrowRight },
  { direction: "left", label: "Left", icon: ArrowLeft },
  { direction: "bottom", label: "Bottom", icon: ArrowDown },
  { direction: "back", label: "Back", icon: Square },
  { direction: "iso", label: "Isometric", icon: Box },
];

/**
 * Insert Model View's own orientation picker — opened once a Part file has been read and
 * projected (`drawingCommands.ts`'s `runInsertModelView`), closed by `runPlaceModelView`
 * once a direction is actually chosen. Placing every standard view (Iso included) the
 * instant a file was picked, the way this command originally worked, second-guessed a
 * choice the user hasn't made yet — which face is the drawing's own Front is a real
 * decision, and every other standard view added afterward (via Projected View) associates
 * against whichever one gets picked here.
 */
export function ModelViewOrientationDialog() {
  const picker = useDrawingToolStore((state) => state.modelViewPicker);
  const close = useDrawingToolStore((state) => state.closeModelViewPicker);

  if (!picker) return null;

  return (
    <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Choose Model View Orientation">
        <div className={styles.header}>
          <h2 className={styles.title}>Model View Orientation</h2>
          <button type="button" className={styles.closeButton} aria-label="Close" onClick={close}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
        <p className={styles.subtitle}>
          Choose which direction of {picker.fileName} becomes this drawing&apos;s own Front view. Every other
          standard view added later (Projected View) is derived from it.
        </p>

        <div className={styles.cards}>
          {ORIENTATIONS.map(({ direction, label, icon: Icon }) => (
            <button
              key={direction}
              type="button"
              className={styles.card}
              onClick={() => runPlaceModelView(direction)}
            >
              <span className={styles.cardIcon} aria-hidden="true">
                <Icon size={24} strokeWidth={1.5} />
              </span>
              <span className={styles.cardLabel}>{label}</span>
            </button>
          ))}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.footerButton} onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
