import { useEffect, useRef } from "react";
import {
  Circle,
  CircleDashed,
  Crosshair,
  FlipHorizontal2,
  MoveDiagonal,
  MoveHorizontal,
  MoveVertical,
  Minus,
  MousePointer2,
  Parentheses,
  Route,
  Scan,
  Square,
  Trash2,
} from "lucide-react";

import { selectActiveSketch, useSketchStore, type SketchTool } from "@/state/sketchStore";

import styles from "../ContextMenu.module.css";

const TOOL_ITEMS: { id: SketchTool; label: string; icon: typeof MousePointer2 }[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "line", label: "Line", icon: Minus },
  { id: "rectangle", label: "Rectangle", icon: Square },
  { id: "circle", label: "Circle", icon: Circle },
  { id: "construction-line", label: "Construction Line", icon: Route },
];

/** Rough menu footprint, used to keep it fully on screen without a measure-then-reposition pass. */
const MENU_WIDTH = 190;
const MENU_HEIGHT = 290;

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
  const selection = useSketchStore((state) => state.selection);
  const selectionCount = selection.length;
  const deleteSelection = useSketchStore((state) => state.deleteSelection);
  const exitSketch = useSketchStore((state) => state.exitSketch);
  const sketch = useSketchStore(selectActiveSketch);
  const toggleConstruction = useSketchStore((state) => state.toggleConstruction);
  const toggleDimensionRadiusDiameter = useSketchStore((state) => state.toggleDimensionRadiusDiameter);
  const toggleRadiusExtendToCenter = useSketchStore((state) => state.toggleRadiusExtendToCenter);
  const flipAngleDimension = useSketchStore((state) => state.flipAngleDimension);
  const setLinearDimensionMode = useSketchStore((state) => state.setLinearDimensionMode);
  const toggleDimensionDriving = useSketchStore((state) => state.toggleDimensionDriving);

  // Only meaningful with exactly one dimension selected — a right-click on a dimension
  // label selects it alone first (see `SketchDimensions.tsx`'s own `onContextMenu`), so
  // this is what lets the menu offer the right action for that one dimension's kind.
  const selectedDimension =
    selection.length === 1 ? sketch?.dimensions.find((dimension) => dimension.id === selection[0]) : undefined;

  // Same "everything selected already agrees" rule `toggleConstruction` itself uses, so the
  // label always reflects what clicking it is actually about to do.
  const selectedConstructibles = sketch?.entities.filter(
    (entity) => entity.kind !== "point" && selection.includes(entity.id),
  );
  const allSelectedAreConstruction = Boolean(
    selectedConstructibles?.length && selectedConstructibles.every((entity) => entity.construction),
  );

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

      {selectedConstructibles && selectedConstructibles.length > 0 && (
        <>
          <div className={styles.divider} />
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              toggleConstruction();
              closeContextMenu();
            }}
          >
            <CircleDashed size={14} strokeWidth={1.75} />
            {allSelectedAreConstruction ? "Convert to Normal" : "Convert to Construction"}
          </button>
        </>
      )}

      {selectedDimension && (selectedDimension.kind === "radius" || selectedDimension.kind === "diameter") && (
        <>
          <div className={styles.divider} />
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              toggleDimensionRadiusDiameter(selectedDimension.id);
              closeContextMenu();
            }}
          >
            <FlipHorizontal2 size={14} strokeWidth={1.75} />
            {selectedDimension.kind === "radius" ? "Show as Diameter" : "Show as Radius"}
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={Boolean(selectedDimension.extendToCenter)}
            className={styles.item}
            onClick={() => {
              toggleRadiusExtendToCenter(selectedDimension.id);
              closeContextMenu();
            }}
          >
            <Crosshair size={14} strokeWidth={1.75} />
            {selectedDimension.extendToCenter ? "Shorten to Rim" : "Extend to Centre"}
          </button>
        </>
      )}

      {selectedDimension &&
        (selectedDimension.kind === "distance" ||
          selectedDimension.kind === "horizontal-distance" ||
          selectedDimension.kind === "vertical-distance") && (
          <>
            <div className={styles.divider} />
            {(
              [
                { mode: "distance", label: "Aligned", icon: MoveDiagonal },
                { mode: "horizontal-distance", label: "Horizontal", icon: MoveHorizontal },
                { mode: "vertical-distance", label: "Vertical", icon: MoveVertical },
              ] as const
            ).map(({ mode, label, icon: Icon }) => (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-pressed={selectedDimension.kind === mode}
                className={styles.item}
                onClick={() => {
                  setLinearDimensionMode(selectedDimension.id, mode);
                  closeContextMenu();
                }}
              >
                <Icon size={14} strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </>
        )}

      {selectedDimension && selectedDimension.kind === "angle" && (
        <>
          <div className={styles.divider} />
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              flipAngleDimension(selectedDimension.id);
              closeContextMenu();
            }}
          >
            <FlipHorizontal2 size={14} strokeWidth={1.75} />
            Flip Angle
          </button>
        </>
      )}

      {selectedDimension && (
        <>
          <div className={styles.divider} />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={Boolean(selectedDimension.driven)}
            className={styles.item}
            onClick={() => {
              toggleDimensionDriving(selectedDimension.id);
              closeContextMenu();
            }}
          >
            <Parentheses size={14} strokeWidth={1.75} />
            {selectedDimension.driven ? "Make Driving" : "Make Driven"}
          </button>
        </>
      )}

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
