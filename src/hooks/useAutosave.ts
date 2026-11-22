import { useEffect } from "react";

import { writeAutosaveSnapshots } from "@/commands/documentIO";
import { useSettingsStore } from "@/state/settingsStore";

const AUTOSAVE_INTERVAL_MS = 60_000;

export function useAutosave(): void {
  const autosaveEnabled = useSettingsStore((state) => state.autosaveEnabled);

  useEffect(() => {
    if (!autosaveEnabled) return;
    const interval = window.setInterval(writeAutosaveSnapshots, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [autosaveEnabled]);
}
