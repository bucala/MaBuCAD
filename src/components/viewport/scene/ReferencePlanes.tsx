import { useState } from "react";
import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { DoubleSide } from "three";

import { selectSelectedPlaneId, useDocumentStore } from "@/state/documentStore";
import { selectIsSketchMode, useSketchStore } from "@/state/sketchStore";

import { useClickGuard } from "../controls/useClickGuard";
import { PLANE_SIZE, REFERENCE_PLANES, type ReferencePlaneId } from "../constants";

const HALF = PLANE_SIZE / 2;

/** Closed outline of the square, drawn on the plane's own local XY. */
const BORDER_POINTS: [number, number, number][] = [
  [-HALF, -HALF, 0],
  [HALF, -HALF, 0],
  [HALF, HALF, 0],
  [-HALF, HALF, 0],
  [-HALF, -HALF, 0],
];

/**
 * The Front, Top and Right planes every new document starts with.
 *
 * Each is a translucent square with a solid border, so the plane still reads when it is
 * viewed edge-on and the fill collapses to nothing.
 *
 * Selection lives in the document store rather than locally, so picking a plane here
 * highlights its row in the feature tree and selecting that row highlights the plane —
 * the plane ids in `constants.ts` deliberately match the default feature ids.
 */
export function ReferencePlanes() {
  const [hoveredId, setHoveredId] = useState<ReferencePlaneId | null>(null);
  const isPick = useClickGuard();

  const selectedId = useDocumentStore(selectSelectedPlaneId);
  const selectFeature = useDocumentStore((state) => state.selectFeature);
  const onSelect = (id: ReferencePlaneId | null) => selectFeature(id);

  /**
   * A sketch is drawn on a plane, so the plane sits directly under the drawing surface and
   * would otherwise intercept every click meant for the sketch. Planes stop being pickable
   * — and fade back — while a sketch is open.
   */
  const isSketchMode = useSketchStore(selectIsSketchMode);

  return (
    <group
      // Clicking empty space clears the selection, as in any CAD graphics area. Fires
      // when a click lands in the scene but misses everything in this group.
      onPointerMissed={(event) => {
        if (isPick({ nativeEvent: event })) {
          onSelect(null);
        }
      }}
    >
      {REFERENCE_PLANES.map((plane) => {
        const isSelected = selectedId === plane.id;
        const isHovered = hoveredId === plane.id;

        const handleOver = (event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          setHoveredId(plane.id);
        };

        const handleOut = () => {
          setHoveredId((current) => (current === plane.id ? null : current));
        };

        const handleClick = (event: ThreeEvent<MouseEvent>) => {
          // Ignore the click that ends an orbit or pan gesture over this plane.
          if (!isPick(event)) return;
          event.stopPropagation();
          onSelect(isSelected ? null : plane.id);
        };

        return (
          <group key={plane.id} rotation={plane.rotation}>
            <mesh
              name={plane.label}
              onPointerOver={isSketchMode ? undefined : handleOver}
              onPointerOut={isSketchMode ? undefined : handleOut}
              onClick={isSketchMode ? undefined : handleClick}
              raycast={isSketchMode ? () => null : undefined}
              renderOrder={-1}
            >
              <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
              <meshBasicMaterial
                color={plane.color}
                transparent
                opacity={isSketchMode ? 0.02 : isSelected ? 0.16 : isHovered ? 0.1 : 0.05}
                side={DoubleSide}
                depthWrite={false}
              />
            </mesh>

            <Line
              points={BORDER_POINTS}
              color={plane.color}
              lineWidth={isSelected ? 2 : 1}
              transparent
              opacity={isSketchMode ? 0.2 : isSelected ? 1 : isHovered ? 0.85 : 0.5}
              raycast={() => null}
            />
          </group>
        );
      })}
    </group>
  );
}
