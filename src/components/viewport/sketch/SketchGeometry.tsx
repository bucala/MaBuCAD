import { useMemo } from "react";
import { Line } from "@react-three/drei";
import { CatmullRomCurve3, Vector3 } from "three";

import { entityPoints, pointById } from "@/sketch/sketchModel";
import type { Sketch, SketchEntity } from "@/sketch/types";
import { SNAP_TOLERANCE, useSketchStore } from "@/state/sketchStore";

/** Invisible pick radius around a point, matching the snap radius of the drawing tools. */
const PICK_RADIUS = SNAP_TOLERANCE;

const COLORS = {
  geometry: "#1a1a1a",
  geometryDark: "#e8e8e8",
  construction: "#c48b1a",
  selected: "#0078d4",
  point: "#4a4a4a",
  origin: "#d9463d",
};

interface SketchGeometryProps {
  sketch: Sketch;
  isDark: boolean;
}

/**
 * Draws the sketch's entities and points in the plane's local space.
 *
 * The parent group applies the plane rotation, so everything here is plain 2D at z = 0.
 */
export function SketchGeometry({ sketch, isDark }: SketchGeometryProps) {
  const selection = useSketchStore((state) => state.selection);
  const toggleSelection = useSketchStore((state) => state.toggleSelection);

  const baseColor = isDark ? COLORS.geometryDark : COLORS.geometry;

  return (
    <group>
      {sketch.entities.map((entity) => (
        <EntityView
          key={entity.id}
          entity={entity}
          sketch={sketch}
          color={selection.includes(entity.id) ? COLORS.selected : baseColor}
          isSelected={selection.includes(entity.id)}
          onSelect={(additive) => toggleSelection(entity.id, additive)}
        />
      ))}

      {sketch.points.map((point) => {
        const isOrigin = point.id === `${sketch.id}-origin`;
        const isSelected = selection.includes(point.id);

        return (
          <group key={point.id} position={[point.x, point.y, 0.02]}>
            {/*
              A point drawn at true size is only a few pixels across and almost impossible
              to hit, so picking uses a larger invisible target — the same radius the
              drawing tools snap within, which keeps clicking and snapping consistent.
            */}
            <mesh
              name={point.id}
              userData={{ sketchPointId: point.id }}
              onClick={(event) => {
                event.stopPropagation();
                toggleSelection(point.id, event.ctrlKey || event.metaKey);
              }}
            >
              <circleGeometry args={[PICK_RADIUS, 12]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>

            <mesh raycast={() => null}>
              <circleGeometry args={[isOrigin ? 1.1 : 0.8, 12]} />
              <meshBasicMaterial
                color={isSelected ? COLORS.selected : isOrigin ? COLORS.origin : COLORS.point}
                depthTest={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

interface EntityViewProps {
  entity: SketchEntity;
  sketch: Sketch;
  color: string;
  isSelected: boolean;
  onSelect: (additive: boolean) => void;
}

function EntityView({ entity, sketch, color, isSelected, onSelect }: EntityViewProps) {
  const points = useMemo(() => {
    const resolved = entityPoints(entity)
      .map((id) => pointById(sketch, id))
      .filter((point): point is NonNullable<typeof point> => Boolean(point));

    if (entity.kind === "line") {
      return resolved.map((point) => [point.x, point.y, 0] as [number, number, number]);
    }

    if (entity.kind === "circle") {
      const centre = resolved[0];
      if (!centre) return [];
      const segments = 72;
      return Array.from({ length: segments + 1 }, (_, index) => {
        const angle = (index / segments) * Math.PI * 2;
        return [
          centre.x + Math.cos(angle) * entity.radius,
          centre.y + Math.sin(angle) * entity.radius,
          0,
        ] as [number, number, number];
      });
    }

    // Spline: interpolate through its points so the curve reads as a smooth profile.
    if (resolved.length < 2) return [];
    const curve = new CatmullRomCurve3(resolved.map((point) => new Vector3(point.x, point.y, 0)));
    return curve.getPoints(Math.max(24, resolved.length * 12)).map(
      (point) => [point.x, point.y, 0] as [number, number, number],
    );
  }, [entity, sketch]);

  if (points.length < 2) return null;

  return (
    <Line
      points={points}
      color={entity.construction ? COLORS.construction : color}
      lineWidth={isSelected ? 3 : entity.construction ? 1 : 2}
      dashed={entity.construction}
      dashSize={2}
      gapSize={1.5}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(event.ctrlKey || event.metaKey);
      }}
    />
  );
}
