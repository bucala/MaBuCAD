import { memo, useCallback, useMemo } from "react";
import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { Vector3 } from "three";

import { useSceneAccentColor } from "@/hooks/useSceneAccentColor";
import { worldToSketch } from "@/sketch/planeBasis";
import { entityPoints } from "@/sketch/sketchModel";
import type { Sketch, SketchEntity } from "@/sketch/types";
import { useSketchStore } from "@/state/sketchStore";

import { entityPointVersion, resolveEntityPolyline, type PointReader } from "./sketchRender";
import { useScreenSpacePixelScale } from "./screenSpaceScale";

const STATIC_COLORS = {
  geometry: "#1a1a1a",
  geometryDark: "#e8e8e8",
  /** The blue of the classic CAD under-defined convention — SolidWorks, Fusion and
   * Onshape all draw unconstrained sketch geometry blue and fully-defined geometry black
   * (near-white in dark themes). A mid blue for the light theme, a brighter one for the
   * dark, mirroring the geometry/geometryDark pair. */
  underDefined: "#1f6feb",
  underDefinedDark: "#6cb2ff",
  construction: "#c48b1a",
  axis: "#0891b2",
  point: "#4a4a4a",
  origin: "#d9463d",
};

/** Same red/pink `SketchConstraintGlyphs.module.css`'s own `.conflicting` and
 * `SketchDimensions.tsx`'s own `CONFLICT_COLOR` use — every entity/point a conflicting
 * constraint or dimension actually touches gets the identical error colour, so the
 * conflict reads as one connected thing (the offending relation's own glyph/label *and*
 * the geometry it's fighting over) rather than just an isolated icon. */
