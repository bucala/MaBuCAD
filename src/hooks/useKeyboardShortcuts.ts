import { useEffect } from "react";

import { runCommand } from "@/commands/commandRegistry";
import { normalizeKeyEvent, SHORTCUT_ACTIONS } from "@/commands/keyboardShortcuts";
import { useSettingsStore } from "@/state/settingsStore";

/**
 * Global listener for the fixed, user-rebindable shortcut list in Settings ▸ Shortcuts
 * (Delete, Space for Hide/Show, Undo, Redo by default) — each dispatches through the same
 * `runCommand` the ribbon and menu bar already use, so a shortcut can never do anything a
 * button press couldn't.
 *
 * Skipped while a text-entry field has focus, so typing a dimension value or renaming a
 * feature isn't hijacked by a bare-key shortcut. Deliberately *not* skipped for a focused
 * `<button>` — a feature row's own name is a button (`FeatureRow.tsx`'s `.rowInner`), so
 * "click a row, then press Delete" (the whole point of this) would otherwise never fire.
 * `preventDefault()` below still stops a focused button's own native Space-activates-it
 * behaviour from *also* firing once a match is found.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;

      const pressed = normalizeKeyEvent(event);
      const shortcuts = useSettingsStore.getState().keyboardShortcuts;
      const action = SHORTCUT_ACTIONS.find((candidate) => shortcuts[candidate.id] === pressed);
      if (!action) return;

      event.preventDefault();
      runCommand(action.commandId);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
