import { Box, FolderOpen, Redo2, Save, Settings, Undo2 } from "lucide-react";

import styles from "./MenuBar.module.css";

const MENUS = ["File", "Edit", "View", "Insert", "Tools", "Window", "Help"];

const QUICK_ACTIONS = [
  { id: "doc.open", label: "Open", icon: FolderOpen },
  { id: "doc.save", label: "Save", icon: Save },
  { id: "edit.undo", label: "Undo", icon: Undo2 },
  { id: "edit.redo", label: "Redo", icon: Redo2 },
  { id: "app.settings", label: "Options", icon: Settings },
];

/**
 * Menu strip and quick access toolbar.
 *
 * The window keeps its native Windows 11 caption bar (`decorations: true`), so this row
 * sits below it and carries no window controls of its own.
 */
export function MenuBar() {
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
          <button key={menu} type="button" className={styles.menu}>
            {menu}
          </button>
        ))}
      </nav>

      <div className={styles.divider} aria-hidden="true" />

      <div className={styles.quickAccess}>
        {QUICK_ACTIONS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={styles.quickButton} title={label} aria-label={label}>
            <Icon size={15} strokeWidth={1.75} />
          </button>
        ))}
      </div>

      <div className={styles.spacer} />

      <div className={styles.documentName}>Part1 — Untitled</div>
    </div>
  );
}
