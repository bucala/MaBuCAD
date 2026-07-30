import { useRef, useState } from "react";
import {
  Box,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronUp,
  Redo2,
  Undo2,
} from "lucide-react";

import { useDocumentStore } from "@/state/documentStore";
import { useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";

import { FeatureRow } from "./FeatureRow";
import styles from "./FeatureTree.module.css";

/**
 * Feature manager design tree.
 *
 * Renders the document history in order with a rollback bar. Features below the bar are
 * still in the document but excluded from the rebuild, which is how history-based
 * modellers let you step back and insert a feature mid-history.
 */
export function FeatureTree() {
  const document = useDocumentStore((state) => state.document);
  const selectedFeatureIds = useDocumentStore((state) => state.selectedFeatureIds);
  const past = useDocumentStore((state) => state.past);
  const future = useDocumentStore((state) => state.future);

  const selectFeature = useDocumentStore((state) => state.selectFeature);
  const renameFeature = useDocumentStore((state) => state.renameFeature);
  const deleteFeature = useDocumentStore((state) => state.deleteFeature);
  const toggleSuppressed = useDocumentStore((state) => state.toggleSuppressed);
  const rollbackToBefore = useDocumentStore((state) => state.rollbackToBefore);
  const rollBackOne = useDocumentStore((state) => state.rollBackOne);
  const rollForwardOne = useDocumentStore((state) => state.rollForwardOne);
  const rollToEnd = useDocumentStore((state) => state.rollToEnd);
  const setRollbackIndex = useDocumentStore((state) => state.setRollbackIndex);
  const undo = useDocumentStore((state) => state.undo);
  const redo = useDocumentStore((state) => state.redo);
  const openContextMenu = useDocumentStore((state) => state.openContextMenu);
  const resumeSketch = useSketchStore((state) => state.resumeSketch);
  const hiddenFeatureIds = useViewportStore((state) => state.hiddenFeatureIds);
  const toggleFeatureVisibility = useViewportStore((state) => state.toggleFeatureVisibility);

  const [isRootExpanded, setIsRootExpanded] = useState(true);

  /** Row DOM nodes keyed by feature index, so a rollback-bar drag can find which gap
   * between rows the pointer is over — see `RollbackBar`'s own doc comment. */
  const rowRefs = useRef(new Map<number, HTMLDivElement>());

  const rollbackIndexForClientY = (clientY: number): number => {
    for (let index = 0; index < document.features.length; index += 1) {
      const rect = rowRefs.current.get(index)?.getBoundingClientRect();
      if (rect && clientY < rect.top + rect.height / 2) return index;
    }
    return document.features.length;
  };

  const rolledBackCount = document.features.length - document.rollbackIndex;
  const isRootSelected = selectedFeatureIds.includes(document.id);

  return (
    <div className={styles.tree}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.toolButton}
          title="Undo"
          aria-label="Undo"
          disabled={past.length === 0}
          onClick={undo}
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          className={styles.toolButton}
          title="Redo"
          aria-label="Redo"
          disabled={future.length === 0}
          onClick={redo}
        >
          <Redo2 size={14} />
        </button>

        <div className={styles.toolSpacer} />

        {rolledBackCount > 0 && (
          <span className={styles.rollbackCount}>{rolledBackCount} rolled back</span>
        )}

        <button
          type="button"
          className={styles.toolButton}
          title="Roll back one feature"
          aria-label="Roll back one feature"
          onClick={rollBackOne}
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          className={styles.toolButton}
          title="Roll forward one feature"
          aria-label="Roll forward one feature"
          disabled={rolledBackCount === 0}
          onClick={rollForwardOne}
        >
          <ChevronDown size={14} />
        </button>
        <button
          type="button"
          className={styles.toolButton}
          title="Roll to end"
          aria-label="Roll to end"
          disabled={rolledBackCount === 0}
          onClick={rollToEnd}
        >
          <ChevronsDown size={14} />
        </button>
      </div>

      <div className={styles.rows} role="tree" aria-label="Feature manager design tree">
        <div
          className={styles.row}
          role="treeitem"
          aria-level={1}
          aria-selected={isRootSelected}
          aria-expanded={isRootExpanded}
          data-selected={isRootSelected}
          style={{ paddingLeft: "6px" }}
        >
          <button
            type="button"
            className={styles.chevron}
            aria-label={isRootExpanded ? "Collapse document" : "Expand document"}
            onClick={() => setIsRootExpanded((expanded) => !expanded)}
          >
            {isRootExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          <span className={styles.icon} aria-hidden="true">
            <Box size={14} strokeWidth={1.75} />
          </span>

          <button
            type="button"
            className={styles.rowInner}
            onClick={() => selectFeature(document.id)}
          >
            <span className={styles.label}>{document.name}</span>
          </button>
        </div>

        {isRootExpanded && (
          <div role="group">
            {document.features.map((feature, index) => (
              <div
                key={feature.id}
                ref={(node) => {
                  if (node) rowRefs.current.set(index, node);
                  else rowRefs.current.delete(index);
                }}
              >
                {index === document.rollbackIndex && (
                  <RollbackBar onDrag={(clientY) => setRollbackIndex(rollbackIndexForClientY(clientY))} />
                )}
                <FeatureRow
                  feature={feature}
                  depth={1}
                  isSelected={selectedFeatureIds.includes(feature.id)}
                  isRolledBack={index >= document.rollbackIndex}
                  isHidden={hiddenFeatureIds.includes(feature.id)}
                  onSelect={selectFeature}
                  onRename={renameFeature}
                  onDelete={deleteFeature}
                  onToggleSuppressed={toggleSuppressed}
                  onToggleVisibility={toggleFeatureVisibility}
                  onRollbackToBefore={rollbackToBefore}
                  onEditSketch={resumeSketch}
                  onContextMenu={(x, y) => openContextMenu(x, y)}
                />
              </div>
            ))}

            {document.rollbackIndex >= document.features.length && (
              <RollbackBar onDrag={(clientY) => setRollbackIndex(rollbackIndexForClientY(clientY))} />
            )}
          </div>
        )}

        {document.features.every((feature) => feature.isDefault) && (
          <p className={styles.empty}>
            Only the default reference geometry so far. Start a command from the Features or
            Sketch tab and it appears here in document order.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Marks the current rebuild position, and can be dragged up or down through the feature
 * list to roll back or forward — the same gesture every history-based modeller offers as
 * an alternative to the toolbar's one-feature-at-a-time buttons.
 *
 * The grip only needs `pointermove`/`pointerup` on `window` while actively dragging, not a
 * measured drag-and-drop library: the bar's own new position falls out of wherever
 * `document.rollbackIndex` lands after each `onDrag` call re-renders the tree, since it is
 * rendered inline between rows at exactly that index — no separate "ghost" element to
 * track.
 */
function RollbackBar({ onDrag }: { onDrag: (clientY: number) => void }) {
  const isDraggingRef = useRef(false);

  const handlePointerDown = (event: React.PointerEvent) => {
    event.preventDefault();
    isDraggingRef.current = true;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (isDraggingRef.current) onDrag(moveEvent.clientY);
    };
    const handlePointerUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <div
      className={styles.rollbackBar}
      role="separator"
      aria-label="Rollback bar"
      data-testid="rollback-bar"
    >
      <span className={styles.rollbackGrip} onPointerDown={handlePointerDown}>
        Rollback
      </span>
      <span className={styles.rollbackLine} />
    </div>
  );
}