const CONFLICT_COLOR = "#ff2d55";

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
  const pickForSmartDimension = useSketchStore((state) => state.pickForSmartDimension);
  const pendingConstraintKind = useSketchStore((state) => state.pendingConstraintKind);
  const pickForConstraint = useSketchStore((state) => state.pickForConstraint);
  const pendingFilletLineId = useSketchStore((state) => state.pendingFilletLineId);
  const pickForFillet = useSketchStore((state) => state.pickForFillet);
  const trimAt = useSketchStore((state) => state.trimAt);
  const tool = useSketchStore((state) => state.tool);
  // Points and entities only intercept clicks for picking while Select, Smart Dimension or
  // Fillet is active. Any drawing tool needs those same clicks to reach the invisible
  // drawing surface behind them (SketchCanvas), which is what actually creates and snaps
  // geometry — otherwise clicking an existing point (or the origin) just picks it instead
  // of extending whatever is being drawn.
  const isPickMode = tool === "select" || tool === "smart-dimension" || tool === "fillet";
  const isTrimMode = tool === "trim";
  const conflictingIds = useSketchStore((state) => state.conflictingIds);
  const underDefinedEntityIds = useSketchStore((state) => state.underDefinedEntityIds);
  const underDefinedPointIds = useSketchStore((state) => state.underDefinedPointIds);

  // Every entity/point id a conflicting constraint or dimension directly references —
  // computed once per conflict/geometry change rather than per entity, since several
  // entities can share the same offending relation (e.g. two lines a redundant Parallel
  // constraint spans both need the highlight).
  const conflictingGeometryIds = useMemo(() => {
    if (conflictingIds.length === 0) return new Set<string>();
    const conflictSet = new Set(conflictingIds);
    const ids = new Set<string>();
    for (const constraint of sketch.constraints) {
      if (!conflictSet.has(constraint.id)) continue;
      constraint.entities.forEach((id) => ids.add(id));
      constraint.points.forEach((id) => ids.add(id));
    }
    for (const dimension of sketch.dimensions) {
      if (!conflictSet.has(dimension.id)) continue;
      dimension.entities.forEach((id) => ids.add(id));
      dimension.points.forEach((id) => ids.add(id));
    }
    return ids;
  }, [conflictingIds, sketch.constraints, sketch.dimensions]);

  // Blue/black constraint-state colouring: the same solve that reported the DOF also
  // reported which entities and points can still move (`solveSketch`'s freedom sets), so
  // what a user sees always agrees with the status bar by construction. Blue while
  // under-defined, the theme's near-black/near-white once every variable that shapes the
  // entity is pinned. Construction and axis lines keep their own type colours — their
  // dash pattern and hue carry "this is reference geometry", which matters more than
  // their constraint state.
  const underDefinedEntities = useMemo(() => new Set(underDefinedEntityIds), [underDefinedEntityIds]);
  const underDefinedPoints = useMemo(() => new Set(underDefinedPointIds), [underDefinedPointIds]);

  // Smart Dimension stays armed after use (see commandRegistry.ts's own note). Unlike
  // Select, a pick here always accumulates (see `pickForSmartDimension`'s own doc
  // comment on `PendingDimension`) rather than replacing the selection — that's what
  // lets a second, compatible pick refine a proposal (two lines -> angle) instead of the
  // first one committing immediately and leaving no room for a second pick to matter. A
  // relation armed via the "click the function first" flow (`pendingConstraintKind`) works
  // the same way, and takes priority: while a relation is waiting on picks, a click always
  // feeds it rather than plain-replacing the selection, even in ordinary Select mode. The
  // Fillet tool is its own tool rather than an armed relation (it needs a numeric radius
  // alongside the two picks), so it's checked by `tool` like Smart Dimension is.
  //
  // `useCallback`, not a plain closure: this is passed to *every* entity and point as
  // `onSelect`/`onPick`, and the memoised child components compare it by reference — a
  // fresh function per render would re-render the whole geometry on every store update.
  const pick = useCallback(
    (id: string, additive: boolean) => {
      if (pendingConstraintKind) {
        pickForConstraint(id);
        return;
      }
      if (tool === "smart-dimension") {
        pickForSmartDimension(id);
        return;
      }
      if (tool === "fillet") {
        pickForFillet(id);
        return;
      }
      toggleSelection(id, additive);
    },
    [pendingConstraintKind, tool, pickForConstraint, pickForSmartDimension, pickForFillet, toggleSelection],
  );

  // Same stability reasoning as `pick`: the entity hands back its own id and the clicked
  // world point, and the (stable) trim action converts it into sketch space against the
  // sketch's plane, which does not change within a session.
  const trim = useCallback(
    (entityId: string, point: Vector3) => trimAt(entityId, worldToSketch(sketch.planeId, point)),
    [trimAt, sketch.planeId],
  );

  // One Map-backed point lookup shared by every entity for this render. `pointById` is a
  // linear scan over the whole pool, and every entity's version key does a lookup per
  // point it references — on a 600-point sketch that is hundreds of full-pool scans per
  // drag frame, several times the cost of the tessellation the keys exist to skip. Built
  // on `sketch.points` identity (not the whole sketch): a rewrite that didn't touch
  // geometry — a constraint added, a selection made — reuses the same reader object, so
  // the memoised entities below still skip their re-render.
  const readPoint = useMemo(() => {
    const pointsById = new Map(sketch.points.map((point) => [point.id, point]));
    return (id: string) => pointsById.get(id);
  }, [sketch.points]);

  const baseColor = isDark ? STATIC_COLORS.geometryDark : STATIC_COLORS.geometry;
  const underDefinedColor = isDark ? STATIC_COLORS.underDefinedDark : STATIC_COLORS.underDefined;

  return (
    <group>
      {sketch.entities.map((entity) => {
        // The first line picked toward a Fillet reads as "selected" too, the same visual
        // feedback `pendingConstraintKind`'s accumulated picks already get via `selection`
        // — Fillet just tracks its one pick separately (`pendingFilletLineId`) since it
        // isn't a relation and doesn't want to disturb the ordinary selection.
        const isEntitySelected = selection.includes(entity.id) || entity.id === pendingFilletLineId;
        const isEntityConflicting =
          conflictingGeometryIds.has(entity.id) || entityPoints(entity).some((id) => conflictingGeometryIds.has(id));
        // Conflict red and selection accent outrank the constraint-state colour — an
        // over-defined contour must read as the error it is, and a picked entity must
        // read as picked, before either shows its blue/black freedom state.
        const isEntityUnderDefined = underDefinedEntities.has(entity.id);
        return (
          <EntityView
            key={entity.id}
            entity={entity}
            readPoint={readPoint}
            color={
              isEntityConflicting
                ? CONFLICT_COLOR
                : isEntitySelected
                  ? accent
                  : isEntityUnderDefined
                    ? underDefinedColor
                    : baseColor
            }
            isSelected={isEntitySelected}
            isSelectMode={isPickMode}
            onSelect={pick}
            // Arcs and standalone points aren't trimmable yet (see trimEntityAt's doc
            // comment) — they simply don't get a click handler in trim mode, so a click
            // falls through to the drawing surface behind them instead of doing nothing
            // silently on a hit.
            isTrimTarget={isTrimMode && (entity.kind === "line" || entity.kind === "circle" || entity.kind === "spline")}
            onTrim={trim}
          />
        );
      })}

      {sketch.points.map((point) => (
        <SketchPointDot
          key={point.id}
          point={point}
          isOrigin={point.id === `${sketch.id}-origin`}
          isSelected={selection.includes(point.id)}
          isConflicting={conflictingGeometryIds.has(point.id)}
          isUnderDefined={underDefinedPoints.has(point.id)}
          isPickMode={isPickMode}
          accent={accent}
          underDefinedColor={underDefinedColor}
          onPick={pick}
        />
      ))}
    </group>
  );
}

