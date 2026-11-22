import { create } from "zustand";

import { readFileAtPath } from "@/io/files";
import { loadPartMesh } from "@/kernel/componentLoader";
import type { MeshData } from "@/kernel/rebuild";
import type { AssemblyComponent } from "@/types/document";

import { useWorkspaceStore } from "./workspaceStore";

/**
 * Display state of open Assemblies' components — loaded meshes and per-component load
 * status. Deliberately not part of the document: geometry is derived from the referenced
 * part files, so it's never saved or undone, only re-derived (`sync`).
 *
 * Keyed by workspace tab, not `document.id`: a document's id is saved in its file, so the
 * same assembly reopened in a second tab carries the same id, and each tab must resolve its
 * components on its own. Per-tab entries also survive switching tabs, so a component whose
 * file can't be re-read (the browser fallback gives no path) keeps rendering when you come
 * back to its tab.
 */

export type ComponentLoadStatus = "loading" | "ready" | "missing" | "error";

export interface ComponentGeometry {
  status: ComponentLoadStatus;
  /** Which source the entry was loaded from — a relink changes it and triggers a reload. */
  sourceKey: string;
  mesh: MeshData | null;
  message?: string;
}

export type TabGeometry = Record<string, ComponentGeometry>;

export function sourceKeyOf(source: AssemblyComponent["source"]): string {
  return `${source.path ?? ""}|${source.fileName}`;
}

const NO_GEOMETRY: TabGeometry = {};

interface AssemblyStore {
  /** Tab id → component id → geometry. */
  tabs: Record<string, TabGeometry>;
  /** The selection belongs to one tab; switching tabs clears it. */
  selection: { tabId: string; componentId: string } | null;
  selectComponent: (tabId: string, componentId: string | null) => void;
  /** Records geometry already in hand — a just-inserted component, whose file was read by
   * the picker, renders immediately even when the browser gave no re-readable path. */
  seedComponent: (tabId: string, componentId: string, sourceKey: string, mesh: MeshData) => void;
  /** Starts loading every unsuppressed component of `tabId` that has no current entry,
   * drops entries for deleted components, and forgets tabs that have been closed. */
  sync: (tabId: string, components: AssemblyComponent[]) => void;
  /** Re-reads every component's file (Update Components) — unchanged files hit the mesh
   * cache, edited ones rebuild. */
  refresh: (tabId: string, components: AssemblyComponent[]) => void;
}

export const useAssemblyStore = create<AssemblyStore>((set, get) => {
  const setEntry = (tabId: string, componentId: string, entry: ComponentGeometry) =>
    set((state) => ({ tabs: { ...state.tabs, [tabId]: { ...state.tabs[tabId], [componentId]: entry } } }));

  const load = async (tabId: string, component: AssemblyComponent, sourceKey: string) => {
    const isCurrent = () => get().tabs[tabId]?.[component.id]?.sourceKey === sourceKey;

    const { path, fileName } = component.source;
    if (!path) {
      setEntry(tabId, component.id, {
        status: "missing",
        sourceKey,
        mesh: null,
        message: `${fileName} needs to be picked again`,
      });
      return;
    }

    let text: string;
    try {
      text = new TextDecoder().decode(await readFileAtPath(path));
    } catch {
      if (isCurrent()) {
        setEntry(tabId, component.id, { status: "missing", sourceKey, mesh: null, message: `${fileName} was not found` });
      }
      return;
    }

    try {
      const { mesh } = await loadPartMesh(text, fileName);
      if (isCurrent()) setEntry(tabId, component.id, { status: "ready", sourceKey, mesh });
    } catch (error) {
      if (isCurrent()) {
        const message = error instanceof Error ? error.message : `${fileName} could not be loaded`;
        setEntry(tabId, component.id, { status: "error", sourceKey, mesh: null, message });
      }
    }
  };

  const sync: AssemblyStore["sync"] = (tabId, components) => {
    const openTabs = new Set(useWorkspaceStore.getState().sessions.map((session) => session.id));
    openTabs.add(tabId);
    const present = new Set(components.map((component) => component.id));
    const current = get().tabs[tabId] ?? {};

    const tabs = Object.fromEntries(Object.entries(get().tabs).filter(([id]) => openTabs.has(id)));
    tabs[tabId] = Object.fromEntries(Object.entries(current).filter(([id]) => present.has(id)));
    const { selection } = get();
    const keepSelection = selection && selection.tabId === tabId && present.has(selection.componentId);
    set({ tabs, selection: keepSelection ? selection : null });

    for (const component of components) {
      if (component.suppressed) continue;
      const sourceKey = sourceKeyOf(component.source);
      if (get().tabs[tabId]?.[component.id]?.sourceKey === sourceKey) continue;
      setEntry(tabId, component.id, { status: "loading", sourceKey, mesh: null });
      void load(tabId, component, sourceKey);
    }
  };

  return {
    tabs: {},
    selection: null,
    selectComponent: (tabId, componentId) => set({ selection: componentId ? { tabId, componentId } : null }),
    seedComponent: (tabId, componentId, sourceKey, mesh) =>
      setEntry(tabId, componentId, { status: "ready", sourceKey, mesh }),
    sync,
    refresh: (tabId, components) => {
      // Components with no re-readable path keep their in-session geometry; everything
      // else is dropped and re-read.
      const readable = new Set(components.filter((c) => c.source.path).map((c) => c.id));
      set((state) => ({
        tabs: {
          ...state.tabs,
          [tabId]: Object.fromEntries(Object.entries(state.tabs[tabId] ?? {}).filter(([id]) => !readable.has(id))),
        },
      }));
      sync(tabId, components);
    },
  };
});

/** The active tab's component geometry. */
export function useActiveComponentGeometry(): TabGeometry {
  const tabId = useWorkspaceStore((state) => state.activeId);
  return useAssemblyStore((state) => state.tabs[tabId] ?? NO_GEOMETRY);
}

/** The active tab's selected component id, or null. */
export function useSelectedComponentId(): string | null {
  const tabId = useWorkspaceStore((state) => state.activeId);
  return useAssemblyStore((state) => (state.selection?.tabId === tabId ? state.selection.componentId : null));
}

/** Non-React access to the active tab's selection (commands, keyboard handlers). */
export function selectedComponentIdNow(): string | null {
  const { selection } = useAssemblyStore.getState();
  return selection?.tabId === useWorkspaceStore.getState().activeId ? selection.componentId : null;
}

/** Selects a component of the active tab (or clears the selection). */
export function selectComponentNow(componentId: string | null): void {
  useAssemblyStore.getState().selectComponent(useWorkspaceStore.getState().activeId, componentId);
}

export function activeTabIdNow(): string {
  return useWorkspaceStore.getState().activeId;
}
