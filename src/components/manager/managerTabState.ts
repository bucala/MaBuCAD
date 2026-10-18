import type { ManagerTabId } from "@/types/ui";

interface ManagerCommands {
  sketch: boolean;
  inspect: string | null;
  featureEditId: string | null;
}

export interface ManagerTabState {
  activeTab: ManagerTabId;
  returnTab: ManagerTabId | null;
  commands: ManagerCommands;
}

export const INITIAL_MANAGER_TAB_STATE: ManagerTabState = {
  activeTab: "features",
  returnTab: null,
  commands: { sketch: false, inspect: null, featureEditId: null },
};

/** Only a newly started command takes over the panel. Selection and a command ending
 * while another stays active must not override a tab the user explicitly chose. */
export function syncManagerCommands(state: ManagerTabState, commands: ManagerCommands): ManagerTabState {
  const previous = state.commands;
  if (commands.sketch === previous.sketch && commands.inspect === previous.inspect &&
      commands.featureEditId === previous.featureEditId) return state;
  const started = (commands.sketch && !previous.sketch) ||
    (commands.inspect !== null && commands.inspect !== previous.inspect) ||
    (commands.featureEditId !== null && commands.featureEditId !== previous.featureEditId);
  const active = commands.sketch || commands.inspect !== null || commands.featureEditId !== null;
  return {
    commands,
    activeTab: started ? "properties" : !active && state.returnTab ? state.returnTab : state.activeTab,
    returnTab: !active ? null : started && state.activeTab !== "properties"
      ? state.returnTab ?? state.activeTab : state.returnTab,
  };
}
