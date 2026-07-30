import { useEffect, useRef } from "react";
import { Circle, Minus, MousePointer2, Route, Scan, Square, Trash2 } from "lucide-react";

import { useSketchStore, type SketchTool } from "@/state/sketchStore";

import styles from "./SketchContextMenu.module.css";

const TOOL_ITEMS: { id: SketchTool; label: string; icon: typeof MousePointer2 }[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "line", label: "Line", icon: Minus },
  { id: "rectangle", label: "Rectangle", icon: Square },
  { id: "circle", label: "Circle", icon: Circle },
  { id: "construction-line", label: "Construction Line", icon: Route },
];

/** Rough menu footprint, used to keep it fully on screen without a measure-then-reposition pass. */
const MENU_WIDTH = 190;
const MENU_HEIGHT = 250;

/**
 * Right-click menu for the sketch canvas.
 *
 * Rendered as a plain sibling of the react-three-fiber `<Canvas>` in `Viewport.tsx`, not
 * from inside it: `SketchCanvas` (which lives inside the Canvas) sets `contextMenu` in
 * `sketchStore` on right-click rather than rendering this component itself, because
 * react-dom's `createPortal` does not safely escape r3f's own reconciler — drei's own
 * `Html` helper works around the same problem by mounting a wholly separate React root on
 * a manually-created DOM node rather than portalling, which is more machinery than a
 * simple menu needs when it can just live in the ordinary DOM tree from the start.
 *
 * Deliberately a fixed, short list of tool switches plus Delete and Exit Sketch rather
 * than a fully contextual relation-aware menu — that keeps it predictable and easy to
 * scan, matching what a right-click menu is for (quick access to the next likely action),
 * not a replacement for the sketch panel's full command set.
 */
export function SketchContextMenu() {
  const contextMenu = useSketchStore((state) => state.contextMenu);
  const closeContextMenu = useSketchStore((state) => state.closeContextMenu);
  const tool = useSketchStore((state) => state.tool);
  const setTool = useSketchStore((state) => state.setTool);
  const selectionCount = useSketchStore((state) => state.selection.length);
  const deleteSelection = useSketchStore((state) => state.deleteSelection);
  const exitSketch = useSketchStore((state) => state.exitSketch);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        closeContextMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu();
    };

    // Capture phase, and skip the click that opened the menu: it is still in flight as a
    // native contextmenu event when this effect mounts, so listening on the next tick
    // avoids immediately closing the menu it just opened.
    const timer = window.setTimeout(() => {
      window.addEventListener("pointerdown", handlePointerDown, true);
    }, 0);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu, closeContextMenu]);

  if (!contextMenu) return null;

  const left = Math.min(contextMenu.x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(contextMenu.y, window.innerHeight - MENU_HEIGHT - 8);

  return (
    <div ref={menuRef} className={styles.menu} style={{ left, top }} role="menu">
      {TOOL_ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="menuitemradio"
          aria-pressed={tool === id}
          className={styles.item}
          onClick={() => {
            setTool(id);
            closeContextMenu();
          }}
        >
          <Icon size={14} strokeWidth={1.75} />
          {label}
        </button>
      ))}

      <div className={styles.divider} />

      <button
        type="button"
        role="menuitem"
        className={`${styles.item} ${styles.danger}`}
        disabled={selectionCount === 0}
        onClick={() => {
          deleteSelection();
          closeContextMenu();
        }}
      >
        <Trash2 size={14} strokeWidth={1.75} />
        Delete{selectionCount > 0 ? ` (${selectionCount})` : ""}
      </button>

      <div className={styles.divider} />

      <button
        type="button"
        role="menuitem"
        className={styles.item}
        onClick={() => {
          exitSketch();
          closeContextMenu();
        }}
      >
        <Scan size={14} strokeWidth={1.75} />
        Exit Sketch
      </button>
    </div>
  );
}
