import { useEffect } from "react";

import { useDocumentStore } from "@/state/documentStore";
import { useDrawingToolStore } from "@/state/drawingToolStore";
import { useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";

/**
 * Escape backs out of whatever is currently active, one level at a time — the same
 * priority order every CAD sketcher uses: cancel the active tool before touching
 * selection, since a half-started draw is more disruptive to lose track of than a
 * selection is.
 *
 * 1. A drawing tool is active → back to Select, discarding pending picks.
 * 2. A relation armed via "click the function first, then pick elements" is waiting on
 *    picks → cancel it, same as it not having been armed at all.
 * 3. A non-Select sketch tool is active → back to Select (an in-progress multi-click
 *    entity like a spline or arc is abandoned, the same as the existing right-click
 *    "finish chain" gesture SketchCanvas.tsx already offers for a *completed* one).
 * 4. A feature create/edit session is open → cancel it, which restores the document to what
 *    it was when the session started (removing the feature entirely if the session created
 *    it). This is the counterpart of the property panel's own Cancel button, and it comes
 *    before clearing the selection for the same reason the sketch tool does: losing an
 *    unwanted half-configured feature matters more than losing a highlight.
 * 5. Otherwise, a sketch or feature selection exists → clear it.
 *
 * Skipped while a form field has focus (an open `<input>`/`<textarea>`/`<select>`) so
 * Escape can do its ordinary "cancel editing this field" job instead — components that
 * need that (the dimension value field) handle their own Escape locally. The one exception
 * is a field inside the property panel: there the field *is* the feature session, so Escape
 * cancels the whole feature rather than just the field.
 */
export function useEscapeToDeselect() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      const target = event.target as HTMLElement | null;
      const inFeaturePanel = target?.closest?.("[data-feature-session]") != null;
      if (target && !inFeaturePanel && /^(input|textarea|select)$/i.test(target.tagName)) return;

      const documentState = useDocumentStore.getState();
      const drawingState = useDrawingToolStore.getState();
      if (documentState.document.kind === "drawing" && drawingState.tool !== "select") {
        drawingState.resetPicking();
        return;
      }

      const sketchState = useSketchStore.getState();
      if (sketchState.activeSketchId) {
        if (sketchState.pendingConstraintKind) {
          sketchState.cancelPendingConstraint();
          return;
        }
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

      if (documentState.featureEdit) {
        target?.blur?.();
        useViewportStore.getState().setEdgePickMode(null);
        useViewportStore.getState().setHolePlacementActive(false);
        documentState.endFeatureEdit("cancel");
        return;
      }

      if (documentState.selectedFeatureIds.length > 0) {
        documentState.clearSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
