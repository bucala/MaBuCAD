import { useMemo, useRef, useState } from "react";
import { Html, Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Plane, Raycaster, Vector2, Vector3 } from "three";

import { DimensionValueField } from "@/components/shared/DimensionValueField";
import { useSceneAccentColor } from "@/hooks/useSceneAccentColor";
import { planeBasis, worldToSketch } from "@/sketch/planeBasis";
import { clampAngleToArcSweep, defaultDimensionAnchor, pointById } from "@/sketch/sketchModel";
import type { Dimension, Sketch } from "@/sketch/types";
import { useSketchStore } from "@/state/sketchStore";

import styles from "./SketchDimensions.module.css";

const DIMENSION_COLOR = "#0f7b0f";
const ORDINATE_COLOR = "#8a5cf6";
/** Same red/pink `SketchConstraintGlyphs.module.css`'s own `.conflicting` uses — a
 * dimension `findConflictingConstraints` found responsible for an over-defined sketch
 * gets the identical error colour, so a conflict reads the same regardless of whether the
 * offending relation happens to be a plain constraint or a driving dimension. */
const CONFLICT_COLOR = "#ff2d55";

/** Arrowhead size for a dimension line's ends, in sketch units. */
const ARROW_LENGTH = 2.2;
const ARROW_WIDTH = 0.8;

/**
 * A small "V" arrowhead at `tip`, pointing back along `(dirX, dirY)` (a unit vector from
 * the tip toward where the dimension line came from) — the same convention every CAD
 * dimension line uses, and one this app's leader lines had none of before, which is part
 * of why a freshly placed, undragged dimension could read as an unlabelled tangle of
 * lines rather than an obviously-a-dimension line with a clear point.
 */
function arrowheadPoints(
  tipX: number,
  tipY: number,
  dirX: number,
  dirY: number,
): [[number, number, number][], [number, number, number][]] {
  const backX = tipX + dirX * ARROW_LENGTH;
  const backY = tipY + dirY * ARROW_LENGTH;
  const perpX = -dirY * ARROW_WIDTH;
  const perpY = dirX * ARROW_WIDTH;
  return [
    [[tipX, tipY, 0], [backX + perpX, backY + perpY, 0]],
    [[tipX, tipY, 0], [backX - perpX, backY - perpY, 0]],
  ];
}

interface SketchDimensionsProps {
  sketch: Sketch;
}

/**
 * Draws dimensions with their witness lines and a DOM label.
 *
 * Labels use drei's Html rather than in-scene text so they stay crisp at any zoom, pick
 * up the app's own typography, and need no font file — the content security policy
 * blocks the remote fonts that WebGL text helpers fetch by default.
 */
export function SketchDimensions({ sketch }: SketchDimensionsProps) {
  return (
    <group>
      {sketch.dimensions.map((dimension) => (
        <DimensionView key={dimension.id} dimension={dimension} sketch={sketch} />
      ))}
    </group>
  );
}

/**
 * Smart Dimension's uncommitted proposal, following the cursor until a click on empty
 * sketch space commits it — see `sketchStore.ts`'s `PendingDimension` doc comment for
 * the whole flow. Deliberately a much simpler render than `DimensionView` below: no
 * witness lines beyond a single dashed leader to the cursor, no drag/edit interaction,
 * since none of that applies to something that isn't part of the sketch yet.
 */
