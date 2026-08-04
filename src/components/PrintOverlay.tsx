import { useEffect, useRef } from "react";

import { useViewportStore } from "@/state/viewportStore";

import styles from "./PrintOverlay.module.css";

/**
 * Renders the viewport snapshot `PrintCapture.tsx` (inside the `Canvas`) captured on
 * "Print", then opens the browser's own print dialog on it — a plain DOM sibling of
 * `AppShell`, not a descendant, since printing has nothing to reach inside the r3f tree
 * for once the image is captured, and `AppShell.module.css`'s own print media query hides
 * the ordinary chrome (ribbon, panels, status bar) so only this layer is visible on paper.
 *
 * There's no "active drawing" sheet yet (see `NewDocumentDialog.tsx` — Assembly and
 * Drawing document types are still "Coming soon"), so this prints the 3D view as shown,
 * the same honest scope the ribbon button's own description states.
 */
export function PrintOverlay() {
  const snapshot = useViewportStore((state) => state.printSnapshot);
  const setPrintSnapshot = useViewportStore((state) => state.setPrintSnapshot);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!snapshot) return;

    const triggerPrint = () => window.print();
    const clear = () => setPrintSnapshot(null);

    // `afterprint` fires whether the user actually printed or cancelled the dialog —
    // either way, the overlay's job is done and the snapshot should not linger for the
    // next unrelated repaint to pick up.
    window.addEventListener("afterprint", clear);

    const img = imgRef.current;
    if (img?.complete) {
      triggerPrint();
    } else {
      img?.addEventListener("load", triggerPrint, { once: true });
    }

    return () => {
      window.removeEventListener("afterprint", clear);
      img?.removeEventListener("load", triggerPrint);
    };
  }, [snapshot, setPrintSnapshot]);

  if (!snapshot) return null;

  return (
    <div className={styles.printOverlay}>
      <img ref={imgRef} src={snapshot} alt="MaBuCAD viewport snapshot" className={styles.image} />
    </div>
  );
}
