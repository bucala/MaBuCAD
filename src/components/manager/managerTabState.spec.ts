import { describe, expect, it } from "vitest";

import { INITIAL_MANAGER_TAB_STATE, syncManagerCommands } from "./managerTabState";

const NONE = { sketch: false, inspect: null, featureEditId: null };

describe("manager tab takeover", () => {
  it("leaves browsing alone when no command starts", () => {
    expect(syncManagerCommands(INITIAL_MANAGER_TAB_STATE, NONE)).toBe(INITIAL_MANAGER_TAB_STATE);
  });

  it.each([
    { ...NONE, sketch: true },
    { ...NONE, inspect: "measure" },
    { ...NONE, featureEditId: "extrude" },
  ])("opens properties for a command and restores the previous tab", (commands) => {
    const start = { ...INITIAL_MANAGER_TAB_STATE, activeTab: "configurations" as const };
    const editing = syncManagerCommands(start, commands);
    expect(editing).toMatchObject({ activeTab: "properties", returnTab: "configurations" });
    expect(syncManagerCommands(editing, NONE)).toMatchObject({ activeTab: "configurations", returnTab: null });
  });

  it("keeps the first return tab until all overlapping commands close", () => {
    const edit = syncManagerCommands(INITIAL_MANAGER_TAB_STATE, { ...NONE, featureEditId: "extrude" });
    const both = syncManagerCommands(edit, { ...edit.commands, inspect: "measure" });
    const inspectOnly = syncManagerCommands(both, { ...NONE, inspect: "measure" });
    expect(inspectOnly).toMatchObject({ activeTab: "properties", returnTab: "features" });
    expect(syncManagerCommands(inspectOnly, NONE).activeTab).toBe("features");
  });

  it("respects a manual tab choice when a command ends", () => {
    const edit = syncManagerCommands(INITIAL_MANAGER_TAB_STATE, { ...NONE, featureEditId: "extrude" });
    const manual = { ...edit, activeTab: "configurations" as const, returnTab: null };
    expect(syncManagerCommands(manual, NONE)).toMatchObject({ activeTab: "configurations", returnTab: null });
  });

  it("opens a new command even when another command remains active after a manual choice", () => {
    const edit = syncManagerCommands(INITIAL_MANAGER_TAB_STATE, { ...NONE, featureEditId: "extrude" });
    const manual = { ...edit, activeTab: "configurations" as const, returnTab: null };
    const inspect = syncManagerCommands(manual, { ...manual.commands, inspect: "measure" });
    expect(inspect).toMatchObject({ activeTab: "properties", returnTab: "configurations" });
  });

  it("does not treat a partial close as a new command", () => {
    const both = syncManagerCommands(INITIAL_MANAGER_TAB_STATE, { ...NONE, inspect: "measure", featureEditId: "extrude" });
    const manual = { ...both, activeTab: "features" as const, returnTab: null };
    expect(syncManagerCommands(manual, { ...NONE, inspect: "measure" })).toMatchObject({
      activeTab: "features", returnTab: null,
    });
  });
});
