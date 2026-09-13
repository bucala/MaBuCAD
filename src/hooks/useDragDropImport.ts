import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { runImportPath } from "@/commands/interchange";

/** What a drop imports — STEP/STL, the same set the Import command's dialog filter allows.
 * A dropped `.mabucad` is deliberately not auto-opened (File ▸ Open owns documents, and
 * opening one would replace tab state in a way a passive drop shouldn't), and anything
 * else is ignored rather than reported: a drop is an implicit gesture, not one the user
 * expects feedback from. */
const DROP_IMPORT_PATTERN = /\.(step|stp|stl)$/i;

/**
 * Wires the Rust side's drag-drop announcements (files dropped onto the main window —
 * see `src-tauri/src/lib.rs`'s window event handler) into the normal import flow.
 * Browser-only sessions get nothing: there is no Rust side to report a real path.
 */
export function useDragDropImport(): void {
  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<{ name: string; path: string }>("file-dropped", (event) => {
      const { name, path } = event.payload;
      if (!DROP_IMPORT_PATTERN.test(name)) return;
      void runImportPath(path, name);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