/** Regular point dots render at a small constant on-screen size; the origin is drawn a
 * little larger to stay visually distinct. The invisible click target is bigger than
 * either, for comfortable picking, but — unlike before — is a fixed *pixel* radius rather
 * than a copy of the drawing tools' (world-space, mm) snap tolerance: reusing that setting
 * here meant a click landing anywhere within a few mm of a point (easily most of a short or
 * heavily zoomed-in line) grabbed and dragged that point instead of the line body the user
 * meant to click, and the same fixed-world-unit radius is also what made a point's own
 * visible dot balloon to a nonsensical size once zoomed in far enough. */
const POINT_VISIBLE_PIXELS = 3.5;
const ORIGIN_VISIBLE_PIXELS = 5;
const SELECTED_POINT_VISIBLE_PIXELS = 6;
const SELECTED_POINT_HALO_PIXELS = 11;
const POINT_PICK_TARGET_PIXELS = 9;

const SketchPointDot = memo(function SketchPointDot({
  point,
  isOrigin,
  isSelected,
  isConflicting,
  isUnderDefined,
  isPickMode,
  accent,
  underDefinedColor,
  onPick,
}: {
  point: { id: string; x: number; y: number };
  isOrigin: boolean;
  isSelected: boolean;
  isConflicting: boolean;
  /** The point's own x/y can still move — joins the entity strokes' blue/black
   * constraint-state convention (the origin keeps its landmark red either way). */
  isUnderDefined: boolean;
  isPickMode: boolean;
  accent: string;
  /** Theme-appropriate blue, precomputed by the parent alongside `baseColor`. */
  underDefinedColor: string;
  /** Which point was picked — the shared, stable callback receives it as its first argument. */
  onPick: (id: string, additive: boolean) => void;
}) {
  const pickRef = useScreenSpacePixelScale(POINT_PICK_TARGET_PIXELS);
  const dotRef = useScreenSpacePixelScale(
    isSelected ? SELECTED_POINT_VISIBLE_PIXELS : isOrigin ? ORIGIN_VISIBLE_PIXELS : POINT_VISIBLE_PIXELS,
  );
  const haloRef = useScreenSpacePixelScale(SELECTED_POINT_HALO_PIXELS);

  return (
    <group position={[point.x, point.y, 0.02]}>
      {/*
        A point drawn at true size is only a few pixels across and almost impossible to
        hit, so picking uses a larger invisible target, sized in screen pixels so it stays
        comfortable to click at any zoom instead of ballooning to cover half the sketch
        when zoomed in, or shrinking to nothing zoomed out.
      */}
      <mesh
        ref={pickRef}
        name={point.id}
        userData={{ sketchPointId: point.id }}
        onClick={
          isPickMode
            ? (event) => {
                event.stopPropagation();
                onPick(point.id, event.ctrlKey || event.metaKey);
              }
            : undefined
        }
        // Deliberately not also toggling `raycast` here: react-three-fiber does not
        // reliably restore a mesh's default raycast method once a prop has set it to a
        // no-op — a mesh created while a drawing tool was active (so raycast was disabled)
        // stayed unpickable even after switching back to Select. Leaving onClick unset is
        // sufficient on its own: with no handler, r3f's raycast still hits this mesh but
        // has nothing to call, so it continues on to the canvas plane behind it instead of
        // stopping here.
      >
        <circleGeometry args={[1, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/*
        Colour alone was too easy to miss at a glance (a 3.5px dot changing shade), so a
        selected point also grows and gets a soft halo behind it — the same "it visibly
        pops" treatment as the entity halo below, sized in screen pixels for the same
        zoom-independence reason as the dot itself.
      */}
      {isSelected && (
        <mesh ref={haloRef} raycast={() => null}>
          <circleGeometry args={[1, 16]} />
          <meshBasicMaterial color={accent} transparent opacity={0.3} depthTest={false} />
        </mesh>
      )}

      <mesh ref={dotRef} raycast={() => null}>
        <circleGeometry args={[1, 12]} />
        <meshBasicMaterial
          color={
            isConflicting
              ? CONFLICT_COLOR
              : isSelected
                ? accent
                : isOrigin
                  ? STATIC_COLORS.origin
                  : isUnderDefined
                    ? underDefinedColor
                    : STATIC_COLORS.point
          }
          depthTest={false}
        />
      </mesh>
    </group>
  );
});

interface EntityViewProps {
  entity: SketchEntity;
  /** Shared Map-backed point lookup, one per render of the parent (see its own note there). */
  readPoint: PointReader;
  color: string;
  isSelected: boolean;
  isSelectMode: boolean;
  /** Which entity was picked — the shared, stable callback receives it as its first argument. */
  onSelect: (id: string, additive: boolean) => void;
  isTrimTarget: boolean;
  /** Same shared-callback pattern as `onSelect`: the entity reports its own id. */
  onTrim: (entityId: string, point: Vector3) => void;
}

/**
 * One entity's rendered polyline. Memoised on `entity` + the coordinates of its own
 * points only (see `entityPointVersion`): during a point drag the parent re-renders with a
 * fresh `sketch` object every frame, but an untouched entity's polyline is identical, so
 * its whole render can be skipped — the difference between dragging a point and
 * re-tessellating every circle/arc/spline in a large sketch per pointer-move.
 */
const EntityView = memo(function EntityView({
  entity,
  readPoint,
  color,
  isSelected,
  isSelectMode,
  onSelect,
  isTrimTarget,
  onTrim,
}: EntityViewProps) {
  // The version key already encodes everything the polyline reads about this entity — so
  // depending on `readPoint` directly here would re-run the tessellation for every entity
  // whenever the parent rebuilds its reader (any geometry edit), the exact churn the
  // keyed memo exists to remove. A reader whose points moved without this entity's own
  // changing produces the same key, and therefore the same polyline, by construction.
  const pointVersion = entityPointVersion(entity, readPoint);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const points = useMemo(() => resolveEntityPolyline(entity, readPoint), [entity, pointVersion]);

  if (points.length < 2) return null;

  const isAxis = entity.kind === "line" && entity.isAxis;

  return (
    <>
      {/*
        A 1px lineWidth bump (2 -> 3) reads as barely-there next to a colour change alone,
        which was the user's actual complaint — a soft, wider halo behind the selected
        entity makes "this is what's selected" legible at a glance regardless of theme or
        zoom, the same treatment given to selected sketch points above. No onClick here:
        purely visual, so a click still falls through to the real line underneath it.
      */}
      {isSelected && <Line points={points} color={color} lineWidth={8} transparent opacity={0.3} depthTest={false} />}
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
                onSelect(entity.id, event.ctrlKey || event.metaKey);
              }
            : isTrimTarget
              ? (event: ThreeEvent<MouseEvent>) => {
                  event.stopPropagation();
                  onTrim(entity.id, event.point);
                }
              : undefined
        }
        // See the point mesh above: not toggling `raycast` deliberately, only `onClick`.
      />
    </>
  );
});
