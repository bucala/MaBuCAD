import { useEffect, useRef } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, Square, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { runPlaceModelView } from "@/commands/drawingCommands";
import { useTranslation } from "@/i18n/useTranslation";
import { useDrawingToolStore } from "@/state/drawingToolStore";
import type { StandardProjectionKind } from "@/types/document";

import styles from "./ModelViewOrientationDialog.module.css";

const ORIENTATIONS: { direction: StandardProjectionKind; key: string; label: string; icon: LucideIcon }[] = [
  { direction: "front", key: "drawing.orientation.front", label: "Front", icon: Square },
  { direction: "top", key: "drawing.orientation.top", label: "Top", icon: ArrowUp },
  { direction: "right", key: "drawing.orientation.right", label: "Right", icon: ArrowRight },
  { direction: "left", key: "drawing.orientation.left", label: "Left", icon: ArrowLeft },
  { direction: "bottom", key: "drawing.orientation.bottom", label: "Bottom", icon: ArrowDown },
  { direction: "back", key: "drawing.orientation.back", label: "Back", icon: Square },
  { direction: "iso", key: "drawing.orientation.iso", label: "Isometric", icon: Box },
];

/**
 * Insert Model View's orientation picker: every direction is already projected
 * (`drawingCommands.ts`'s `runInsertModelView` computed all seven before opening this), so
 * picking a card places exactly that one view — tagged internally as the drawing's own
 * "front" — instead of dropping a fixed default set of views the user never asked for.
 */
export function ModelViewOrientationDialog() {
  const picker = useDrawingToolStore((state) => state.modelViewPicker);
  const close = useDrawingToolStore((state) => state.closeModelViewPicker);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (!picker) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [picker, close]);

  if (!picker) return null;

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (!dialogRef.current?.contains(event.target as Node)) close();
      }}
    >
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="Choose Model View Orientation">
        <div className={styles.header}>
          <h2 className={styles.title}>{t("drawing.orientation-dialog.title", "Model View Orientation")}</h2>
          <button type="button" className={styles.closeButton} aria-label="Close" onClick={close}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
        <p className={styles.subtitle}>
          {t("drawing.orientation-dialog.subtitle", "Choose which direction becomes the drawing's main (front) view.")}
        </p>

        <div className={styles.cards}>
          {ORIENTATIONS.map((orientation) => {
            const Icon = orientation.icon;
            return (
              <button
                key={orientation.direction}
                type="button"
                className={styles.card}
                onClick={() => runPlaceModelView(orientation.direction)}
              >
                <span className={styles.cardIcon} aria-hidden="true">
                  <Icon size={28} strokeWidth={1.5} />
                </span>
                <span className={styles.cardLabel}>{t(orientation.key, orientation.label)}</span>
              </button>
            );
          })}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.footerButton} onClick={close}>
            {t("drawing.orientation-dialog.cancel", "Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
