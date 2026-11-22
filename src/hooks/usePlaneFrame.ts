import { useMemo } from "react";

import { planeFrame, type PlaneFrame } from "@/sketch/planeBasis";
import { useDocumentStore } from "@/state/documentStore";

/**
 * The live placement of a sketch plane in the open document — a default plane, or a user
 * reference plane whose offset/flip/base can change while a sketch on it is open or shown.
 * Re-resolves whenever the document's feature list changes.
 */
export function usePlaneFrame(planeId: string): PlaneFrame {
  const features = useDocumentStore((state) => state.document.features);
  return useMemo(() => planeFrame(planeId, features), [planeId, features]);
}
