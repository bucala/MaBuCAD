import { useEffect } from "react";
import { Html, Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";

import { useSettingsStore } from "@/state/settingsStore";
import { useViewportStore } from "@/state/viewportStore";

import { AXIS_COLORS, ORIGIN_AXIS_LENGTH as LEN } from "../constants";
import styles from "./nonInteractiveLabel.module.css";

const AXES = [
  { key: "x", label: "X", color: AXIS_COLORS.x, points: [[-LEN, 0, 0], [LEN, 0, 0]] },
  { key: "y", label: "Y", color: AXIS_COLORS.y, points: [[0, -LEN, 0], [0, LEN, 0]] },
  { key: "z", label: "Z", color: AXIS_COLORS.z, points: [[0, 0, -LEN], [0, 0, LEN]] },
] as const satisfies readonly {
  key: string;
  label: string;
  color: string;
  points: readonly (readonly [number, number, number])[];
}[];

/**
 * Origin triad at the intersection of the three default planes.
 *
 * Axis colours match the swatches in the status bar gizmo so the two read as the same
 * coordinate system. Visibility has two independent switches: the per-document
 * `hiddenFeatureIds` toggle on the Origin row in the feature tree (a one-off override,
 * like hiding any other feature), and the persisted `originIndicatorVisible` app setting
 * (Settings ▸ Display ▸ 3D Navigation) — either one hides it.
 */
export function Origin() {
  const isHiddenInDocument = useViewportStore((state) => state.hiddenFeatureIds.includes("origin"));
  const originIndicatorVisible = useSettingsStore((state) => state.originIndicatorVisible);
  const axisLabelsVisible = useSettingsStore((state) => state.axisLabelsVisible);
  const invalidate = useThree((state) => state.invalidate);

  // Every source of visibility here — the feature tree's own hide/show and the two
  // Settings ▸ Display toggles — lives outside this component's render tree (the DOM
  // tree or the Settings dialog, not a `useFrame`-driven animation), so under
  // `frameloop="demand"` a change has to ask for a fresh paint explicitly or the last
  // frame just keeps showing the old state indefinitely.
  useEffect(() => {
    invalidate();
  }, [isHiddenInDocument, originIndicatorVisible, axisLabelsVisible, invalidate]);

  if (isHiddenInDocument || !originIndicatorVisible) return null;

  return (
    <group>
      {AXES.map((axis) => (
        <group key={axis.key}>
          <Line
            points={axis.points.map((point) => [...point] as [number, number, number])}
            color={axis.color}
            lineWidth={1.5}
            // Decorative only: the triad must never intercept a pick meant for geometry.
            raycast={() => null}
          />
          {axisLabelsVisible && (
            <Html
              position={axis.points[1] as [number, number, number]}
              center
              zIndexRange={[10, 0]}
              wrapperClass={styles.noPointerEvents}
            >
              <span style={{ color: axis.color, fontSize: 11, fontWeight: 700 }}>{axis.label}</span>
            </Html>
          )}
        </group>
      ))}

      <mesh raycast={() => null}>
        <sphereGeometry args={[LEN * 0.055, 12, 12]} />
        <meshBasicMaterial color="#9a9a9a" />
      </mesh>
    </group>
  );
}
