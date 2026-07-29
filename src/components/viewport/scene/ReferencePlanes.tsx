import { useState } from "react";
import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { DoubleSide } from "three";

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

interface ReferencePlanesProps {
  selectedId: ReferencePlaneId | null;
  onSelect: (id: ReferencePlaneId | null) => void;
}

/**
 * The Front, Top and Right planes every new document starts with.
 *
 * Each is a translucent square with a solid border, so the plane still reads when it is
 * viewed edge-on and the fill collapses to nothing.
 */
export function ReferencePlanes({ selectedId, onSelect }: ReferencePlanesProps) {
  const [hoveredId, setHoveredId] = useState<ReferencePlaneId | null>(null);
  const isPick = useClickGuard();

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
              onPointerOver={handleOver}
              onPointerOut={handleOut}
              onClick={handleClick}
              renderOrder={-1}
            >
              <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
              <meshBasicMaterial
                color={plane.color}
                transparent
                opacity={isSelected ? 0.16 : isHovered ? 0.1 : 0.05}
                side={DoubleSide}
                depthWrite={false}
              />
            </mesh>

            <Line
              points={BORDER_POINTS}
              color={plane.color}
              lineWidth={isSelected ? 2 : 1}
              transparent
              opacity={isSelected ? 1 : isHovered ? 0.85 : 0.5}
            />
          </group>
        );
      })}
    </group>
  );
}
