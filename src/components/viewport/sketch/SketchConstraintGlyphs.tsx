import { Html } from "@react-three/drei";
import {
  AlignHorizontalJustifyCenter,
  Anchor,
  CircleDot,
  Columns3,
  Diameter,
  Divide,
  GitCommitHorizontal,
  Grid2x2,
  Lock,
  MoveHorizontal,
  MoveVertical,
  Spline,
  Tangent,
  type LucideIcon,
} from "lucide-react";

import { arcMidpoint, entityById, pointById } from "@/sketch/sketchModel";
import type { GeometricConstraint, GeometricConstraintKind, Sketch, SketchEntity } from "@/sketch/types";
import { useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";

import styles from "./SketchConstraintGlyphs.module.css";

/** `arc-radius` is deliberately excluded — see its own doc comment in `types.ts`: it's an
 * internal bookkeeping constraint the solver needs, not something the user created. */
const GLYPHS: Partial<Record<GeometricConstraintKind, { icon: LucideIcon; label: string }>> = {
  horizontal: { icon: MoveHorizontal, label: "Horizontal" },
  vertical: { icon: MoveVertical, label: "Vertical" },
  parallel: { icon: Columns3, label: "Parallel" },
  perpendicular: { icon: Grid2x2, label: "Perpendicular" },
  tangent: { icon: Tangent, label: "Tangent" },
  concentric: { icon: Diameter, label: "Concentric" },
  coincident: { icon: Anchor, label: "Coincident" },
  equal: { icon: AlignHorizontalJustifyCenter, label: "Equal" },
  fix: { icon: Lock, label: "Fixed" },
  "fix-line": { icon: Lock, label: "Fixed (extendable)" },
  "point-on-line": { icon: Anchor, label: "Point on line" },
  "point-on-circle": { icon: CircleDot, label: "Point on circle" },
  "point-on-spline": { icon: Spline, label: "Point on spline" },
  midpoint: { icon: Divide, label: "Midpoint" },
  colinear: { icon: GitCommitHorizontal, label: "Colinear" },
};

/** Where a constraint's glyph anchors: the average of its points, or the midpoint of its
 * first entity when it has none (every geometric constraint has at least one or the other). */
function constraintAnchor(sketch: Sketch, constraint: GeometricConstraint): { x: number; y: number } | null {
  if (constraint.points.length > 0) {
    const points = constraint.points
      .map((id) => pointById(sketch, id))
      .filter((point): point is NonNullable<typeof point> => Boolean(point));
    if (points.length === 0) return null;
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }

  const entity = constraint.entities[0] ? entityById(sketch, constraint.entities[0]) : undefined;
  return entity ? entityMidpoint(sketch, entity) : null;
}

function entityMidpoint(sketch: Sketch, entity: SketchEntity): { x: number; y: number } | null {
  switch (entity.kind) {
    case "line": {
      const start = pointById(sketch, entity.start);
      const end = pointById(sketch, entity.end);
      return start && end ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } : null;
    }
    case "circle": {
      const centre = pointById(sketch, entity.center);
      // Offset above the rim rather than sitting on the centre point, which already has
      // its own pick target and (for a circle used as a smart-dimension diameter source)
      // may be individually selected.
      return centre ? { x: centre.x, y: centre.y + entity.radius + 3 } : null;
    }
    case "arc": {
      const centre = pointById(sketch, entity.center);
      const start = pointById(sketch, entity.start);
      const end = pointById(sketch, entity.end);
      return centre && start && end ? arcMidpoint(centre, start, end, entity.radius) : null;
    }
    case "spline": {
      const midId = entity.points[Math.floor(entity.points.length / 2)];
      return midId ? (pointById(sketch, midId) ?? null) : null;
    }
    case "point":
      return pointById(sketch, entity.at) ?? null;
  }
}

/**
 * Small icon badges marking which geometric relations apply where — horizontal/vertical
 * on a line, parallel/perpendicular/tangent/concentric/equal between two entities,
 * coincident between two points, fixed at a pinned point.
 *
 * Toggled by `view.constraints` (`viewportStore.constraintsVisible`): the glyphs are
 * useful once a sketch has more than a couple of relations, but clutter a simple one, so
 * this is opt-out rather than always-on.
 */
export function SketchConstraintGlyphs({ sketch }: { sketch: Sketch }) {
  const visible = useViewportStore((state) => state.constraintsVisible);
  const isSelectMode = useSketchStore((state) => state.tool === "select");
  const selection = useSketchStore((state) => state.selection);
  const toggleSelection = useSketchStore((state) => state.toggleSelection);
  const conflictingIds = useSketchStore((state) => state.conflictingIds);
  if (!visible) return null;

  // Constraints that land on (almost) the same spot are staggered rather than stacked
  // exactly on top of each other and rendered illegibly — grouped by a coarse rounding
  // of their anchor so a shared point (e.g. two coincident lines meeting at a corner)
  // fans its glyphs out instead of overlapping them.
  const anchored = sketch.constraints
    .map((constraint) => ({ constraint, anchor: constraintAnchor(sketch, constraint) }))
    .filter(
      (entry): entry is { constraint: GeometricConstraint; anchor: { x: number; y: number } } =>
        entry.anchor !== null && GLYPHS[entry.constraint.kind] !== undefined,
    );

  const stackIndex = new Map<string, number>();

  return (
    <group>
      {anchored.map(({ constraint, anchor }) => {
        const key = `${Math.round(anchor.x * 4)}:${Math.round(anchor.y * 4)}`;
        const index = stackIndex.get(key) ?? 0;
        stackIndex.set(key, index + 1);

        const glyph = GLYPHS[constraint.kind]!;
        const offsetY = 4 + index * 5;

        const isSelected = selection.includes(constraint.id);
        const isConflicting = conflictingIds.includes(constraint.id);

        return (
          <Html key={constraint.id} position={[anchor.x, anchor.y + offsetY, 0.06]} center zIndexRange={[15, 0]}>
            <button
              type="button"
              className={`${styles.constraintGlyph} ${isConflicting ? styles.conflicting : isSelected ? styles.selected : ""}`}
              title={
                isConflicting
                  ? `${glyph.label} — conflicts with another constraint; delete one of them to fix the sketch`
                  : `${glyph.label} — click to select, Delete to remove`
              }
              style={isSelectMode ? undefined : { pointerEvents: "none" }}
              onClick={(event) => {
                event.stopPropagation();
                toggleSelection(constraint.id, event.ctrlKey || event.metaKey);
              }}
            >
              <glyph.icon size={10} strokeWidth={2} />
            </button>
          </Html>
        );
      })}
    </group>
  );
}
