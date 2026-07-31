import { useEffect, useMemo, useState } from "react";
import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { DoubleSide, Vector3 } from "three";

import { planeBasis } from "@/sketch/planeBasis";
import { useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";
import { selectIsSketchMode, useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";
import type { Feature } from "@/types/document";

import { useClickGuard } from "../controls/useClickGuard";
import { AXIS_COLORS, ORIGIN_AXIS_LENGTH, PLANE_SIZE } from "../constants";

const HALF = PLANE_SIZE / 2;
const BORDER_POINTS: [number, number, number][] = [
  [-HALF, -HALF, 0],
  [HALF, -HALF, 0],
  [HALF, HALF, 0],
  [-HALF, HALF, 0],
  [-HALF, -HALF, 0],
];

/** Colour for user-created reference planes — distinct from the RGB Front/Top/Right triad. */
const USER_PLANE_COLOR = "#a06bd0";
const AXIS_HALF_LENGTH = PLANE_SIZE * 0.5;
const POINT_MARKER_RADIUS = ORIGIN_AXIS_LENGTH * 0.09;
const CSYS_AXIS_LENGTH = ORIGIN_AXIS_LENGTH * 0.7;

const REFERENCE_KINDS: ReadonlySet<Feature["kind"]> = new Set([
  "reference-plane",
  "reference-axis",
  "reference-point",
  "reference-csys",
]);

function axisVector(axis: "x" | "y" | "z"): Vector3 {
  if (axis === "x") return new Vector3(1, 0, 0);
  if (axis === "y") return new Vector3(0, 1, 0);
  return new Vector3(0, 0, 1);
}

/**
 * User-created reference geometry from the ribbon's Reference Geometry group: planes, axes,
 * points and coordinate systems.
 *
 * None of these have a picking UI yet (same gap `FeatureParameters.axis`'s doc comment
 * already flags for patterns), so each stands in with the smallest placement that still
 * means something: a plane offsets from a selected default plane along its normal, an axis
 * or point aligns to/offsets along a world axis, and a coordinate system always sits at the
 * origin. They are visual and selectable — hide/show, suppress, delete, right-click menu —
 * the same as the default Front/Top/Right planes, but a reference plane cannot be sketched
 * on yet: the sketch pipeline (`planeBasis.ts`, `SketchScene.tsx`) assumes its plane passes
 * through the origin, which a reference plane offset away from it does not.
 */
export function UserReferenceGeometry() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const isPick = useClickGuard();

  // Reads the raw feature list and rollback index rather than subscribing through
  // `selectBuiltFeatures` directly: that selector slices a fresh array on every call, and
  // subscribing to it here would hand `useSyncExternalStore` a "changed" snapshot on every
  // single render regardless of whether the document actually changed, which is an infinite
  // render loop rather than a mere inefficiency — see `SolidModel.tsx`'s own note on the
  // same trap. `useMemo` only recomputes when the underlying state actually moves.
  const allFeatures = useDocumentStore((state) => state.document.features);
  const rollbackIndex = useDocumentStore((state) => state.document.rollbackIndex);
  const features = useMemo(
    () =>
      allFeatures
        .slice(0, rollbackIndex)
        .filter((feature) => !feature.suppressed && REFERENCE_KINDS.has(feature.kind)),
    [allFeatures, rollbackIndex],
  );
  const selectedFeatureIds = useDocumentStore((state) => state.selectedFeatureIds);
  const selectFeature = useDocumentStore((state) => state.selectFeature);
  const openContextMenu = useDocumentStore((state) => state.openContextMenu);
  const isSketchMode = useSketchStore(selectIsSketchMode);
  const hasSolid = useGeometryStore((state) => state.mesh !== null);
  const hiddenFeatureIds = useViewportStore((state) => state.hiddenFeatureIds);
  const invalidate = useThree((state) => state.invalidate);

  // Same `frameloop="demand"` gap `ReferencePlanes.tsx` fixes for the default planes:
  // hide/show and the solid appearing both change opacity from outside this component's
  // own render loop, so a repaint has to be requested explicitly.
  useEffect(() => {
    invalidate();
  }, [features, hiddenFeatureIds, hasSolid, isSketchMode, selectedFeatureIds, hoveredId, invalidate]);

  if (features.length === 0) return null;

  return (
    <group>
      {features.map((feature) => {
        const isSelected = selectedFeatureIds.includes(feature.id);
        const isHovered = hoveredId === feature.id;
        const isDimmed =
          (hasSolid || hiddenFeatureIds.includes(feature.id)) && !isSketchMode && !isSelected;
        const isInert = isSketchMode || isDimmed;

        const handleOver = (event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          setHoveredId(feature.id);
        };
        const handleOut = () => setHoveredId((current) => (current === feature.id ? null : current));
        const handleClick = (event: ThreeEvent<MouseEvent>) => {
          if (!isPick(event)) return;
          event.stopPropagation();
          selectFeature(isSelected && selectedFeatureIds.length === 1 ? null : feature.id);
        };
        const handleContextMenu = (event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          event.nativeEvent.preventDefault();
          selectFeature(feature.id);
          openContextMenu(event.nativeEvent.clientX, event.nativeEvent.clientY);
        };

        if (feature.kind === "reference-plane") {
          const basePlaneId = feature.parents[0] ?? "plane-front";
          const basis = planeBasis(basePlaneId);
          const distance = feature.parameters.distance ?? 0;
          const position = basis.normal.clone().multiplyScalar(distance);

          return (
            <group
              key={feature.id}
              position={position}
              rotation={basis.rotation as unknown as [number, number, number]}
            >
              <mesh
                name={feature.name}
                onPointerOver={isInert ? undefined : handleOver}
                onPointerOut={isInert ? undefined : handleOut}
                onClick={isInert ? undefined : handleClick}
                onContextMenu={isInert ? undefined : handleContextMenu}
                renderOrder={-1}
              >
                <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
                <meshBasicMaterial
                  color={USER_PLANE_COLOR}
                  transparent
                  opacity={
                    isSketchMode ? 0.02 : isDimmed ? 0 : isSelected ? 0.18 : isHovered ? 0.12 : 0.06
                  }
                  side={DoubleSide}
                  depthWrite={false}
                />
              </mesh>

              <Line
                points={BORDER_POINTS}
                color={USER_PLANE_COLOR}
                lineWidth={isSelected ? 2 : 1}
                dashed
                dashSize={4}
                gapSize={2.5}
                transparent
                opacity={
                  isSketchMode ? 0.2 : isDimmed ? 0.12 : isSelected ? 1 : isHovered ? 0.85 : 0.6
                }
                raycast={() => null}
              />
            </group>
          );
        }

        if (feature.kind === "reference-axis") {
          const axis = feature.parameters.axis ?? "z";
          const direction = axisVector(axis);
          const points: [number, number, number][] = [
            direction.clone().multiplyScalar(-AXIS_HALF_LENGTH).toArray() as [number, number, number],
            direction.clone().multiplyScalar(AXIS_HALF_LENGTH).toArray() as [number, number, number],
          ];

          return (
            <Line
              key={feature.id}
              points={points}
              color={AXIS_COLORS[axis]}
              lineWidth={isSelected ? 2.5 : 1.5}
              dashed
              dashSize={3}
              gapSize={2}
              transparent
              opacity={isDimmed ? 0.15 : isSelected ? 1 : isHovered ? 0.9 : 0.7}
              onPointerOver={isInert ? undefined : handleOver}
              onPointerOut={isInert ? undefined : handleOut}
              onClick={isInert ? undefined : handleClick}
              onContextMenu={isInert ? undefined : handleContextMenu}
            />
          );
        }

        if (feature.kind === "reference-point") {
          const axis = feature.parameters.axis ?? "z";
          const distance = feature.parameters.distance ?? 0;
          const position = axisVector(axis).multiplyScalar(distance);
          const radius = isHovered || isSelected ? POINT_MARKER_RADIUS * 1.4 : POINT_MARKER_RADIUS;

          return (
            <mesh
              key={feature.id}
              position={position}
              onPointerOver={isInert ? undefined : handleOver}
              onPointerOut={isInert ? undefined : handleOut}
              onClick={isInert ? undefined : handleClick}
              onContextMenu={isInert ? undefined : handleContextMenu}
            >
              <sphereGeometry args={[radius, 12, 12]} />
              <meshBasicMaterial
                color={isSelected ? "#f5c542" : "#c99a2e"}
                transparent
                opacity={isDimmed ? 0.2 : 1}
              />
            </mesh>
          );
        }

        // reference-csys: a small triad at the origin, since there is no face/edge picking
        // yet to place it anywhere else.
        const csysAxes = (["x", "y", "z"] as const).map((axis) => ({
          axis,
          color: AXIS_COLORS[axis],
          points: [
            axisVector(axis).multiplyScalar(-CSYS_AXIS_LENGTH).toArray() as [number, number, number],
            axisVector(axis).multiplyScalar(CSYS_AXIS_LENGTH).toArray() as [number, number, number],
          ] as [number, number, number][],
        }));

        return (
          <group key={feature.id}>
            {csysAxes.map(({ axis, color, points }) => (
              <Line
                key={axis}
                points={points}
                color={color}
                lineWidth={isSelected ? 2.5 : 1.5}
                transparent
                opacity={isDimmed ? 0.15 : isSelected ? 1 : isHovered ? 0.9 : 0.7}
                raycast={() => null}
              />
            ))}
            <mesh
              onPointerOver={isInert ? undefined : handleOver}
              onPointerOut={isInert ? undefined : handleOut}
              onClick={isInert ? undefined : handleClick}
              onContextMenu={isInert ? undefined : handleContextMenu}
            >
              <sphereGeometry args={[POINT_MARKER_RADIUS * 1.3, 10, 10]} />
              <meshBasicMaterial
                color={isSelected ? "#f5c542" : "#9a9a9a"}
                transparent
                opacity={isDimmed ? 0.15 : isHovered ? 0.9 : 0.55}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
