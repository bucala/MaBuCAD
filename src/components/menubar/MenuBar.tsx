import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Box,
  Crosshair,
  Eye,
  FileInput,
  FileOutput,
  FilePlus2,
  FolderOpen,
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
import { useAppInfo } from "@/hooks/useAppInfo";
import { useDocumentStore } from "@/state/documentStore";
import { selectIsSketchMode, useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";
import type { UnitSystem } from "@/types/ui";

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

const UNIT_SYSTEMS: UnitSystem[] = [
  { id: "MMGS", label: "MMGS", description: "Millimetre, gram, second" },
  { id: "CGS", label: "CGS", description: "Centimetre, gram, second" },
  { id: "MKS", label: "MKS", description: "Metre, kilogram, second" },
  { id: "IPS", label: "IPS", description: "Inch, pound, second" },
];

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
function TextMenu({ label, items }: { label: string; items: MenuItemSpec[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  const isSketchMode = useSketchStore(selectIsSketchMode);

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
          {items.map(({ id, label: itemLabel, icon: Icon, commandId }) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              className={styles.dropdownItem}
              disabled={!isCommandAvailable(commandId, isSketchMode)}
              onClick={() => {
                runCommand(commandId);
                close();
              }}
            >
              <Icon size={14} strokeWidth={1.75} />
              {itemLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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

/** Toggle-button row shared by the Settings panel's Projection and Units sections. */
function ToggleRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; title: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className={styles.toggleRow} role="group">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={styles.toggleButton}
          aria-pressed={value === option.id}
          title={option.title}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The gear icon's dropdown: display options that apply to the whole app rather than one
 * command — Projection and Units used to sit in the viewport toolbar and status bar
 * respectively, cluttering both for something changed rarely. `open` is controlled by the
 * parent (rather than owned here, the way every other dropdown in this file owns its own
 * `open`) so Tools ▸ Options can open the exact same panel instead of duplicating it.
 */
function SettingsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = () => onOpenChange(false);
  useDismiss(open, wrapRef, close);

  const projection = useViewportStore((state) => state.projection);
  const setProjection = useViewportStore((state) => state.setProjection);
  const unitSystem = useDocumentStore((state) => state.unitSystem);
  const setUnitSystem = useDocumentStore((state) => state.setUnitSystem);

  return (
    <div ref={wrapRef} className={styles.menuWrap}>
      <button
        type="button"
        className={styles.quickButton}
        title="Options"
        aria-label="Options"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <Settings size={15} strokeWidth={1.75} />
      </button>
      {open && (
        <div className={`${styles.dropdown} ${styles.settingsDropdown}`} role="menu">
          <div className={styles.settingsSection}>
            <span className={styles.settingsLabel}>Projection</span>
            <ToggleRow
              value={projection}
              onChange={setProjection}
              options={[
                {
                  id: "orthographic",
                  label: "Orthographic",
                  title: "Parallel projection — equal lengths measure equal on screen",
                },
                { id: "perspective", label: "Perspective", title: "Natural depth, for presentation views" },
              ]}
            />
          </div>

          <div className={styles.settingsSection}>
            <span className={styles.settingsLabel}>Units</span>
            <ToggleRow
              value={unitSystem}
              onChange={setUnitSystem}
              options={UNIT_SYSTEMS.map((system) => ({
                id: system.id,
                label: system.label,
                title: system.description,
              }))}
            />
          </div>
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

  return (
    <div className={styles.menubar}>
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true">
          <Box size={16} strokeWidth={2} />
        </span>
        MaBuCAD
      </div>

      <nav className={styles.menus} aria-label="Application menu">
        {MENUS.map((menu) => (
          <TextMenu key={menu.id} label={menu.label} items={menu.items} />
        ))}

        <CustomMenu label="Tools">
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
              Options…
            </button>
          )}
        </CustomMenu>

        <CustomMenu label="Window">
          {() => (
            <button type="button" role="menuitem" className={styles.dropdownItem} disabled aria-pressed="true">
              <Box size={14} strokeWidth={1.75} />
              {documentName} — Untitled{isModified ? " *" : ""}
            </button>
          )}
        </CustomMenu>

        <CustomMenu label="Help">
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
            title={label}
            aria-label={label}
            onClick={() => runCommand(id)}
          >
            <Icon size={15} strokeWidth={1.75} />
          </button>
        ))}

        <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>

      <div className={styles.spacer} />

      <div className={styles.documentName}>
        {documentName} — Untitled{isModified ? " *" : ""}
      </div>
    </div>
  );
}
