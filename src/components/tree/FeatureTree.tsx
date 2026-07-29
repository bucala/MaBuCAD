import { useState } from "react";
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
  const undo = useDocumentStore((state) => state.undo);
  const redo = useDocumentStore((state) => state.redo);

  const [isRootExpanded, setIsRootExpanded] = useState(true);

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
              <div key={feature.id}>
                {index === document.rollbackIndex && <RollbackBar />}
                <FeatureRow
                  feature={feature}
                  depth={1}
                  isSelected={selectedFeatureIds.includes(feature.id)}
                  isRolledBack={index >= document.rollbackIndex}
                  onSelect={selectFeature}
                  onRename={renameFeature}
                  onDelete={deleteFeature}
                  onToggleSuppressed={toggleSuppressed}
                  onRollbackToBefore={rollbackToBefore}
                />
              </div>
            ))}

            {document.rollbackIndex >= document.features.length && <RollbackBar />}
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

/** Visual marker for the current rebuild position. */
function RollbackBar() {
  return (
    <div
      className={styles.rollbackBar}
      role="separator"
      aria-label="Rollback bar"
      data-testid="rollback-bar"
    >
      <span className={styles.rollbackGrip}>Rollback</span>
      <span className={styles.rollbackLine} />
    </div>
  );
}
