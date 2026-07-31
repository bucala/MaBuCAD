import { useMemo } from "react";
import { CatmullRomCurve3, Vector3 } from "three";
import { Line } from "@react-three/drei";

import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { planeBasis } from "@/sketch/planeBasis";
import { entityPoints, pointById } from "@/sketch/sketchModel";
import type { Sketch, SketchEntity } from "@/sketch/types";
import { useDocumentStore } from "@/state/documentStore";
import { useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";

const LINE_COLOR = { light: "#8a94a3", dark: "#5c6470" };
const CONSTRUCTION_COLOR = "#c48b1a99";
const AXIS_COLOR = "#0891b299";

/**
 * Every sketch that isn't the one actively being edited, drawn faint and un-pickable in
 * the viewport — otherwise a sketch's geometry vanishes the instant you exit it, with
 * nothing left on screen to show what you drew or to reference for another feature (see
 * the "select a sketch as input" flow in `commandRegistry.ts`'s `resolveTargetSketchId`).
 *
 * Deliberately read-only: entities here have no click handlers and `raycast={() => null}`,
 * so this never competes with `SketchGeometry.tsx`'s own interactive rendering of whichever
 * sketch actually is being edited, or with picking the solid/planes underneath.
 */
export function InactiveSketches() {
  const isDark = useIsDarkTheme();
  const activeSketchId = useSketchStore((state) => state.activeSketchId);
  const sketches = useSketchStore((state) => state.sketches);
  // Reads the raw feature list/rollback index rather than subscribing through
  // `selectBuiltFeatures`, which slices a fresh array on every call — see
  // `UserReferenceGeometry.tsx`'s note on the same infinite-render-loop trap.
  const allFeatures = useDocumentStore((state) => state.document.features);
  const rollbackIndex = useDocumentStore((state) => state.document.rollbackIndex);
  const hiddenFeatureIds = useViewportStore((state) => state.hiddenFeatureIds);

  const visible = useMemo(
    () =>
      allFeatures
        .slice(0, rollbackIndex)
        .filter(
          (feature) =>
            feature.kind === "sketch" &&
            feature.id !== activeSketchId &&
            !feature.suppressed &&
            !hiddenFeatureIds.includes(feature.id) &&
            sketches[feature.id],
        ),
    [allFeatures, rollbackIndex, activeSketchId, hiddenFeatureIds, sketches],
  );

  return (
    <>
      {visible.map((feature) => {
        const sketch = sketches[feature.id];
        const basis = planeBasis(sketch.planeId);
        return (
          <group key={feature.id} rotation={basis.rotation as unknown as [number, number, number]}>
            {sketch.entities.map((entity) => (
              <InactiveEntity key={entity.id} entity={entity} sketch={sketch} isDark={isDark} />
            ))}
          </group>
        );
      })}
    </>
  );
}

function InactiveEntity({ entity, sketch, isDark }: { entity: SketchEntity; sketch: Sketch; isDark: boolean }) {
  const points = entityPoints(entity)
    .map((id) => pointById(sketch, id))
    .filter((point): point is NonNullable<typeof point> => Boolean(point));

  let positions: [number, number, number][];

  if (entity.kind === "line") {
    positions = points.map((point) => [point.x, point.y, 0]);
  } else if (entity.kind === "circle") {
    const centre = points[0];
    if (!centre) return null;
    positions = circlePoints(centre, entity.radius);
  } else if (entity.kind === "arc") {
    const [centre, start, end] = points;
    if (!centre || !start || !end) return null;
    positions = arcPoints(centre, start, end, entity.radius);
  } else {
    if (points.length < 2) return null;
    const curve = new CatmullRomCurve3(points.map((point) => new Vector3(point.x, point.y, 0)));
    positions = curve.getPoints(Math.max(24, points.length * 12)).map(
      (point) => [point.x, point.y, 0] as [number, number, number],
    );
  }

  if (positions.length < 2) return null;

  const color = entity.kind === "line" && entity.isAxis
    ? AXIS_COLOR
    : entity.construction
      ? CONSTRUCTION_COLOR
      : isDark
        ? LINE_COLOR.dark
        : LINE_COLOR.light;

  return (
    <Line
      points={positions}
      color={color}
      lineWidth={1}
      dashed={entity.construction}
      dashSize={entity.kind === "line" && entity.isAxis ? 3 : 2}
      gapSize={entity.kind === "line" && entity.isAxis ? 0.8 : 1.5}
      raycast={() => null}
    />
  );
}

function circlePoints(centre: { x: number; y: number }, radius: number): [number, number, number][] {
  const segments = 48;
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return [centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius, 0];
  });
}

function arcPoints(
  centre: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
  radius: number,
): [number, number, number][] {
  const startAngle = Math.atan2(start.y - centre.y, start.x - centre.x);
  let endAngle = Math.atan2(end.y - centre.y, end.x - centre.x);
  if (endAngle <= startAngle) endAngle += Math.PI * 2;

  const segments = 32;
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = startAngle + ((endAngle - startAngle) * index) / segments;
    return [centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius, 0];
  });
}
