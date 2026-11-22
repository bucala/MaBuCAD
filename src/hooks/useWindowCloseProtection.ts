import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

import { requestWorkspaceClose, shouldWarnBeforeUnload } from "@/commands/closeDocuments";

export function useWindowCloseProtection(): void {
  useEffect(() => {
    if (isTauri()) {
      let disposed = false;
      const subscription = getCurrentWindow().onCloseRequested((event) => {
        if (disposed || requestWorkspaceClose()) event.preventDefault();
      });
      void subscription.catch(console.error);
      return () => {
        disposed = true;
        void subscription.then((stop) => stop()).catch(console.error);
      };
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldWarnBeforeUnload()) return;
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
}
