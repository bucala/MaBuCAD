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
  // Points and entities only intercept clicks for selection while the Select tool is
  // active. Any drawing tool needs those same clicks to reach the invisible drawing
  // surface behind them (SketchCanvas), which is what actually creates and snaps
  // geometry — otherwise clicking an existing point (or the origin) just selects it
  // instead of extending whatever is being drawn.
  const isSelectMode = useSketchStore((state) => state.tool === "select");

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
          isSelectMode={isSelectMode}
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
              onClick={
                isSelectMode
                  ? (event) => {
                      event.stopPropagation();
                      toggleSelection(point.id, event.ctrlKey || event.metaKey);
                    }
                  : undefined
              }
              // Deliberately not also toggling `raycast` here: react-three-fiber does not
              // reliably restore a mesh's default raycast method once a prop has set it to
              // a no-op — a mesh created while a drawing tool was active (so raycast was
              // disabled) stayed unpickable even after switching back to Select. Leaving
              // onClick unset is sufficient on its own: with no handler, r3f's raycast
              // still hits this mesh but has nothing to call, so it continues on to the
              // canvas plane behind it instead of stopping here.
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
  isSelectMode: boolean;
  onSelect: (additive: boolean) => void;
}

function EntityView({ entity, sketch, color, isSelected, isSelectMode, onSelect }: EntityViewProps) {
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

    if (entity.kind === "arc") {
      const [centre, start, end] = resolved;
      if (!centre || !start || !end) return [];

      // Always sweeps counter-clockwise from start to end — the same convention
      // `arcMidpoint` and the sketch canvas's own arc preview both use.
      const startAngle = Math.atan2(start.y - centre.y, start.x - centre.x);
      let endAngle = Math.atan2(end.y - centre.y, end.x - centre.x);
      if (endAngle <= startAngle) endAngle += Math.PI * 2;

      const segments = 48;
      return Array.from({ length: segments + 1 }, (_, index) => {
        const angle = startAngle + ((endAngle - startAngle) * index) / segments;
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
      onClick={
        isSelectMode
          ? (event) => {
              event.stopPropagation();
              onSelect(event.ctrlKey || event.metaKey);
            }
          : undefined
      }
      // See the point mesh above: not toggling `raycast` deliberately, only `onClick`.
    />
  );
}
