import { Line } from "@react-three/drei";

import { useViewportStore } from "@/state/viewportStore";

import { AXIS_COLORS, ORIGIN_AXIS_LENGTH as LEN } from "../constants";

const AXES = [
  { key: "x", color: AXIS_COLORS.x, points: [[-LEN, 0, 0], [LEN, 0, 0]] },
  { key: "y", color: AXIS_COLORS.y, points: [[0, -LEN, 0], [0, LEN, 0]] },
  { key: "z", color: AXIS_COLORS.z, points: [[0, 0, -LEN], [0, 0, LEN]] },
] as const satisfies readonly {
  key: string;
  color: string;
  points: readonly (readonly [number, number, number])[];
}[];

/**
 * Origin triad at the intersection of the three default planes.
 *
 * Axis colours match the swatches in the status bar gizmo so the two read as the same
 * coordinate system.
 */
export function Origin() {
  const visible = useViewportStore((state) => state.referenceGeometryVisible);
  if (!visible) return null;

  return (
    <group>
      {AXES.map((axis) => (
        <Line
          key={axis.key}
          points={axis.points.map((point) => [...point] as [number, number, number])}
          color={axis.color}
          lineWidth={1.5}
          // Decorative only: the triad must never intercept a pick meant for geometry.
          raycast={() => null}
        />
      ))}

      <mesh raycast={() => null}>
        <sphereGeometry args={[LEN * 0.055, 12, 12]} />
        <meshBasicMaterial color="#9a9a9a" />
      </mesh>
    </group>
  );
}
