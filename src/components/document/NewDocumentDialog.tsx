import { useEffect, useRef } from "react";
import { Box, Layers, PenTool, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { runNewDocument } from "@/commands/documentIO";
import { useDocumentStore } from "@/state/documentStore";

import styles from "./NewDocumentDialog.module.css";

interface DocumentTypeCard {
  id: "part" | "assembly" | "drawing";
  label: string;
  description: string;
  icon: LucideIcon;
  available: boolean;
}

const CARDS: DocumentTypeCard[] = [
  {
    id: "part",
    label: "Part",
    description: "A single 3D solid built from sketches and features.",
    icon: Box,
    available: true,
  },
  {
    id: "assembly",
    label: "Assembly",
    description: "Combine multiple parts with mates. Coming soon.",
    icon: Layers,
    available: false,
  },
  {
    id: "drawing",
    label: "Drawing",
    description: "2D views and dimensions of a part or assembly. Coming soon.",
    icon: PenTool,
    available: false,
  },
];

/**
 * "New Document" type picker, opened by the ribbon's New button and File ▸ New alike
 * (both dispatch the `doc.new` command, which just flips `documentStore.newDocumentDialogOpen`).
 *
 * Only Part is wired to anything: Assembly and Drawing are shown so the whole product
 * shape is visible from day one — matching how SolidWorks' own New dialog looks — but
 * stay disabled with a "Coming soon" description rather than silently doing nothing or
 * being hidden, since neither document type has a ribbon tab with real functionality yet.
 */
export function NewDocumentDialog() {
  const open = useDocumentStore((state) => state.newDocumentDialogOpen);
  const close = useDocumentStore((state) => state.closeNewDocumentDialog);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  if (!open) return null;

  const createPart = () => {
    runNewDocument();
    close();
  };

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (!dialogRef.current?.contains(event.target as Node)) close();
      }}
    >
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="New Document">
        <div className={styles.header}>
          <h2 className={styles.title}>New Document</h2>
          <button type="button" className={styles.closeButton} aria-label="Close" onClick={close}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className={styles.cards}>
          {CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.id}
                type="button"
                className={styles.card}
                disabled={!card.available}
                onClick={card.available ? createPart : undefined}
                onDoubleClick={card.available ? createPart : undefined}
              >
                <span className={styles.cardIcon} aria-hidden="true">
                  <Icon size={32} strokeWidth={1.5} />
                </span>
                <span className={styles.cardLabel}>{card.label}</span>
                <span className={styles.cardDescription}>{card.description}</span>
                {!card.available && <span className={styles.comingSoon}>Coming soon</span>}
              </button>
            );
          })}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.footerButton} onClick={close}>
            Cancel
          </button>
          <div className={styles.footerSpacer} />
          <button type="button" className={styles.primaryButton} onClick={createPart}>
            Create Part
          </button>
        </div>
      </div>
    </div>
  );
}
