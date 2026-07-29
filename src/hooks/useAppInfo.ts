import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
}

/**
 * Reads build identity from the Rust backend.
 *
 * Doubles as the end-to-end check that the IPC bridge works: if the status bar shows a
 * version, `invoke` reached Rust and came back. Returns `null` when running in a plain
 * browser (`vite dev` without Tauri), where there is no backend to ask.
 */
export function useAppInfo(): AppInfo | null {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let cancelled = false;

    invoke<AppInfo>("get_app_info")
      .then((info) => {
        if (!cancelled) {
          setAppInfo(info);
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to read application info from the backend", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return appInfo;
}
