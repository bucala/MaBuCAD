import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Box,
  Check,
  Crosshair,
  Eye,
  FileInput,
  FileOutput,
  FilePlus2,
  FolderOpen,
  History,
  Layers,
  ListChecks,
  Minus,
  Redo2,
  Save,
  Settings,
  SquareDashed,
  Trash2,
  Undo2,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";

import { isCommandAvailable, runCommand } from "@/commands/commandRegistry";
import { hasAutosaveSnapshot, runRestoreAutosave } from "@/commands/documentIO";
import { useAppInfo } from "@/hooks/useAppInfo";
import { useTranslation } from "@/i18n/useTranslation";
import { useDocumentStore } from "@/state/documentStore";
import { useSettingsStore } from "@/state/settingsStore";
import { selectIsSketchMode, useSketchStore } from "@/state/sketchStore";

import { NewDocumentDialog } from "../document/NewDocumentDialog";
import { SettingsDialog } from "../settings/SettingsDialog";
import styles from "./MenuBar.module.css";

const QUICK_ACTIONS = [
  { id: "doc.open", label: "Open", icon: FolderOpen },
  { id: "doc.save", label: "Save", icon: Save },
  { id: "edit.undo", label: "Undo", icon: Undo2 },
  { id: "edit.redo", label: "Redo", icon: Redo2 },
];

interface MenuItemSpec {
  id: string;
  label: string;
  icon: LucideIcon;
  /** A ribbon command id, run through the same registry the ribbon itself uses — this
   * is deliberately not a free-form onClick so every menu entry stays a thin pointer to
   * a command that already exists (and is already gated by `isCommandAvailable`) rather
   * than a second place logic could drift from the ribbon's own. */
  commandId: string;
}

const MENUS: { id: string; label: string; items: MenuItemSpec[] }[] = [
  {
    id: "file",
    label: "File",
    items: [
      { id: "doc.new", label: "New", icon: FilePlus2, commandId: "doc.new" },
      { id: "doc.open", label: "Open…", icon: FolderOpen, commandId: "doc.open" },
      { id: "doc.save", label: "Save", icon: Save, commandId: "doc.save" },
      { id: "file.import", label: "Import…", icon: FileInput, commandId: "file.import" },
      { id: "file.export-step", label: "Export STEP…", icon: FileOutput, commandId: "file.export-step" },
      { id: "file.export-stl", label: "Export STL…", icon: FileOutput, commandId: "file.export-stl" },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    items: [
      { id: "edit.undo", label: "Undo", icon: Undo2, commandId: "edit.undo" },
      { id: "edit.redo", label: "Redo", icon: Redo2, commandId: "edit.redo" },
      { id: "edit.delete", label: "Delete", icon: Trash2, commandId: "edit.delete" },
    ],
  },
  {
    id: "view",
    label: "View",
    items: [
      { id: "view.zoom-fit", label: "Zoom to Fit", icon: ZoomIn, commandId: "view.zoom-fit" },
      { id: "view.display-mode", label: "Display Style", icon: Eye, commandId: "view.display-mode" },
      { id: "view.hide-show", label: "Hide / Show", icon: Layers, commandId: "view.hide-show" },
      { id: "view.constraints", label: "Show / Hide Constraints", icon: ListChecks, commandId: "view.constraints" },
    ],
  },
  {
    id: "insert",
    label: "Insert",
    items: [
      { id: "reference.plane", label: "Reference Plane", icon: SquareDashed, commandId: "reference.plane" },
      { id: "reference.axis", label: "Reference Axis", icon: Minus, commandId: "reference.axis" },
      { id: "reference.point", label: "Reference Point", icon: Crosshair, commandId: "reference.point" },
    ],
  },
];

/**
 * Closes `onOutsideOrEscape` on a click outside `ref`'s subtree or an Escape keypress.
 *
 * Shared by every dropdown below (the seven menus, Settings) rather than each wiring its
 * own listeners, so "click outside to dismiss" behaves identically everywhere.
 */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    // Deferred by a tick so the click that opened the menu (still bubbling to `window`
    // at the moment this effect runs) isn't immediately read as the outside click that
    // closes it again — the same guard `FeatureContextMenu`/`SketchContextMenu` use.
    const timer = window.setTimeout(() => {
      window.addEventListener("pointerdown", handlePointerDown, true);
    }, 0);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, ref, onDismiss]);
}

/** A text menu-bar button (File, Edit, …) that opens a dropdown of commands on click. */
function TextMenu({
  menuId,
  label,
  items,
  extraItems,
}: {
  menuId: string;
  label: string;
  items: MenuItemSpec[];
  /** Trailing dropdown content that isn't a plain ribbon-backed command — the File
   * menu's own Autosave toggle and Restore Autosave action, which have no ribbon
   * counterpart to reuse the way every other item here does. */
  extraItems?: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  const isSketchMode = useSketchStore(selectIsSketchMode);
  const { canUndo, canRedo } = useUndoRedoAvailability();
  const { t } = useTranslation();

  useDismiss(open, wrapRef, close);

  return (
    <div ref={wrapRef} className={styles.menuWrap}>
      <button
        type="button"
        className={styles.menu}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t(`menu.${menuId}`, label)}
      </button>
      {open && (
        <div className={styles.dropdown} role="menu">
          {/* Each item's own `commandId` doubles as its translation key — the same ribbon
              command already has a Slovak entry in `translations.ts`, so a menu entry that
              points at one gets it for free with no separate key to keep in sync. */}
          {items.map(({ id, label: itemLabel, icon: Icon, commandId }) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              className={styles.dropdownItem}
              disabled={
                !isCommandAvailable(commandId, isSketchMode) ||
                (commandId === "edit.undo" && !canUndo) ||
                (commandId === "edit.redo" && !canRedo)
              }
              onClick={() => {
                runCommand(commandId);
                close();
              }}
            >
              <Icon size={14} strokeWidth={1.75} />
              {t(commandId, itemLabel)}
            </button>
          ))}
          {extraItems?.(close)}
        </div>
      )}
    </div>
  );
}

