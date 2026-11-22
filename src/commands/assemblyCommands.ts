import { openFile } from "@/io/files";
import { PART_FILE_EXTENSION, partBaseName } from "@/io/partFiles";
import { loadPartMesh, type LoadedPartMesh } from "@/kernel/componentLoader";
import { activeTabIdNow, selectComponentNow, sourceKeyOf, useAssemblyStore } from "@/state/assemblyStore";
import { useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";

/**
 * Assembly commands. Components reference saved Part files the same way a Drawing's
 * `sourcePart` does; the picked file's bytes are built straight away (and seeded into
 * `assemblyStore`) so a component renders even when the browser fallback gave no path to
 * re-read it from later.
 */

/** Picks and builds a Part file, or reports why not. Returns null when cancelled/failed or
 * when the user switched to another tab meanwhile. */
async function pickPart(
  tabId: string,
  failureLabel: string,
): Promise<{ name: string; path: string | null; loaded: LoadedPartMesh } | null> {
  const { showToast } = useGeometryStore.getState();
  try {
    const picked = await openFile([PART_FILE_EXTENSION, "json"]);
    if (!picked) return null;
    showToast(`Loading ${picked.name}…`, 15000);
    const loaded = await loadPartMesh(new TextDecoder().decode(picked.data), picked.name);
    if (activeTabIdNow() !== tabId) {
      showToast(`${failureLabel} cancelled because the active document changed`);
      return null;
    }
    return { name: picked.name, path: picked.path, loaded };
  } catch (error) {
    showToast(`${failureLabel} failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
    return null;
  }
}

export async function runInsertComponent(): Promise<void> {
  const { document } = useDocumentStore.getState();
  if (document.kind !== "assembly") return;
  const tabId = activeTabIdNow();

  const picked = await pickPart(tabId, "Insert Component");
  if (!picked) return;

  const source = { fileName: picked.name, path: picked.path };
  const id = useDocumentStore.getState().addComponent(source, partBaseName(picked.name));
  if (!id) return;
  useAssemblyStore.getState().seedComponent(tabId, id, sourceKeyOf(source), picked.loaded.mesh);
  selectComponentNow(id);
  useGeometryStore.getState().showToast(`Inserted ${picked.name}`);
}

/** Points a component at a different (moved, renamed, or re-picked) Part file. */
export async function runRelinkComponent(componentId: string): Promise<void> {
  const { document } = useDocumentStore.getState();
  if (!document.assembly?.components.some((c) => c.id === componentId)) return;
  const tabId = activeTabIdNow();

  const picked = await pickPart(tabId, "Relink");
  if (!picked) return;

  const source = { fileName: picked.name, path: picked.path };
  useDocumentStore.getState().updateComponent(componentId, { source });
  useAssemblyStore.getState().seedComponent(tabId, componentId, sourceKeyOf(source), picked.loaded.mesh);
  useGeometryStore.getState().showToast(`Relinked to ${picked.name}`);
}

/** Re-reads every component's Part file — after editing and saving a part in its own tab. */
export function runUpdateComponents(): void {
  const { document } = useDocumentStore.getState();
  const components = document.assembly?.components;
  if (!components) return;
  useAssemblyStore.getState().refresh(activeTabIdNow(), components);
  useGeometryStore.getState().showToast("Updating components…");
}
