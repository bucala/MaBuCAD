import { openFile, saveBlob } from "@/io/files";
import { useGeometryStore } from "@/state/geometryStore";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/state/settingsStore";

/**
 * Export/import for app-wide preferences (`settingsStore.ts`) — separate from whole
 * document persistence (`documentIO.ts`): a `.mabucad` file is one document's parametric
 * history, this is the preferences that apply across every document, for backing them up
 * or carrying them to a different machine.
 */

const FORMAT_VERSION = 1;
const EXTENSION = "mabucad-settings";

interface SavedSettings {
  formatVersion: number;
  settings: typeof DEFAULT_SETTINGS;
}

function isSavedSettings(value: unknown): value is SavedSettings {
  return (
    typeof value === "object" &&
    value !== null &&
    "formatVersion" in value &&
    "settings" in value &&
    typeof (value as { settings: unknown }).settings === "object"
  );
}

export async function runExportSettings(): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const {
    theme,
    accentColor,
    confirmBeforeDiscard,
    snapTolerance,
    linePickTolerance,
    modelColor,
    modelEdgeColor,
    zoomToCursor,
    viewCubeVisible,
    originIndicatorVisible,
    axisLabelsVisible,
    language,
  } = useSettingsStore.getState();

  const payload: SavedSettings = {
    formatVersion: FORMAT_VERSION,
    settings: {
      theme,
      accentColor,
      confirmBeforeDiscard,
      snapTolerance,
      linePickTolerance,
      modelColor,
      modelEdgeColor,
      zoomToCursor,
      viewCubeVisible,
      originIndicatorVisible,
      axisLabelsVisible,
      language,
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });

  try {
    const saved = await saveBlob(blob, `mabucad-settings.${EXTENSION}`, [EXTENSION, "json"]);
    if (saved) showToast("Settings exported");
  } catch (error) {
    showToast(`Export failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}

export async function runImportSettings(): Promise<void> {
  const { showToast } = useGeometryStore.getState();

  try {
    const picked = await openFile([EXTENSION, "json"]);
    if (!picked) return;

    const parsed: unknown = JSON.parse(new TextDecoder().decode(picked.data));
    if (!isSavedSettings(parsed)) {
      throw new Error(`${picked.name} is not a MaBuCAD settings file`);
    }

    // Merged over the defaults rather than trusted outright: an older export missing a
    // field that's since been added should fall back to that field's default instead of
    // becoming `undefined` throughout the app.
    useSettingsStore.getState().replaceAll({ ...DEFAULT_SETTINGS, ...parsed.settings });
    showToast(`Imported ${picked.name}`);
  } catch (error) {
    showToast(`Import failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}
