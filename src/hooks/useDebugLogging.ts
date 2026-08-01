import { useEffect } from "react";

import { installDebugLogging, logDebug, uninstallDebugLogging } from "@/debug/logger";
import { useGeometryStore } from "@/state/geometryStore";
import { useSettingsStore } from "@/state/settingsStore";

/**
 * Wires Settings ▸ General's Debug Mode toggle to `debug/logger.ts`, and — while it's on
 * — logs geometry rebuild failures, the one high-value event that already exists as
 * store state (`geometryStore.errors`/`message`) rather than needing new instrumentation
 * scattered through the rebuild pipeline.
 */
export function useDebugLogging() {
  const debugModeEnabled = useSettingsStore((state) => state.debugModeEnabled);

  useEffect(() => {
    if (debugModeEnabled) installDebugLogging();
    else uninstallDebugLogging();
  }, [debugModeEnabled]);

  const status = useGeometryStore((state) => state.status);
  const message = useGeometryStore((state) => state.message);
  const errors = useGeometryStore((state) => state.errors);

  useEffect(() => {
    if (!debugModeEnabled) return;
    if (status === "error") {
      logDebug("rebuild", message ?? "Geometry rebuild failed");
    }
    if (Object.keys(errors).length > 0) {
      logDebug("rebuild", "Feature rebuild errors", errors);
    }
    // Only fires on a genuine status/errors change, not on every render — `debugModeEnabled`
    // itself is in the dependency list purely so turning it on captures the *current*
    // failure state rather than waiting for the next one.
  }, [debugModeEnabled, status, message, errors]);
}
