import { useEffect } from "react";

import { useAssemblyStore } from "@/state/assemblyStore";
import { useDocumentStore } from "@/state/documentStore";
import { useWorkspaceStore } from "@/state/workspaceStore";

/** Keeps the active Assembly tab's loaded component geometry in step with its component
 * list: inserting, relinking or un-suppressing a component loads it; deleting one drops it. */
export function useAssemblySync(): void {
  const tabId = useWorkspaceStore((state) => state.activeId);
  const components = useDocumentStore((state) => state.document.assembly?.components);

  useEffect(() => {
    if (components) useAssemblyStore.getState().sync(tabId, components);
  }, [tabId, components]);
}
