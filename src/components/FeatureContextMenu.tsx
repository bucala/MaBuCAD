import { useEffect, useRef } from "react";
import { Circle, Eye, EyeOff, Power, PowerOff, Trash2, Undo2 } from "lucide-react";

import { runCommand } from "@/commands/commandRegistry";
import { useTranslation } from "@/i18n/useTranslation";
import { DEFAULT_PLANE_IDS, useDocumentStore } from "@/state/documentStore";
import { useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";

import styles from "./viewport/ContextMenu.module.css";

/** Rough menu footprint, used to keep it fully on screen without a measure-then-reposition pass. */
const MENU_WIDTH = 190;
const MENU_HEIGHT = 210;

/**
 * Right-click menu for a feature: a reference plane, a sketch, or a modelling feature —
 * from either the 3D viewport (a plane or the modelled solid) or the Feature Manager tree.
 *
 * Rendered once at the app's top level (`AppShell.tsx`) rather than nested under the
 * viewport or the tree, since `documentStore.contextMenu`/`selectedFeatureIds` are already
 * global state either opener can drive the same way — a plane or solid clicked in the 3D
 * scene, or a row right-clicked in the tree (`FeatureRow.tsx`). `ReactDOM.createPortal`
 * does not safely escape react-three-fiber's own reconciler, which is what forces the
 * *viewport* opener through the store instead of rendering this directly; the tree opener
 * has no such constraint but uses the same store for one shared implementation instead of
 * a second, near-identical menu.
 *
 * The renderer combines every modelling feature into a single mesh, so there is no
 * per-face feature id to right-click in the viewport — that opener resolves a *target*
 * feature (the plane itself, or the most recent feature that contributed geometry to the
 * solid) and selects it before opening the menu; this component just acts on whatever is
 * selected, which is exactly what a tree row's opener already has to hand directly.
 */
export function FeatureContextMenu() {
  const { t } = useTranslation();
  const contextMenu = useDocumentStore((state) => state.contextMenu);
  const closeContextMenu = useDocumentStore((state) => state.closeContextMenu);
  const selectedFeatureIds = useDocumentStore((state) => state.selectedFeatureIds);
  const features = useDocumentStore((state) => state.document.features);
  const toggleSuppressed = useDocumentStore((state) => state.toggleSuppressed);
  const deleteFeature = useDocumentStore((state) => state.deleteFeature);
  const rollbackToBefore = useDocumentStore((state) => state.rollbackToBefore);
  const resumeSketch = useSketchStore((state) => state.resumeSketch);
  const sketches = useSketchStore((state) => state.sketches);
  const hiddenFeatureIds = useViewportStore((state) => state.hiddenFeatureIds);
  const toggleFeatureVisibility = useViewportStore((state) => state.toggleFeatureVisibility);

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
  const isHidden = selectedId ? hiddenFeatureIds.includes(selectedId) : false;

  // Any sketch-consuming feature (Extrude, Revolve, Hole, Rib, ...) — not just a sketch
  // row itself — gets the same "Edit Sketch" shortcut straight to its own backing sketch,
  // the same one SolidWorks/Inventor offer on a boss/cut feature. Without this, a sketch
  // created automatically rather than by hand (Hole Wizard's "click a face to place a
  // hole" — see `placeHoleAtPick` in `commandRegistry.ts`) is only reachable by finding
  // its own separate row in the tree, which is easy to miss since nothing about the Hole
  // feature's own row hints that row exists.
  const parentSketchId =
    feature && feature.kind !== "sketch"
      ? feature.parents.find(
          (parentId) =>
            features.some((candidate) => candidate.id === parentId && candidate.kind === "sketch") &&
            sketches[parentId],
        )
      : undefined;

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
          {t("tree.newSketch", "New Sketch")}
        </button>
      )}

      {selectedId && (isPlane || feature) && (
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => {
            toggleFeatureVisibility(selectedId);
            close();
          }}
        >
          {isHidden ? <Eye size={14} strokeWidth={1.75} /> : <EyeOff size={14} strokeWidth={1.75} />}
          {isHidden ? t("tree.show", "Show") : t("tree.hide", "Hide")}
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
              {t("tree.editSketch", "Edit Sketch")}
            </button>
          )}

          {parentSketchId && (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                resumeSketch(parentSketchId);
                close();
              }}
            >
              <Circle size={14} strokeWidth={1.75} />
              {t("tree.editSketch", "Edit Sketch")}
            </button>
          )}

          {!feature.isDefault && (
            <>
              <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => {
                  toggleSuppressed(feature.id);
                  close();
                }}
              >
                {feature.suppressed ? <Power size={14} strokeWidth={1.75} /> : <PowerOff size={14} strokeWidth={1.75} />}
                {feature.suppressed
                  ? t("feature.unsuppress", "Unsuppress")
                  : t("feature.suppress", "Suppress")}
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
                {t("tree.rollBackToBeforeMenu", "Roll Back to Before")}
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
                {t("feature.delete", "Delete")}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
