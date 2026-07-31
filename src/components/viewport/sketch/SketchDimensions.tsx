import { useMemo, useRef, useState } from "react";
import { Html, Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Plane, Raycaster, Vector2, Vector3 } from "three";

import { DimensionValueField } from "@/components/shared/DimensionValueField";
import { useSceneAccentColor } from "@/hooks/useSceneAccentColor";
import { planeBasis, worldToSketch } from "@/sketch/planeBasis";
import { pointById } from "@/sketch/sketchModel";
import type { Dimension, Sketch } from "@/sketch/types";
import { useSketchStore } from "@/state/sketchStore";

import styles from "./SketchDimensions.module.css";

const DIMENSION_COLOR = "#0f7b0f";
const ORDINATE_COLOR = "#8a5cf6";

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

function DimensionView({ dimension, sketch }: { dimension: Dimension; sketch: Sketch }) {
  const selection = useSketchStore((state) => state.selection);
  const toggleSelection = useSketchStore((state) => state.toggleSelection);
  const setDimensionValue = useSketchStore((state) => state.setDimensionValue);
  const setDimensionLabelOffset = useSketchStore((state) => state.setDimensionLabelOffset);
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
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const isSelected = selection.includes(dimension.id);
  const isOrdinate = dimension.kind === "ordinate-x" || dimension.kind === "ordinate-y";
  const color = isSelected ? accent : isOrdinate ? ORDINATE_COLOR : DIMENSION_COLOR;

  const first = dimension.points[0] ? pointById(sketch, dimension.points[0]) : undefined;
  const second = dimension.points[1] ? pointById(sketch, dimension.points[1]) : undefined;

  const entity = dimension.entities[0]
    ? sketch.entities.find((candidate) => candidate.id === dimension.entities[0])
    : undefined;

  let leader: [number, number, number][] = [];
  let labelPosition: [number, number, number] = [0, 0, 0.05];
  let text = "";

  // Every kind below computes a sensible default anchor first, then the user's drag
  // (`dimension.labelOffset`, see `handlePointerMove`) nudges the label from there —
  // dragging works the same way regardless of what kind of dimension it is.
  const nudge = dimension.labelOffset;

  if (isOrdinate && first && second) {
    // Ordinate dimensions run back to the datum along one axis, which is what makes a
    // chain of them share a single zero rather than accumulating tolerance.
    const alongX = dimension.kind === "ordinate-x";
    const offset = 6;

    if (alongX) {
      leader = [
        [second.x, second.y, 0],
        [second.x, first.y - offset, 0],
        [first.x, first.y - offset, 0],
      ];
      labelPosition = [second.x + nudge.x, first.y - offset - 3 + nudge.y, 0.05];
    } else {
      leader = [
        [second.x, second.y, 0],
        [first.x - offset, second.y, 0],
        [first.x - offset, first.y, 0],
      ];
      labelPosition = [first.x - offset - 3 + nudge.x, second.y + nudge.y, 0.05];
    }

    text = `${dimension.value.toFixed(2)}`;
  } else if (first && second) {
    const midX = (first.x + second.x) / 2 + nudge.x;
    const midY = (first.y + second.y) / 2 + nudge.y;
    const normalX = -(second.y - first.y);
    const normalY = second.x - first.x;
    const normalLength = Math.hypot(normalX, normalY) || 1;
    const offset = 5;

    const shiftX = (normalX / normalLength) * offset;
    const shiftY = (normalY / normalLength) * offset;

    leader = [
      [first.x, first.y, 0],
      [first.x + shiftX, first.y + shiftY, 0],
      [second.x + shiftX, second.y + shiftY, 0],
      [second.x, second.y, 0],
    ];
    labelPosition = [midX + shiftX, midY + shiftY, 0.05];
    text = `${dimension.value.toFixed(2)}`;
  } else if (entity?.kind === "circle" || entity?.kind === "arc") {
    const centre = pointById(sketch, entity.center);
    if (!centre) return null;

    const edgeX = centre.x + entity.radius * Math.SQRT1_2;
    const edgeY = centre.y + entity.radius * Math.SQRT1_2;

    leader = [
      [centre.x, centre.y, 0],
      [edgeX + 4, edgeY + 4, 0],
    ];
    labelPosition = [edgeX + 6 + nudge.x, edgeY + 6 + nudge.y, 0.05];
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
              isSelected ? styles.selected : ""
            }`}
            style={isSelectMode ? undefined : { pointerEvents: "none" }}
            data-dimension-id={dimension.id}
            title="Drag to move, double-click to edit the value"
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
            onPointerDown={handleLabelPointerDown}
            onPointerMove={handleLabelPointerMove}
            onPointerUp={handleLabelPointerUp}
          >
            {text}
          </button>
        )}
      </Html>
    </group>
  );
}
