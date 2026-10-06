import { useEffect, useRef, useState } from "react";
import { ListTree, Settings2, SlidersHorizontal } from "lucide-react";

import { InspectPanel } from "@/components/property/InspectPanel";
import { SketchPanel } from "@/components/property/SketchPanel";
import { useDocumentStore } from "@/state/documentStore";
import { useInspectStore } from "@/state/inspectStore";
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
  const inspectTool = useInspectStore((state) => state.activeTool);
  const featureEditId = useDocumentStore((state) => state.featureEdit?.featureId ?? null);
  // The tab an auto-switch took over from, restored when the reason clears — and cancelled
  // the moment the user picks a tab themselves mid-takeover, since an explicit choice
  // always outranks the pending return.
  const returnTab = useRef<ManagerTabId | null>(null);
  const autoSwitched = useRef(false);

  // A command that owns the properties slot — sketch mode (sketch tools), an Inspect tool
  // (Measure, Appearance) or a feature edit session (new or edited feature, whose
  // OK/Cancel live there) — swings the panel to it, the SolidWorks "command takes over"
  // convention. Plain *selection* deliberately no longer does: clicking tree rows or a
  // viewport plane just selects, so browsing never yanks the panel away mid-task. When the
  // last reason clears, the panel returns to the tab it was taken from.
  const takeover = isSketchMode || Boolean(inspectTool) || Boolean(featureEditId);
  useEffect(() => {
    if (takeover) {
      setActiveTab((current) => {
        if (current !== "properties" && !autoSwitched.current) returnTab.current = current;
        autoSwitched.current = true;
        return "properties";
      });
    } else if (autoSwitched.current) {
      autoSwitched.current = false;
      const target = returnTab.current;
      returnTab.current = null;
      if (target) setActiveTab(target);
    }
  }, [takeover]);

  const pickTab = (id: ManagerTabId) => {
    autoSwitched.current = false;
    returnTab.current = null;
    setActiveTab(id);
  };

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
            onClick={() => pickTab(id)}
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
        {activeTab === "properties" &&
          (isSketchMode ? <SketchPanel /> : inspectTool ? <InspectPanel /> : <PropertyManager />)}
        {activeTab === "configurations" && <ConfigurationManager />}
      </div>
    </div>
  );
}
