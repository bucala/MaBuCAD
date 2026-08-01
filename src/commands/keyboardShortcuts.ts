/** Actions bindable to a key from Settings ▸ Shortcuts. Deliberately a small, fixed list
 * of ribbon commands rather than every command in the registry — these four are the ones
 * every other CAD tool exposes as bare-key shortcuts (no modifier needed for three of
 * them), so they're the ones worth a global listener; anything else stays mouse/ribbon
 * driven. */
export type ShortcutActionId = "delete" | "hideShow" | "undo" | "redo";

export interface ShortcutAction {
  id: ShortcutActionId;
  label: string;
  commandId: string;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "delete", label: "Delete selection", commandId: "edit.delete" },
  { id: "hideShow", label: "Hide/Show selection", commandId: "view.hide-show" },
  { id: "undo", label: "Undo", commandId: "edit.undo" },
  { id: "redo", label: "Redo", commandId: "edit.redo" },
];

export const DEFAULT_SHORTCUT_KEYS: Record<ShortcutActionId, string> = {
  delete: "Delete",
  hideShow: "Space",
  undo: "ctrl+Z",
  redo: "ctrl+Y",
};

/**
 * Turns a `KeyboardEvent` into a stable string ("ctrl+Z", "Space", "Delete", ...) used
 * both to match a live keypress against the configured bindings and to record a new one
 * while the user is rebinding a shortcut in Settings — the same function drives both, so
 * they can never drift into two different notions of "the same key".
 */
export function normalizeKeyEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("ctrl");
  if (event.shiftKey) parts.push("shift");
  if (event.altKey) parts.push("alt");

  let key = event.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);

  return parts.join("+");
}
