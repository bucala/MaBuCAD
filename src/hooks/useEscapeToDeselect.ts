import { useEffect } from "react";

import { useDocumentStore } from "@/state/documentStore";
import { useSketchStore } from "@/state/sketchStore";

/**
 * Escape backs out of whatever is currently active, one level at a time — the same
 * priority order every CAD sketcher uses: cancel the active tool before touching
 * selection, since a half-started draw is more disruptive to lose track of than a
 * selection is.
 *
 * 1. A non-Select sketch tool is active → back to Select (an in-progress multi-click
 *    entity like a spline or arc is abandoned, the same as the existing right-click
 *    "finish chain" gesture SketchCanvas.tsx already offers for a *completed* one).
 * 2. Otherwise, a sketch or feature selection exists → clear it.
 *
 * Skipped while a form field has focus (an open `<input>`/`<textarea>`/`<select>`) so
 * Escape can do its ordinary "cancel editing this field" job instead — components that
 * need that (the dimension value field) handle their own Escape locally.
 */
export function useEscapeToDeselect() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      const target = event.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;

      const sketchState = useSketchStore.getState();
      if (sketchState.activeSketchId) {
        if (sketchState.tool !== "select") {
          sketchState.setTool("select");
          return;
        }
        if (sketchState.selection.length > 0) {
          sketchState.clearSelection();
          return;
        }
        return;
      }

      const documentState = useDocumentStore.getState();
      if (documentState.selectedFeatureIds.length > 0) {
        documentState.clearSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