export function SmartDimensionPreview({ sketch }: { sketch: Sketch }) {
  const pendingDimension = useSketchStore((state) => state.pendingDimension);
  const hoverPosition = useSketchStore((state) => state.hoverPosition);

  if (!pendingDimension || !hoverPosition) return null;

  const anchor = defaultDimensionAnchor(
    sketch,
    pendingDimension.kind,
    pendingDimension.points,
    pendingDimension.entities,
  );
  if (!anchor) return null;

  const text =
    pendingDimension.kind === "diameter"
      ? `⌀${pendingDimension.value.toFixed(2)}`
      : pendingDimension.kind === "radius"
        ? `R${pendingDimension.value.toFixed(2)}`
        : pendingDimension.kind === "angle"
          ? `${pendingDimension.value.toFixed(1)}°`
          : pendingDimension.value.toFixed(2);

  return (
    <group>
      <Line
        points={[
          [anchor.x, anchor.y, 0.04],
          [hoverPosition.x, hoverPosition.y, 0.04],
        ]}
        color={DIMENSION_COLOR}
        lineWidth={1}
        dashed
        dashSize={2}
        gapSize={1.5}
        transparent
        opacity={0.6}
        // Otherwise this leader — which can run right across whatever the user is trying
        // to pick next (a second line to refine into an angle) — wins the raycast over the
        // entity underneath it and the pick silently misses.
        raycast={() => null}
      />
      {/* `wrapperClass` (not the `pointerEvents` prop — see `.previewWrapper`'s own doc
          comment for why that prop doesn't work here) keeps this non-interactive, since it
          sits exactly where the next pick needs to land as it follows the cursor. */}
      <Html
        position={[hoverPosition.x, hoverPosition.y, 0.06]}
        center
        zIndexRange={[20, 0]}
        wrapperClass={styles.previewWrapper}
      >
        <div className={styles.preview}>{text}</div>
      </Html>
    </group>
  );
}

