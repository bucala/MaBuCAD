import { useEffect } from "react";

import { useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";
import { useSketchStore } from "@/state/sketchStore";

/**
 * Keeps the solid geometry in step with the document.
 *
 * Only features above the rollback bar take part, so rolling back re-evaluates the model
 * rather than merely dimming rows in the tree. Rebuilds are debounced because editing a
 * depth field fires a change per keystroke and each rebuild runs the kernel.
 */
export function useRebuild(): void {
  const document = useDocumentStore((state) => state.document);
  const sketches = useSketchStore((state) => state.sketches);
  const rebuild = useGeometryStore((state) => state.rebuild);

  useEffect(() => {
    const built = document.features.slice(0, document.rollbackIndex);
    const timer = window.setTimeout(() => {
      void rebuild(built, sketches);
    }, 120);

    return () => window.clearTimeout(timer);
  }, [document, sketches, rebuild]);
}
