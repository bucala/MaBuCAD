import { useEffect } from "react";

import { writeAutosaveSnapshot } from "@/commands/documentIO";
import { useDocumentStore } from "@/state/documentStore";
import { useSettingsStore } from "@/state/settingsStore";

/** How often a snapshot is written while autosave is on. */
const AUTOSAVE_INTERVAL_MS = 60_000;

/**
 * Runs the autosave timer for the lifetime of the app, mounted once from `App.tsx`.
 *
 * Only ticks while Settings ▸ General ▸ Autosave is on, and only actually writes a
 * snapshot when there is something to protect (`past.length > 0` — an undo history entry
 * means an edit happened since the document was last loaded or saved); a document with
 * nothing to undo is already exactly what a fresh Open would reproduce, so autosaving it
 * would just be a wasted `localStorage` write on every tick.
 */
export function useAutosave(): void {
  const autosaveEnabled = useSettingsStore((state) => state.autosaveEnabled);

  useEffect(() => {
    if (!autosaveEnabled) return;

    const interval = window.setInterval(() => {
      if (useDocumentStore.getState().past.length > 0) {
        writeAutosaveSnapshot();
      }
    }, AUTOSAVE_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [autosaveEnabled]);
}
