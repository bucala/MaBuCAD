import { useMemo } from "react";
import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { CatmullRomCurve3, Vector3 } from "three";

import { useSceneAccentColor } from "@/hooks/useSceneAccentColor";
import { worldToSketch } from "@/sketch/planeBasis";
import { entityPoints, pointById } from "@/sketch/sketchModel";
import type { Sketch, SketchEntity } from "@/sketch/types";
import { useSettingsStore } from "@/state/settingsStore";
import { useSketchStore } from "@/state/sketchStore";

const STATIC_COLORS = {
  geometry: "#1a1a1a",
  geometryDark: "#e8e8e8",
  construction: "#c48b1a",
  axis: "#0891b2",
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
  const accent = useSceneAccentColor();
  const selection = useSketchStore((state) => state.selection);
  const toggleSelection = useSketchStore((state) => state.toggleSelection);
  const applySmartDimension = useSketchStore((state) => state.applySmartDimension);
  const trimAt = useSketchStore((state) => state.trimAt);
  const tool = useSketchStore((state) => state.tool);
  // Invisible pick radius around a point, matching the snap radius the drawing tools use
  // (Settings > Sketch > "Snap tolerance") — was a hardcoded constant.
  const pickRadius = useSettingsStore((state) => state.snapTolerance);
  // Points and entities only intercept clicks for picking while Select or Smart Dimension
  // is active. Any drawing tool needs those same clicks to reach the invisible drawing
  // surface behind them (SketchCanvas), which is what actually creates and snaps
  // geometry — otherwise clicking an existing point (or the origin) just picks it instead
  // of extending whatever is being drawn.
  const isPickMode = tool === "select" || tool === "smart-dimension";
  const isTrimMode = tool === "trim";

  // Smart Dimension stays armed after use (see commandRegistry.ts's own note), so every
  // pick here also tries to complete a dimension from the selection-so-far — succeeding
  // clears the selection and leaves the tool active for the next one; picking too little
  // so far (e.g. one endpoint of a two-point distance) just leaves it selected and waits.
  const pick = (id: string, additive: boolean) => {
    toggleSelection(id, additive);
    if (tool === "smart-dimension") applySmartDimension();
  };

  const baseColor = isDark ? STATIC_COLORS.geometryDark : STATIC_COLORS.geometry;

  return (
    <group>
      {sketch.entities.map((entity) => (
        <EntityView
          key={entity.id}
          entity={entity}
          sketch={sketch}
          color={selection.includes(entity.id) ? accent : baseColor}
          isSelected={selection.includes(entity.id)}
          isSelectMode={isPickMode}
          onSelect={(additive) => pick(entity.id, additive)}
          // Only a line can be trimmed today (see trimLineAt's doc comment) — other kinds
          // simply don't get a click handler in trim mode, so the click falls through to
          // the drawing surface behind them instead of doing nothing silently on a hit.
          isTrimTarget={isTrimMode && entity.kind === "line"}
          onTrim={(point) => trimAt(entity.id, worldToSketch(sketch.planeId, point))}
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
                isPickMode
                  ? (event) => {
                      event.stopPropagation();
                      pick(point.id, event.ctrlKey || event.metaKey);
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
              <circleGeometry args={[pickRadius, 12]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>

            <mesh raycast={() => null}>
              <circleGeometry args={[isOrigin ? 1.1 : 0.8, 12]} />
              <meshBasicMaterial
                color={isSelected ? accent : isOrigin ? STATIC_COLORS.origin : STATIC_COLORS.point}
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
  isTrimTarget: boolean;
  onTrim: (point: Vector3) => void;
}

function EntityView({
  entity,
  sketch,
  color,
  isSelected,
  isSelectMode,
  onSelect,
  isTrimTarget,
  onTrim,
}: EntityViewProps) {
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

  const isAxis = entity.kind === "line" && entity.isAxis;

  return (
    <Line
      points={points}
      color={isSelected ? color : isAxis ? STATIC_COLORS.axis : entity.construction ? STATIC_COLORS.construction : color}
      lineWidth={isSelected ? 3 : entity.construction ? 1 : 2}
      dashed={entity.construction}
      // A real dash-dot centreline pattern (long dash, gap, dot, gap) isn't something
      // drei's Line supports directly (one dash/gap pair only) — a tighter, more frequent
      // dash reads as visually distinct from a plain construction line's dash at a glance,
      // which is the part that actually matters for telling the two apart in the viewport.
      dashSize={isAxis ? 3 : 2}
      gapSize={isAxis ? 0.8 : 1.5}
      onClick={
        isSelectMode
          ? (event) => {
              event.stopPropagation();
              onSelect(event.ctrlKey || event.metaKey);
            }
          : isTrimTarget
            ? (event: ThreeEvent<MouseEvent>) => {
                event.stopPropagation();
                onTrim(event.point);
              }
            : undefined
      }
      // See the point mesh above: not toggling `raycast` deliberately, only `onClick`.
    />
  );
}
