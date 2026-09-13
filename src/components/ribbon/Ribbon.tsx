import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { isCommandAvailable, runCommand } from "@/commands/commandRegistry";
import { RIBBON_TABS } from "@/commands/ribbonConfig";
import { useTranslation } from "@/i18n/useTranslation";
import { useDocumentStore } from "@/state/documentStore";
import { selectIsSketchMode, useSketchStore } from "@/state/sketchStore";
import type { DocumentKind } from "@/types/document";
import type { RibbonItem } from "@/types/ui";

import { RibbonContextMenu } from "./RibbonContextMenu";
import { RibbonGroup } from "./RibbonGroup";
import styles from "./Ribbon.module.css";

/** Which ribbon tabs make sense for each document kind — a Drawing has no feature tree or
 * sketches of its own to drive Sketch/Features/Inspect, and a Part has no sheet for
 * Drawing's own tab. "Home" (New/Open/Save/Undo/.../Zoom) applies to every kind. */
const TABS_BY_KIND: Record<DocumentKind, ReadonlySet<string>> = {
  part: new Set(["home", "sketch", "features", "inspect"]),
  assembly: new Set(["home", "assembly"]),
  drawing: new Set(["home", "drawing"]),
};

/**
 * Command manager. Tabs and groups come entirely from `RIBBON_TABS`, filtered to the
 * active document's kind; this component only owns which tab is showing and whether the
 * command surface is collapsed.
 */
export function Ribbon() {
  const documentKind = useDocumentStore((state) => state.document.kind);
  const tabs = RIBBON_TABS.filter((tab) => TABS_BY_KIND[documentKind].has(tab.id));

  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const isSketchMode = useSketchStore(selectIsSketchMode);
  const { t } = useTranslation();

  // Switching to a document whose kind doesn't offer the tab that was showing (e.g. Sketch,
  // while looking at a Drawing) falls back to the first tab that does rather than rendering
  // a stale, now-hidden one.
  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTabId)) setActiveTabId(tabs[0].id);
  }, [tabs, activeTabId]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  const handleInvoke = (item: RibbonItem) => {
    if (!runCommand(item.id)) {
      // Commands still without an implementation report themselves rather than
      // failing silently, which keeps the roadmap visible while working in the app.
      console.info(`[command] ${item.id} is not implemented yet`);
    }
  };

  return (
    <div
      className={styles.ribbon}
      data-testid="ribbon"
      onContextMenu={(event) => {
        event.preventDefault();
        setContextMenuPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className={styles.tabStrip}>
        <div className={styles.tabList} role="tablist" aria-label="Command categories">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`ribbon-tab-${tab.id}`}
              aria-controls={`ribbon-panel-${tab.id}`}
              aria-selected={tab.id === activeTabId}
              className={styles.tab}
              onClick={() => {
                setActiveTabId(tab.id);
                setIsCollapsed(false);
              }}
            >
              {t(tab.id, tab.label)}
            </button>
          ))}
        </div>

        <div className={styles.tabSpacer} />

        <button
          type="button"
          className={styles.collapseButton}
          title={isCollapsed ? "Expand the ribbon" : "Collapse the ribbon"}
          aria-expanded={!isCollapsed}
          onClick={() => setIsCollapsed((collapsed) => !collapsed)}
        >
          {isCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
      </div>

      <div
        role="tabpanel"
        id={`ribbon-panel-${activeTab.id}`}
        aria-labelledby={`ribbon-tab-${activeTab.id}`}
        className={isCollapsed ? styles.panelCollapsed : styles.panel}
      >
        {activeTab.groups.map((group) => (
          <RibbonGroup
            key={group.id}
            group={{
              ...group,
              // A command is live once it is registered and applicable to the current
              // mode, so the ribbon reflects both what is built and what makes sense now.
              // "New Sketch" is hidden rather than merely disabled while already inside a
              // sketch: a greyed-out large button next to "Exit Sketch"/"Select" reads as a
              // redundant control rather than a clear affordance.
              items: group.items
                .filter((item) => !(isSketchMode && item.id === "sketch.new"))
                .map((item) => ({
                  ...item,
                  enabled: isCommandAvailable(item.id, isSketchMode),
                })),
            }}
            onInvoke={handleInvoke}
          />
        ))}
      </div>

      {contextMenuPosition && (
        <RibbonContextMenu position={contextMenuPosition} onClose={() => setContextMenuPosition(null)} />
      )}
    </div>
  );
}
