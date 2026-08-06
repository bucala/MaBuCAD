import { useEffect, useRef } from "react";
import { Box, Check, Square, Spline } from "lucide-react";

import type { SelectionFilterMode } from "@/state/viewportStore";

import styles from "../viewport/ContextMenu.module.css";

const MENU_WIDTH = 168;
const MENU_HEIGHT = 100;

const FILTER_OPTIONS: { mode: SelectionFilterMode; label: string; icon: typeof Box }[] = [
  { mode: "body", label: "Select Body Priority", icon: Box },
  { mode: "face", label: "Select Face Priority", icon: Square },
  { mode: "edge", label: "Select Edge Priority", icon: Spline },
];

/**
 * Right-click menu on the status bar's own selection-filter icon — the direct-pick
 * counterpart to that icon's left-click "cycle to the next mode" shortcut, à la Inventor's
 * own Select dropdown. Reuses the ribbon's own floating-menu styling
 * (`RibbonContextMenu.tsx`'s `ContextMenu.module.css`) rather than inventing new popup
 * chrome for what is, structurally, the same "small checkable list positioned at a click"
 * shape.
 */
export function SelectionFilterMenu({
  position,
  mode,
  onPick,
  onClose,
}: {
  position: { x: number; y: number };
  mode: SelectionFilterMode;
  onPick: (mode: SelectionFilterMode) => void;
  onClose: () => void;
}) {
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
  const top = Math.min(position.y - MENU_HEIGHT, window.innerHeight - MENU_HEIGHT - 8);

  return (
    <div ref={menuRef} className={styles.menu} style={{ left, top, minWidth: MENU_WIDTH }} role="menu">
      {FILTER_OPTIONS.map(({ mode: optionMode, label, icon: Icon }) => (
        <button
          key={optionMode}
          type="button"
          role="menuitemcheckbox"
          aria-checked={mode === optionMode}
          className={styles.item}
          onClick={() => {
            onPick(optionMode);
            onClose();
          }}
        >
          <span style={{ width: 14, display: "inline-flex", flexShrink: 0 }}>
            {mode === optionMode && <Check size={14} strokeWidth={2} />}
          </span>
          <Icon size={14} strokeWidth={1.75} />
          {label}
        </button>
      ))}
    </div>
  );
}
