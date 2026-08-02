import { useEffect, useRef } from "react";
import { Check, Download, Upload } from "lucide-react";

import { runExportSettings, runImportSettings } from "@/commands/settingsIO";
import { useSettingsStore } from "@/state/settingsStore";

import styles from "../viewport/ContextMenu.module.css";

const MENU_WIDTH = 220;
const MENU_HEIGHT = 170;

interface RibbonContextMenuProps {
  position: { x: number; y: number };
  onClose: () => void;
}

/**
 * Right-click menu for empty ribbon space. Lets the chrome around the command surface —
 * the top-left logo/title (`MenuBar.tsx`) and the bottom-right version readout
 * (`StatusBar.tsx`) — be toggled off, and links straight to the same Export/Import
 * Settings pair `SettingsDialog.tsx` already exposes: both toggles live in
 * `settingsStore.ts` alongside every other preference, so a customised ribbon travels with
 * the rest of the app's settings in one export rather than needing a file of its own.
 */
export function RibbonContextMenu({ position, onClose }: RibbonContextMenuProps) {
  const logoTitleVisible = useSettingsStore((state) => state.logoTitleVisible);
  const toggleLogoTitleVisible = useSettingsStore((state) => state.toggleLogoTitleVisible);
  const versionVisible = useSettingsStore((state) => state.versionVisible);
  const toggleVersionVisible = useSettingsStore((state) => state.toggleVersionVisible);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Skip the click that opened the menu; see `MenuBar.tsx`'s `useDismiss` for why this
    // waits a tick rather than attaching the listener synchronously.
    const timer = window.setTimeout(() => {
      window.addEventListener("pointerdown", handlePointerDown, true);
    }, 0);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const left = Math.min(position.x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(position.y, window.innerHeight - MENU_HEIGHT - 8);

  return (
    <div ref={menuRef} className={styles.menu} style={{ left, top, minWidth: MENU_WIDTH }} role="menu">
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={logoTitleVisible}
        className={styles.item}
        onClick={toggleLogoTitleVisible}
      >
        <span style={{ width: 14, display: "inline-flex", flexShrink: 0 }}>
          {logoTitleVisible && <Check size={14} strokeWidth={2} />}
        </span>
        Show Logo &amp; Title
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={versionVisible}
        className={styles.item}
        onClick={toggleVersionVisible}
      >
        <span style={{ width: 14, display: "inline-flex", flexShrink: 0 }}>
          {versionVisible && <Check size={14} strokeWidth={2} />}
        </span>
        Show Version Number
      </button>

      <div className={styles.divider} />

      <button
        type="button"
        role="menuitem"
        className={styles.item}
        onClick={() => {
          void runExportSettings();
          onClose();
        }}
      >
        <Download size={14} strokeWidth={1.75} />
        Export Settings…
      </button>
      <button
        type="button"
        role="menuitem"
        className={styles.item}
        onClick={() => {
          void runImportSettings();
          onClose();
        }}
      >
        <Upload size={14} strokeWidth={1.75} />
        Import Settings…
      </button>
    </div>
  );
}