function DimensionView({ dimension, sketch }: { dimension: Dimension; sketch: Sketch }) {
  const selection = useSketchStore((state) => state.selection);
  const toggleSelection = useSketchStore((state) => state.toggleSelection);
  const setDimensionValue = useSketchStore((state) => state.setDimensionValue);
  const setDimensionLabelOffset = useSketchStore((state) => state.setDimensionLabelOffset);
  const beginDrag = useSketchStore((state) => state.beginDrag);
  const endDrag = useSketchStore((state) => state.endDrag);
  const openContextMenu = useSketchStore((state) => state.openContextMenu);
  const conflictingIds = useSketchStore((state) => state.conflictingIds);
  // Dimension labels are real DOM buttons layered over the canvas via drei's Html, so
  // they intercept a click before it ever reaches the WebGL raycaster underneath — if one
  // happens to sit where the user is trying to draw, `pointer-events: none` lets that
  // click fall through to the canvas instead of selecting the dimension.
  const isSelectMode = useSketchStore((state) => state.tool === "select");
  const accent = useSceneAccentColor();
  const [isEditing, setIsEditing] = useState(false);

  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const raycaster = useMemo(() => new Raycaster(), []);
  // A mathematical plane matching the sketch's own orientation, through the origin — used
  // only to turn a drag's screen coordinates back into sketch-plane coordinates. Ray-plane
  // intersection (rather than a fixed pixels-per-unit conversion) is what makes dragging
  // work correctly under both the orthographic and perspective projections, and at any
  // zoom level, without needing to know which one is active.
  const dragPlane = useMemo(() => {
    const basis = planeBasis(sketch.planeId);
    return new Plane().setFromNormalAndCoplanarPoint(basis.normal, new Vector3(0, 0, 0));
  }, [sketch.planeId]);
  const dragStart = useRef<{ offset: { x: number; y: number }; sketchPos: { x: number; y: number } } | null>(null);

  const screenToSketch = (clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = new Vector3();
    return raycaster.ray.intersectPlane(dragPlane, hit) ? worldToSketch(sketch.planeId, hit) : null;
  };

  // A plain <button> still fires a native `click` after pointerup even when the pointer
  // travelled a long way in between — there is no built-in "that was a drag, not a click"
  // suppression the way there is for text selection. `didDrag` records whether any real
  // movement happened during this press so the subsequent onClick can ignore it, the same
  // problem `useClickGuard` solves for clicks in the 3D scene, solved locally here since
  // this drag is native DOM pointer capture rather than an r3f pointer event.
  const didDrag = useRef(false);

  const handleLabelPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (isEditing || event.button !== 0) return;
    const sketchPos = screenToSketch(event.clientX, event.clientY);
    if (!sketchPos) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    // Arms the same gesture mechanism a point drag uses — the whole label drag becomes one
    // undo step (first moving frame snapshots, later frames apply), and a grab released
    // without moving pushes nothing. See `beginDrag`'s own doc comment in `sketchStore.ts`.
    beginDrag();
    didDrag.current = false;
    dragStart.current = { offset: dimension.labelOffset, sketchPos };
  };

  const handleLabelPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragStart.current) return;
    const sketchPos = screenToSketch(event.clientX, event.clientY);
    if (!sketchPos) return;
    didDrag.current = true;
    setDimensionLabelOffset(dimension.id, {
      x: dragStart.current.offset.x + (sketchPos.x - dragStart.current.sketchPos.x),
      y: dragStart.current.offset.y + (sketchPos.y - dragStart.current.sketchPos.y),
    });
    invalidate();
  };

  const handleLabelPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    // Ends the gesture — discards the armed snapshot if no frame ever moved the label.
    endDrag();
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const isSelected = selection.includes(dimension.id);
  const isOrdinate = dimension.kind === "ordinate-x" || dimension.kind === "ordinate-y";
  // Horizontal/Vertical distance dimensions share the ordinate leader's own axis-locked
  // shape (extension lines dropped to a shared horizontal/vertical dimension line) — the
  // same geometry, just not chained to a datum — so they reuse that branch below rather
  // than the free-angle leader "Aligned" (`distance`) uses. Kept out of `isOrdinate` itself
  // since that also drives the ordinate-only purple colour, which these two don't get.
  const isAxisLockedDistance = dimension.kind === "horizontal-distance" || dimension.kind === "vertical-distance";
  const isConflicting = conflictingIds.includes(dimension.id);
  const color = isConflicting ? CONFLICT_COLOR : isSelected ? accent : isOrdinate ? ORDINATE_COLOR : DIMENSION_COLOR;

  const first = dimension.points[0] ? pointById(sketch, dimension.points[0]) : undefined;
  const second = dimension.points[1] ? pointById(sketch, dimension.points[1]) : undefined;

  const entity = dimension.entities[0]
    ? sketch.entities.find((candidate) => candidate.id === dimension.entities[0])
    : undefined;

  let leader: [number, number, number][] = [];
  let arrows: [number, number, number][][] = [];
  let labelPosition: [number, number, number] = [0, 0, 0.05];
  let text = "";

  // Every kind below computes a sensible default anchor first, then the user's drag
  // (`dimension.labelOffset`, see `handlePointerMove`) nudges the label from there —
  // dragging works the same way regardless of what kind of dimension it is. The witness
  // lines are always rebuilt from that same nudge (rather than a fixed offset with the
  // label alone drifting away from it), so the label stays visually attached to its own
  // dimension line and the two move together as a single rigid unit, matching other CAD
  // tools — a plain fixed offset here is what let the label detach from its line before.
  const nudge = dimension.labelOffset;

  if ((isOrdinate || isAxisLockedDistance) && first && second) {
    // Ordinate dimensions run back to the datum along one axis, which is what makes a
    // chain of them share a single zero rather than accumulating tolerance. The nudge
    // component along that axis grows or shrinks the shared offset (so witness lines and
    // label move out together); the cross-axis component just slides the label along its
    // own dimension line. A Horizontal/Vertical distance dimension isn't chained to a
    // datum, but the leader shape — extension lines dropped square to a shared
    // horizontal/vertical dimension line — is identical, so it reuses the same branch.
    const alongX = dimension.kind === "ordinate-x" || dimension.kind === "horizontal-distance";
    const baseOffset = 6;

    if (alongX) {
      const offset = baseOffset - nudge.y;
      leader = [
        [second.x, second.y, 0],
        [second.x, first.y - offset, 0],
        [first.x, first.y - offset, 0],
      ];
      // Points back along the leader's first segment, toward the datum end — the same
      // "arrowhead touches the measured point" convention the linear/radius dimensions use.
      arrows = arrowheadPoints(second.x, second.y, 0, Math.sign(first.y - offset - second.y) || 1);
      labelPosition = [second.x + nudge.x, first.y - offset - 3, 0.05];
    } else {
      const offset = baseOffset - nudge.x;
      leader = [
        [second.x, second.y, 0],
        [first.x - offset, second.y, 0],
        [first.x - offset, first.y, 0],
      ];
      arrows = arrowheadPoints(second.x, second.y, Math.sign(first.x - offset - second.x) || 1, 0);
      labelPosition = [first.x - offset - 3, second.y + nudge.y, 0.05];
    }

    text = `${dimension.value.toFixed(2)}`;
  } else if (first && second) {
    const normalX = -(second.y - first.y);
    const normalY = second.x - first.x;
    const normalLength = Math.hypot(normalX, normalY) || 1;
    const nx = normalX / normalLength;
    const ny = normalY / normalLength;
    const lineDx = second.x - first.x;
    const lineDy = second.y - first.y;
    const lineLength = Math.hypot(lineDx, lineDy) || 1;
    const dirX = lineDx / lineLength;
    const dirY = lineDy / lineLength;

    // Split the drag into how far it moved the dimension line away from the measured
    // points (perpendicular) versus how far it slid the label along that line (parallel)
    // — the perpendicular component drives both witness lines and the label identically.
    const nudgeNormal = nudge.x * nx + nudge.y * ny;
    const nudgeAlong = nudge.x * dirX + nudge.y * dirY;
    const baseOffset = 5;
    const offset = baseOffset + nudgeNormal;
    const shiftX = nx * offset;
    const shiftY = ny * offset;

    const midX = (first.x + second.x) / 2 + dirX * nudgeAlong;
    const midY = (first.y + second.y) / 2 + dirY * nudgeAlong;

    leader = [
      [first.x, first.y, 0],
      [first.x + shiftX, first.y + shiftY, 0],
      [second.x + shiftX, second.y + shiftY, 0],
      [second.x, second.y, 0],
    ];
    // Arrowheads sit on the dimension line itself (the middle segment, at the offset
    // distance), each pointing inward along it toward the other end — the standard CAD
    // convention, and the clearest way to read "this line measures exactly this span" at
    // a glance, especially before the label has been dragged away from a tight default
    // placement.
    arrows = [
      ...arrowheadPoints(first.x + shiftX, first.y + shiftY, dirX, dirY),
      ...arrowheadPoints(second.x + shiftX, second.y + shiftY, -dirX, -dirY),
    ];
    labelPosition = [midX + shiftX, midY + shiftY, 0.05];
    text = `${dimension.value.toFixed(2)}`;
  } else if (dimension.kind === "point-line-distance" && first && entity?.kind === "line") {
    const lineStart = pointById(sketch, entity.start);
    const lineEnd = pointById(sketch, entity.end);
    if (!lineStart || !lineEnd) return null;

    // The point's own perpendicular foot on the line — same construction as
    // `defaultDimensionAnchor`'s own point-line-distance case, but needed again here
    // rather than reused from it since the label has since been nudged off that default.
    const ux = lineEnd.x - lineStart.x;
    const uy = lineEnd.y - lineStart.y;
    const lengthSquared = ux * ux + uy * uy || 1e-12;
    const t = ((first.x - lineStart.x) * ux + (first.y - lineStart.y) * uy) / lengthSquared;
    const footX = lineStart.x + t * ux;
    const footY = lineStart.y + t * uy;

    // From here down, identical to the point-to-point `distance` branch above — a
    // perpendicular-offset dimension line between two points — just with the line's own
    // foot point standing in for a second selected point.
    const normalX = -(footY - first.y);
    const normalY = footX - first.x;
    const normalLength = Math.hypot(normalX, normalY) || 1;
    const nx = normalX / normalLength;
    const ny = normalY / normalLength;
    const dirX = (footX - first.x) / (Math.hypot(footX - first.x, footY - first.y) || 1);
    const dirY = (footY - first.y) / (Math.hypot(footX - first.x, footY - first.y) || 1);

    const nudgeNormal = nudge.x * nx + nudge.y * ny;
    const nudgeAlong = nudge.x * dirX + nudge.y * dirY;
    const baseOffset = 5;
    const offset = baseOffset + nudgeNormal;
    const shiftX = nx * offset;
    const shiftY = ny * offset;

    const midX = (first.x + footX) / 2 + dirX * nudgeAlong;
    const midY = (first.y + footY) / 2 + dirY * nudgeAlong;

    leader = [
      [first.x, first.y, 0],
      [first.x + shiftX, first.y + shiftY, 0],
      [footX + shiftX, footY + shiftY, 0],
      [footX, footY, 0],
    ];
    arrows = [
      ...arrowheadPoints(first.x + shiftX, first.y + shiftY, dirX, dirY),
      ...arrowheadPoints(footX + shiftX, footY + shiftY, -dirX, -dirY),
    ];
    labelPosition = [midX + shiftX, midY + shiftY, 0.05];
    text = `${dimension.value.toFixed(2)}`;
  } else if (entity?.kind === "circle" || entity?.kind === "arc") {
    const centre = pointById(sketch, entity.center);
    if (!centre) return null;

    const baseEdgeX = centre.x + entity.radius * Math.SQRT1_2;
    const baseEdgeY = centre.y + entity.radius * Math.SQRT1_2;
    const labelX = baseEdgeX + 6 + nudge.x;
    const labelY = baseEdgeY + 6 + nudge.y;

    // Direction from centre toward the label, used to find where the dimension line
    // crosses the rim — the standard radius/diameter convention (SolidWorks, Inventor)
    // anchors the arrow at that rim point, not at the centre itself: a radius dimension's
    // leader runs rim -> label, and a diameter's runs clear across the circle, rim -> rim,
    // continuing on to the label. Anchoring at the centre instead (this app's previous
    // behaviour) put the arrowhead on top of the centre point's own dot, and for a circle
    // smaller than the arrowhead's own fixed size, let its wings overshoot past the far
    // rim — both of which read as "the arrow doesn't cleanly point at anything."
    const toLabelX = labelX - centre.x;
    const toLabelY = labelY - centre.y;
    const toLabelLength = Math.hypot(toLabelX, toLabelY) || 1;
    let dirX = toLabelX / toLabelLength;
    let dirY = toLabelY / toLabelLength;

    // An arc only covers part of the circle — pointing straight at wherever the label
    // happens to be dragged can aim past either end of it, landing the arrowhead in the
    // wedge the arc doesn't actually draw. Clamping to the swept range is what makes
    // dragging the label double as "pick which segment of the arc the leader anchors to"
    // (`possibility to change the segment`): drag past one end and the leader snaps to
    // anchor at that end instead of following into empty space.
    if (entity.kind === "arc") {
      const start = pointById(sketch, entity.start);
      const end = pointById(sketch, entity.end);
      if (start && end) {
        const clamped = clampAngleToArcSweep(centre, start, end, Math.atan2(dirY, dirX));
        dirX = Math.cos(clamped);
        dirY = Math.sin(clamped);
      }
    }

    const nearRimX = centre.x + dirX * entity.radius;
    const nearRimY = centre.y + dirY * entity.radius;

    if (dimension.kind === "diameter") {
      const farRimX = centre.x - dirX * entity.radius;
      const farRimY = centre.y - dirY * entity.radius;
      leader = [
        [farRimX, farRimY, 0],
        [nearRimX, nearRimY, 0],
        [labelX, labelY, 0],
      ];
      arrows = [
        ...arrowheadPoints(nearRimX, nearRimY, -dirX, -dirY),
        ...arrowheadPoints(farRimX, farRimY, dirX, dirY),
      ];
    } else {
      // "Extend to Centre": the same rim -> label leader, just continued inward past the
      // rim to the centre point too — a plain visual extension (the arrowhead still
      // anchors at the rim, same as always) rather than a different measurement, useful
      // on a small circle where the bare rim-to-label leader alone reads ambiguously.
      leader = dimension.extendToCenter
        ? [[centre.x, centre.y, 0], [nearRimX, nearRimY, 0], [labelX, labelY, 0]]
        : [
            [nearRimX, nearRimY, 0],
            [labelX, labelY, 0],
          ];
      arrows = arrowheadPoints(nearRimX, nearRimY, -dirX, -dirY);
    }
    labelPosition = [labelX, labelY, 0.05];
    text = `${dimension.kind === "diameter" ? "⌀" : "R"}${dimension.value.toFixed(2)}`;
  } else if (dimension.kind === "angle") {
    // No single pair of points defines an angle (it's stored as two line entities), so the
    // default anchor is the centroid of both lines' four endpoints — close to the vertex
    // for the common case of two lines that actually meet, and still reasonable when they
    // don't quite touch.
    const [firstEntityId, secondEntityId] = dimension.entities;
    const a = firstEntityId ? sketch.entities.find((candidate) => candidate.id === firstEntityId) : undefined;
    const b = secondEntityId ? sketch.entities.find((candidate) => candidate.id === secondEntityId) : undefined;
    const endpoints = [a, b]
      .filter((line): line is Extract<typeof line, { kind: "line" }> => line?.kind === "line")
      .flatMap((line) => [pointById(sketch, line.start), pointById(sketch, line.end)])
      .filter((point): point is NonNullable<typeof point> => Boolean(point));

    if (endpoints.length === 0) return null;
    const centroidX = endpoints.reduce((sum, point) => sum + point.x, 0) / endpoints.length;
    const centroidY = endpoints.reduce((sum, point) => sum + point.y, 0) / endpoints.length;

    labelPosition = [centroidX + nudge.x, centroidY + nudge.y, 0.05];
    text = `${dimension.value.toFixed(1)}°`;
  }

  if (!text) return null;

  return (
    <group>
      {leader.length >= 2 && (
        <Line points={leader} color={color} lineWidth={1} transparent opacity={0.9} />
      )}
      {arrows.map((stroke, index) => (
        <Line key={index} points={stroke} color={color} lineWidth={1} transparent opacity={0.9} />
      ))}

      <Html position={labelPosition} center zIndexRange={[20, 0]}>
        {isEditing ? (
          <DimensionValueField
            dimensionId={dimension.id}
            value={dimension.value}
            label={`${text} value`}
            onCommit={setDimensionValue}
            onBlur={() => setIsEditing(false)}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className={`${styles.label} ${isOrdinate ? styles.ordinate : ""} ${
              isConflicting ? styles.conflicting : isSelected ? styles.selected : ""
            }`}
            style={isSelectMode ? undefined : { pointerEvents: "none" }}
            data-dimension-id={dimension.id}
            title={
              dimension.kind === "radius" || dimension.kind === "diameter"
                ? "Drag to move, double-click to edit the value, right-click for Radius/Diameter or to extend to centre"
                : dimension.kind === "angle"
                  ? "Drag to move, double-click to edit the value, right-click to flip the angle"
                  : "Drag to move, double-click to edit the value"
            }
            onClick={(event) => {
              event.stopPropagation();
              if (didDrag.current) {
                didDrag.current = false;
                return;
              }
              toggleSelection(dimension.id, event.ctrlKey || event.metaKey);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              setIsEditing(true);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleSelection(dimension.id, false);
              openContextMenu(event.clientX, event.clientY);
            }}
            onPointerDown={handleLabelPointerDown}
            onPointerMove={handleLabelPointerMove}
            onPointerUp={handleLabelPointerUp}
            onPointerCancel={handleLabelPointerUp}
          >
            {text}
          </button>
        )}
      </Html>
    </group>
  );
}