/** Whether Undo/Redo have anything to act on right now — the sketch's own history while
 * a sketch is open (see `sketchStore.ts`'s `past`/`future`), the document's otherwise,
 * matching `commandRegistry.ts`'s own "sketch mode redirects the command" split for
 * `edit.undo`/`edit.redo`. */
function useUndoRedoAvailability() {
  const isSketchMode = useSketchStore(selectIsSketchMode);
  const docCanUndo = useDocumentStore((state) => state.past.length > 0);
  const docCanRedo = useDocumentStore((state) => state.future.length > 0);
  const sketchCanUndo = useSketchStore((state) => state.past.length > 0);
  const sketchCanRedo = useSketchStore((state) => state.future.length > 0);

  return isSketchMode
    ? { canUndo: sketchCanUndo, canRedo: sketchCanRedo }
    : { canUndo: docCanUndo, canRedo: docCanRedo };
}

/** A text menu-bar button with free-form content instead of a plain command list —
 * Window and Help have nothing that maps to a ribbon command. */
function CustomMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useDismiss(open, wrapRef, close);

  return (
    <div ref={wrapRef} className={styles.menuWrap}>
      <button
        type="button"
        className={styles.menu}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && (
        <div className={styles.dropdown} role="menu">
          {children(close)}
        </div>
      )}
    </div>
  );
}

/**
 * Menu strip and quick access toolbar.
 *
 * The window keeps its native Windows 11 caption bar (`decorations: true`), so this row
 * sits below it and carries no window controls of its own.
 */
export function MenuBar() {
  const documentName = useDocumentStore((state) => state.document.name);
  const isModified = useDocumentStore((state) => state.past.length > 0);
  const appInfo = useAppInfo();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { t } = useTranslation();
  const autosaveEnabled = useSettingsStore((state) => state.autosaveEnabled);
  const toggleAutosave = useSettingsStore((state) => state.toggleAutosave);
  const logoTitleVisible = useSettingsStore((state) => state.logoTitleVisible);
  const { canUndo, canRedo } = useUndoRedoAvailability();

  return (
    <div className={styles.menubar}>
      {logoTitleVisible && (
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <Box size={16} strokeWidth={2} />
          </span>
          MaBuCAD
        </div>
      )}

      <nav className={styles.menus} aria-label="Application menu">
        {MENUS.map((menu) => (
          <TextMenu
            key={menu.id}
            menuId={menu.id}
            label={menu.label}
            items={menu.items}
            extraItems={
              menu.id === "file"
                ? (close) => (
                    <>
                      <div className={styles.menuDivider} role="separator" />
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={autosaveEnabled}
                        className={styles.dropdownItem}
                        onClick={toggleAutosave}
                      >
                        <span className={styles.checkSlot} aria-hidden="true">
                          {autosaveEnabled && <Check size={14} strokeWidth={2} />}
                        </span>
                        {t("menu.autosave", "Autosave")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={styles.dropdownItem}
                        disabled={!hasAutosaveSnapshot()}
                        onClick={() => {
                          runRestoreAutosave();
                          close();
                        }}
                      >
                        <History size={14} strokeWidth={1.75} />
                        {t("menu.restore-autosave", "Restore Autosave")}…
                      </button>
                    </>
                  )
                : undefined
            }
          />
        ))}

        <CustomMenu label={t("menu.tools", "Tools")}>
          {(close) => (
            <button
              type="button"
              role="menuitem"
              className={styles.dropdownItem}
              onClick={() => {
                setSettingsOpen(true);
                close();
              }}
            >
              <Settings size={14} strokeWidth={1.75} />
              {t("menu.options", "Options")}…
            </button>
          )}
        </CustomMenu>

        <CustomMenu label={t("menu.window", "Window")}>
          {() => (
            <button type="button" role="menuitem" className={styles.dropdownItem} disabled aria-pressed="true">
              <Box size={14} strokeWidth={1.75} />
              {documentName} — Untitled{isModified ? " *" : ""}
            </button>
          )}
        </CustomMenu>

        <CustomMenu label={t("menu.help", "Help")}>
          {(close) => (
            <button
              type="button"
              role="menuitem"
              className={styles.dropdownItem}
              onClick={() => {
                window.alert(`MaBuCAD${appInfo ? ` v${appInfo.version}` : ""}\nParametric 3D/2D CAD system.`);
                close();
              }}
            >
              <Box size={14} strokeWidth={1.75} />
              About MaBuCAD
            </button>
          )}
        </CustomMenu>
      </nav>

      <div className={styles.divider} aria-hidden="true" />

      <div className={styles.quickAccess}>
        {QUICK_ACTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={styles.quickButton}
            title={t(id, label)}
            aria-label={t(id, label)}
            disabled={(id === "edit.undo" && !canUndo) || (id === "edit.redo" && !canRedo)}
            onClick={() => runCommand(id)}
          >
            <Icon size={15} strokeWidth={1.75} />
          </button>
        ))}

        <button
          type="button"
          className={styles.quickButton}
          title={t("menu.options", "Options")}
          aria-label={t("menu.options", "Options")}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={15} strokeWidth={1.75} />
        </button>
      </div>

      <div className={styles.spacer} />

      <div className={styles.documentName}>
        {documentName} — Untitled{isModified ? " *" : ""}
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <NewDocumentDialog />
    </div>
  );
}
