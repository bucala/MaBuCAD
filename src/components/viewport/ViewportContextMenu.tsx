import { useEffect, useRef } from "react";
import { Circle, EyeOff, Eye, Trash2, Undo2 } from "lucide-react";

import { runCommand } from "@/commands/commandRegistry";
import { DEFAULT_PLANE_IDS, useDocumentStore } from "@/state/documentStore";
import { useSketchStore } from "@/state/sketchStore";

import styles from "./ContextMenu.module.css";

/** Rough menu footprint, used to keep it fully on screen without a measure-then-reposition pass. */
const MENU_WIDTH = 190;
const MENU_HEIGHT = 180;

/**
 * Right-click menu for the 3D viewport — a reference plane or the modelled solid.
 *
 * Rendered as a plain sibling of the react-three-fiber `<Canvas>` in `Viewport.tsx`, for the
 * same reason as the sketch canvas's own context menu (`sketch/SketchContextMenu.tsx`):
 * `ReactDOM.createPortal` does not safely escape r3f's reconciler, so the opener
 * (`ReferencePlanes.tsx` / `SolidModel.tsx`, both inside the Canvas) sets state in
 * `documentStore` instead of rendering this component itself.
 *
 * The renderer combines every modelling feature into a single mesh, so there is no
 * per-face feature id to right-click — the opener resolves a *target* feature (the plane
 * itself, or the most recent feature that contributed geometry to the solid) and selects
 * it before opening the menu; this component just acts on whatever is selected.
 */
export function ViewportContextMenu() {
  const contextMenu = useDocumentStore((state) => state.contextMenu);
  const closeContextMenu = useDocumentStore((state) => state.closeContextMenu);
  const selectedFeatureIds = useDocumentStore((state) => state.selectedFeatureIds);
  const features = useDocumentStore((state) => state.document.features);
  const toggleSuppressed = useDocumentStore((state) => state.toggleSuppressed);
  const deleteFeature = useDocumentStore((state) => state.deleteFeature);
  const rollbackToBefore = useDocumentStore((state) => state.rollbackToBefore);
  const resumeSketch = useSketchStore((state) => state.resumeSketch);

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
    // Skip the click that opened the menu; see SketchContextMenu for why this waits a tick.
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

  const selectedId = selectedFeatureIds.length === 1 ? selectedFeatureIds[0] : null;
  const isPlane = selectedId !== null && (DEFAULT_PLANE_IDS as readonly string[]).includes(selectedId);
  const feature = selectedId ? (features.find((item) => item.id === selectedId) ?? null) : null;

  // Nothing resolvable to act on — the opener always selects something first, so this is
  // only a safety net, not an expected path.
  if (!isPlane && !feature) return null;

  const left = Math.min(contextMenu.x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(contextMenu.y, window.innerHeight - MENU_HEIGHT - 8);

  const close = () => closeContextMenu();

  return (
    <div ref={menuRef} className={styles.menu} style={{ left, top }} role="menu">
      {isPlane && (
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => {
            runCommand("sketch.new");
            close();
          }}
        >
          <Circle size={14} strokeWidth={1.75} />
          New Sketch
        </button>
      )}

      {feature && (
        <>
          {feature.kind === "sketch" && (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                resumeSketch(feature.id);
                close();
              }}
            >
              <Circle size={14} strokeWidth={1.75} />
              Edit Sketch
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              toggleSuppressed(feature.id);
              close();
            }}
          >
            {feature.suppressed ? <Eye size={14} strokeWidth={1.75} /> : <EyeOff size={14} strokeWidth={1.75} />}
            {feature.suppressed ? "Unsuppress" : "Suppress"}
          </button>

          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              rollbackToBefore(feature.id);
              close();
            }}
          >
            <Undo2 size={14} strokeWidth={1.75} />
            Roll Back to Before
          </button>

          <div className={styles.divider} />

          <button
            type="button"
            role="menuitem"
            className={`${styles.item} ${styles.danger}`}
            onClick={() => {
              deleteFeature(feature.id);
              close();
            }}
          >
            <Trash2 size={14} strokeWidth={1.75} />
            Delete
          </button>
        </>
      )}
    </div>
  );
}
