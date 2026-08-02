import { Html, Line } from "@react-three/drei";

import { AXIS_COLORS } from "../constants";

/** Arm length in the `GizmoHelper`'s own pixel-ish local space (see `GizmoViewport`'s
 * `scale={40}` for the equivalent drei convention this replaces). */
const ARM_LENGTH = 32;
const HEAD_LENGTH = 7;
const HEAD_WIDTH = 3;

const AXES = [
  { key: "x", label: "X", color: AXIS_COLORS.x, dir: [1, 0, 0] as const },
  { key: "y", label: "Y", color: AXIS_COLORS.y, dir: [0, 1, 0] as const },
  { key: "z", label: "Z", color: AXIS_COLORS.z, dir: [0, 0, 1] as const },
];

/** An arrowhead as two short strokes splayed off the shaft, in whichever plane the other
 * two axes span — the same "V" a hand-drawn arrow uses, rather than a solid cone (a
 * fourth mesh per axis, and one more material to keep in sync with the shaft colour). */
function arrowHeadPoints(dir: readonly [number, number, number]): [number, number, number][][] {
  const tip: [number, number, number] = [dir[0] * ARM_LENGTH, dir[1] * ARM_LENGTH, dir[2] * ARM_LENGTH];
  const backX = dir[0] * (ARM_LENGTH - HEAD_LENGTH);
  const backY = dir[1] * (ARM_LENGTH - HEAD_LENGTH);
  const backZ = dir[2] * (ARM_LENGTH - HEAD_LENGTH);

  // Perpendicular offset for the splay: X's arms spread in Y, Y's in X, Z's in X — any
  // axis perpendicular to `dir` works, since the gizmo is always viewed near end-on.
  const perp: [number, number, number] = dir[0] !== 0 ? [0, HEAD_WIDTH, 0] : [HEAD_WIDTH, 0, 0];

  return [
    [tip, [backX + perp[0], backY + perp[1], backZ + perp[2]]],
    [tip, [backX - perp[0], backY - perp[1], backZ - perp[2]]],
  ];
}

/**
 * Bottom-left orientation gizmo: three coloured arrows with a plain letter label at each
 * tip, no filled circle badge behind the text — replaces drei's `GizmoViewport`, whose
 * `AxisHead` always draws the letter inside a solid sprite disc with no way to opt out of
 * just the disc while keeping the label (`hideAxisHeads` drops the whole head, label
 * included). Purely a visual orientation reference (see `Scene.tsx`'s own note on why this
 * gizmo has no click-to-align behaviour), so no picking/hover logic is needed here either.
 */
export function LiveAxisGizmo() {
  return (
    <group>
      {AXES.map((axis) => {
        const tip: [number, number, number] = [axis.dir[0] * ARM_LENGTH, axis.dir[1] * ARM_LENGTH, axis.dir[2] * ARM_LENGTH];
        const labelPosition: [number, number, number] = [tip[0] * 1.18, tip[1] * 1.18, tip[2] * 1.18];

        return (
          <group key={axis.key}>
            <Line points={[[0, 0, 0], tip]} color={axis.color} lineWidth={2} />
            {arrowHeadPoints(axis.dir).map((points, index) => (
              <Line key={index} points={points} color={axis.color} lineWidth={2} />
            ))}
            <Html position={labelPosition} center zIndexRange={[10, 0]}>
              <span style={{ color: axis.color, fontSize: 12, fontWeight: 700, pointerEvents: "none" }}>
                {axis.label}
              </span>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
