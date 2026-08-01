import { Html, Line } from "@react-three/drei";

import { useSketchStore } from "@/state/sketchStore";

import styles from "./SketchDimensions.module.css";

const SNAP_COLOR = "#0f7b0f";
const RING_SEGMENTS = 24;
const RING_RADIUS = 3;

const LABEL: Record<"coincident" | "midpoint" | "tangent", string> = {
  coincident: "Coincident",
  midpoint: "Midpoint",
  tangent: "Tangent",
};

/**
 * "Constrains smart" — a small ring plus label marking whatever relation the point
 * currently being dragged is close enough to (see `sketchStore.ts`'s
 * `dragSnapSuggestion`/`commitDragSnap`), so releasing there is a deliberate choice
 * rather than a surprise. Purely a preview: nothing here is part of the sketch until the
 * drag actually ends on it.
 */
export function DragSnapIndicator() {
  const suggestion = useSketchStore((state) => state.dragSnapSuggestion);
  if (!suggestion) return null;

  const ring = Array.from({ length: RING_SEGMENTS + 1 }, (_, index) => {
    const angle = (index / RING_SEGMENTS) * Math.PI * 2;
    return [
      suggestion.position.x + Math.cos(angle) * RING_RADIUS,
      suggestion.position.y + Math.sin(angle) * RING_RADIUS,
      0.05,
    ] as [number, number, number];
  });

  return (
    <group>
      <Line points={ring} color={SNAP_COLOR} lineWidth={2} raycast={() => null} />
      <Html
        position={[suggestion.position.x, suggestion.position.y + RING_RADIUS + 4, 0.06]}
        center
        zIndexRange={[20, 0]}
        wrapperClass={styles.previewWrapper}
      >
        <div className={styles.preview}>{LABEL[suggestion.kind]}</div>
      </Html>
    </group>
  );
}
