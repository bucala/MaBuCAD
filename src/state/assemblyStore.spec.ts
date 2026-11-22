import { beforeEach, describe, expect, it } from "vitest";

import type { MeshData } from "@/kernel/rebuild";
import type { AssemblyComponent } from "@/types/document";

import { sourceKeyOf, useAssemblyStore } from "./assemblyStore";
import { useWorkspaceStore } from "./workspaceStore";

const mesh = { positions: new Float32Array() } as unknown as MeshData;

function component(id: string, path: string | null = null): AssemblyComponent {
  return {
    id,
    name: `${id}<1>`,
    source: { fileName: "Part.mabucad", path },
    transform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    grounded: false,
  };
}

/** Two open workspace tabs to key geometry by. */
function openTwoTabs(): [string, string] {
  useWorkspaceStore.getState().newDocument("assembly");
  useWorkspaceStore.getState().newDocument("assembly");
  const ids = useWorkspaceStore.getState().sessions.map((session) => session.id);
  return [ids[ids.length - 2]!, ids[ids.length - 1]!];
}

describe("assemblyStore", () => {
  beforeEach(() => useAssemblyStore.setState({ tabs: {}, selection: null }));

  it("keeps a tab's in-session geometry when switching to another tab and back", () => {
    const [a, b] = openTwoTabs();
    const comp = component("comp-1");
    useAssemblyStore.getState().seedComponent(a, comp.id, sourceKeyOf(comp.source), mesh);

    useAssemblyStore.getState().sync(b, []);
    useAssemblyStore.getState().sync(a, [comp]);

    expect(useAssemblyStore.getState().tabs[a]?.[comp.id]).toMatchObject({ status: "ready", mesh });
  });

  it("resolves the same component ids independently per tab (a reopened copy of a document)", () => {
    const [a, b] = openTwoTabs();
    const comp = component("comp-1");
    useAssemblyStore.getState().seedComponent(a, comp.id, sourceKeyOf(comp.source), mesh);

    // Tab b holds a reopened copy with the same component id but no bytes in hand.
    useAssemblyStore.getState().sync(b, [comp]);

    expect(useAssemblyStore.getState().tabs[b]?.[comp.id]?.status).toBe("missing");
    expect(useAssemblyStore.getState().tabs[a]?.[comp.id]?.status).toBe("ready");
  });

  it("drops deleted components and clears a selection that belongs to another tab", () => {
    const [a, b] = openTwoTabs();
    const comp = component("comp-1");
    useAssemblyStore.getState().seedComponent(a, comp.id, sourceKeyOf(comp.source), mesh);
    useAssemblyStore.getState().selectComponent(a, comp.id);

    useAssemblyStore.getState().sync(b, []);
    expect(useAssemblyStore.getState().selection).toBeNull();

    useAssemblyStore.getState().sync(a, []);
    expect(useAssemblyStore.getState().tabs[a]).toEqual({});
  });

  it("forgets the geometry of closed tabs", () => {
    const [a, b] = openTwoTabs();
    const comp = component("comp-1");
    useAssemblyStore.getState().seedComponent(a, comp.id, sourceKeyOf(comp.source), mesh);
    useAssemblyStore.setState((state) => ({ tabs: { ...state.tabs, "closed-tab": { x: state.tabs[a]![comp.id]! } } }));

    useAssemblyStore.getState().sync(b, []);
    expect(useAssemblyStore.getState().tabs["closed-tab"]).toBeUndefined();
    expect(useAssemblyStore.getState().tabs[a]).toBeDefined();
  });
});
