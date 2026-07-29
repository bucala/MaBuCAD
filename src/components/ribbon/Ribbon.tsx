import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { RIBBON_TABS } from "@/commands/ribbonConfig";
import type { RibbonItem } from "@/types/ui";

import { RibbonGroup } from "./RibbonGroup";
import styles from "./Ribbon.module.css";

/**
 * Command manager. Tabs and groups come entirely from `RIBBON_TABS`; this component
 * only owns which tab is showing and whether the command surface is collapsed.
 */
export function Ribbon() {
  const [activeTabId, setActiveTabId] = useState(RIBBON_TABS[0].id);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const activeTab = RIBBON_TABS.find((tab) => tab.id === activeTabId) ?? RIBBON_TABS[0];

  const handleInvoke = (item: RibbonItem) => {
    // Commands are registered in later steps; until then a click is a no-op.
    console.info(`[command] ${item.id}`);
  };

  return (
    <div className={styles.ribbon}>
      <div className={styles.tabStrip}>
        <div className={styles.tabList} role="tablist" aria-label="Command categories">
          {RIBBON_TABS.map((tab) => (
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
              {tab.label}
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
          <RibbonGroup key={group.id} group={group} onInvoke={handleInvoke} />
        ))}
      </div>
    </div>
  );
}
