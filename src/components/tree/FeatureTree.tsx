import { useState } from "react";
import {
  Box,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Palette,
  Ruler,
  SquareDashed,
} from "lucide-react";

import type { FeatureNode } from "@/types/ui";

import styles from "./FeatureTree.module.css";

/**
 * Contents of a freshly created part: the document root, its material and annotation
 * folders, the three default planes and the origin.
 *
 * Step 3 replaces this constant with the document store, at which point features
 * created by the user append below `origin` and gain rollback handling.
 */
const DEFAULT_TREE: FeatureNode = {
  id: "document",
  label: "Part1",
  icon: Box,
  children: [
    { id: "annotations", label: "Annotations", icon: Ruler, isDefault: true },
    { id: "material", label: "Material <not specified>", icon: Palette, isDefault: true },
    { id: "plane-front", label: "Front Plane", icon: SquareDashed, isDefault: true },
    { id: "plane-top", label: "Top Plane", icon: SquareDashed, isDefault: true },
    { id: "plane-right", label: "Right Plane", icon: SquareDashed, isDefault: true },
    { id: "origin", label: "Origin", icon: Crosshair, isDefault: true },
  ],
};

interface TreeRowProps {
  node: FeatureNode;
  depth: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}

function TreeRow({ node, depth, selectedId, expandedIds, onSelect, onToggle }: TreeRowProps) {
  const hasChildren = Boolean(node.children?.length);
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const Icon = node.icon;

  return (
    <div className={styles.node}>
      <div
        className={styles.row}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        data-selected={isSelected}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.chevron}
            aria-label={isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
            onClick={() => onToggle(node.id)}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className={styles.chevronPlaceholder} />
        )}

        <button type="button" className={styles.rowInner} onClick={() => onSelect(node.id)}>
          <span
            className={`${styles.icon} ${node.isDefault ? styles.iconDefault : ""}`}
            aria-hidden="true"
          >
            <Icon size={14} strokeWidth={1.75} />
          </span>
          <span className={styles.label}>{node.label}</span>
        </button>
      </div>

      {hasChildren && isExpanded && (
        <div className={styles.children} role="group">
          {node.children?.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** History tree for the active document. */
export function FeatureTree() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(["document"]));

  const handleToggle = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className={styles.tree} role="tree" aria-label="Feature manager design tree">
      <TreeRow
        node={DEFAULT_TREE}
        depth={0}
        selectedId={selectedId}
        expandedIds={expandedIds}
        onSelect={setSelectedId}
        onToggle={handleToggle}
      />

      <p className={styles.hint}>
        The tree currently holds the default reference geometry only. Features appear here in
        document order once modelling commands are connected, with a rollback bar for stepping
        back through the history.
      </p>
    </div>
  );
}
