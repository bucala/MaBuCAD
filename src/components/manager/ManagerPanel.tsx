import { useEffect, useState } from "react";
import { ListTree, Settings2, SlidersHorizontal } from "lucide-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { InspectPanel } from "@/components/property/InspectPanel";
import { SketchPanel } from "@/components/property/SketchPanel";
import { useTranslation } from "@/i18n/useTranslation";
import { useDocumentStore } from "@/state/documentStore";
import { useInspectStore } from "@/state/inspectStore";
import { selectIsSketchMode, useSketchStore } from "@/state/sketchStore";

import { ConfigurationManager } from "@/components/manager/ConfigurationManager";
import { FeatureTree } from "@/components/tree/FeatureTree";
import { PropertyManager } from "@/components/property/PropertyManager";
import type { ManagerTabId } from "@/types/ui";

import { INITIAL_MANAGER_TAB_STATE, syncManagerCommands } from "./managerTabState";
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
  const [tabState, setTabState] = useState(INITIAL_MANAGER_TAB_STATE);
  const { activeTab } = tabState;
  const isSketchMode = useSketchStore(selectIsSketchMode);
  const inspectTool = useInspectStore((state) => state.activeTool);
  const closeInspect = useInspectStore((state) => state.closeInspect);
  const featureEditId = useDocumentStore((state) => state.featureEdit?.featureId ?? null);
  const { t } = useTranslation();
  // Commands take over the properties slot; ordinary selection never switches tabs.
  useEffect(() => {
    setTabState((state) => syncManagerCommands(state, {
      sketch: selectIsSketchMode(useSketchStore.getState()),
      inspect: useInspectStore.getState().activeTool,
      featureEditId: useDocumentStore.getState().featureEdit?.featureId ?? null,
    }));
  }, [isSketchMode, inspectTool, featureEditId]);

  const pickTab = (id: ManagerTabId) => {
    setTabState((state) => ({ ...state, activeTab: id, returnTab: null }));
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
        {activeTab === "properties" && (
          <ErrorBoundary
            message={t(
              "managerPanel.crashed",
              "This panel hit an unexpected error and had to stop. Your model is unaffected — click below to close it.",
            )}
            resetLabel={t("managerPanel.crashedReset", "Close panel")}
            onReset={closeInspect}
          >
            {isSketchMode ? <SketchPanel /> : inspectTool ? <InspectPanel /> : <PropertyManager />}
          </ErrorBoundary>
        )}
        {activeTab === "configurations" && <ConfigurationManager />}
      </div>
    </div>
  );
}
