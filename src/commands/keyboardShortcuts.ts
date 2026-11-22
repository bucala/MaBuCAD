/** Actions bindable in Settings ▸ Shortcuts. */
export type ShortcutActionId =
  | "delete" | "hideShow" | "undo" | "redo"
  | "newDocument" | "openDocument" | "saveDocument" | "saveDocumentAs" | "importGeometry";

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
  { id: "newDocument", label: "New document", commandId: "doc.new" },
  { id: "openDocument", label: "Open document", commandId: "doc.open" },
  { id: "saveDocument", label: "Save document", commandId: "doc.save" },
  { id: "saveDocumentAs", label: "Save document as", commandId: "doc.save-as" },
  { id: "importGeometry", label: "Import geometry", commandId: "file.import" },
];

export const DEFAULT_SHORTCUT_KEYS: Record<ShortcutActionId, string> = {
  delete: "Delete",
  hideShow: "Space",
  undo: "ctrl+Z",
  redo: "ctrl+Y",
  newDocument: "ctrl+N",
  openDocument: "ctrl+O",
  saveDocument: "ctrl+S",
  saveDocumentAs: "ctrl+shift+S",
  importGeometry: "ctrl+shift+O",
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
