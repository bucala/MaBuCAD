import { useEffect, useState } from "react";
import { ListTree, Settings2, SlidersHorizontal } from "lucide-react";

import { SketchPanel } from "@/components/property/SketchPanel";
import { selectIsSketchMode, useSketchStore } from "@/state/sketchStore";

import { ConfigurationManager } from "@/components/manager/ConfigurationManager";
import { FeatureTree } from "@/components/tree/FeatureTree";
import { PropertyManager } from "@/components/property/PropertyManager";
import type { ManagerTabId } from "@/types/ui";

import styles from "./ManagerPanel.module.css";

const TABS: { id: ManagerTabId; label: string; icon: typeof ListTree }[] = [
  { id: "features", label: "Feature Manager", icon: ListTree },
  { id: "properties", label: "Property Manager", icon: SlidersHorizontal },
  { id: "configurations", label: "Configurations", icon: Settings2 },
];

/**
 * The left dock. Feature tree, property manager and configurations share one panel and
 * switch by tab, the way SolidWorks stacks its managers rather than showing them at once.
 */
export function ManagerPanel() {
  const [activeTab, setActiveTab] = useState<ManagerTabId>("features");
  const isSketchMode = useSketchStore(selectIsSketchMode);

  // Opening a sketch swings the panel to the property manager, where the sketch tools
  // live — the same thing SolidWorks does when a command takes over.
  useEffect(() => {
    if (isSketchMode) setActiveTab("properties");
  }, [isSketchMode]);

  return (
    <div className={styles.panel}>
      <div className={styles.tabs} role="tablist" aria-label="Manager panels">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`manager-tab-${id}`}
            aria-controls="manager-content"
            aria-selected={activeTab === id}
            title={label}
            className={styles.tab}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={16} strokeWidth={1.75} />
          </button>
        ))}
      </div>

      <div
        className={styles.content}
        role="tabpanel"
        id="manager-content"
        aria-labelledby={`manager-tab-${activeTab}`}
      >
        {activeTab === "features" && <FeatureTree />}
        {activeTab === "properties" && (isSketchMode ? <SketchPanel /> : <PropertyManager />)}
        {activeTab === "configurations" && <ConfigurationManager />}
      </div>
    </div>
  );
}
