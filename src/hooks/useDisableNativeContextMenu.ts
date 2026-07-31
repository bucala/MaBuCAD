import { useEffect } from "react";

/**
 * Suppresses the browser/WebView's own right-click menu (Back/Reload/Save As/Print/
 * Inspect/...) everywhere except inside an editable form field, where it's still useful
 * for Cut/Copy/Paste. A desktop CAD app never shows that menu — every right-click either
 * opens one of this app's own context menus (the sketch canvas, a viewport plane or
 * solid, a Feature Manager row) or does nothing, never the host browser's default.
 */
export function useDisableNativeContextMenu() {
  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(input|textarea)$/i.test(target.tagName)) return;
      event.preventDefault();
    };

    window.addEventListener("contextmenu", handleContextMenu);
    return () => window.removeEventListener("contextmenu", handleContextMenu);
  }, []);
}
