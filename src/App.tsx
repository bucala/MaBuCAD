import { useEffect } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { PrintOverlay } from "@/components/PrintOverlay";
import { useAutosave } from "@/hooks/useAutosave";
import { useDebugLogging } from "@/hooks/useDebugLogging";
import { useDisableNativeContextMenu } from "@/hooks/useDisableNativeContextMenu";
import { useDragDropImport } from "@/hooks/useDragDropImport";
import { useEscapeToDeselect } from "@/hooks/useEscapeToDeselect";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useRebuild } from "@/hooks/useRebuild";
import { useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";
import { useSettingsStore } from "@/state/settingsStore";

export default function App() {
  useRebuild();
  useEscapeToDeselect();
  useKeyboardShortcuts();
  useDisableNativeContextMenu();
  useAutosave();
  useDebugLogging();
  useDragDropImport();

  // Rebuild failures belong on the feature that caused them, so the tree can badge it.
  const errors = useGeometryStore((state) => state.errors);
  const setFeatureErrors = useDocumentStore((state) => state.setFeatureErrors);

  useEffect(() => {
    setFeatureErrors(errors);
  }, [errors, setFeatureErrors]);

  // Applies the Settings dialog's theme choice to the DOM attribute tokens.css already
  // knows how to read (see useIsDarkTheme.ts) — "system" clears the override entirely
  // rather than writing the literal string "system", which tokens.css has no rule for.
  const theme = useSettingsStore((state) => state.theme);
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The chosen accent is the single JS -> CSS handoff for colour: tokens.css derives every
  // hover/active/subtle/selection shade from this one custom property via color-mix(), so
  // setting it here is the whole implementation of "recolour the app".
  const accentColor = useSettingsStore((state) => state.accentColor);
  useEffect(() => {
    document.documentElement.style.setProperty("--accent-hex", accentColor);
  }, [accentColor]);

  return (
    <>
      <AppShell />
      <PrintOverlay />
    </>
  );
}
