import { useRef, useState } from "react";
import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { DoubleSide } from "three";

import { findPointNear } from "@/sketch/sketchModel";
import { worldToSketch } from "@/sketch/planeBasis";
import type { Sketch } from "@/sketch/types";
import { SNAP_TOLERANCE, useSketchStore } from "@/state/sketchStore";

import { DOCUMENT_SCALE } from "../constants";

interface Point2 {
  x: number;
  y: number;
}

/** Work surface size; generous enough that drawing never runs off the pickable area. */
const CANVAS_SIZE = DOCUMENT_SCALE * 20;

/**
 * Pointer handling for the active sketch.
 *
 * An invisible plane-sized mesh receives every pointer event, converts it to sketch
 * coordinates, and drives a small per-tool state machine. In-progress geometry is local
 * state and only reaches the store when the entity is finished, so a half-drawn line
 * never lands in the document or the undo history.
 */
export function SketchCanvas({ sketch }: { sketch: Sketch }) {
  const tool = useSketchStore((state) => state.tool);
  const drawLine = useSketchStore((state) => state.drawLine);
  const drawRectangle = useSketchStore((state) => state.drawRectangle);
  const drawCircle = useSketchStore((state) => state.drawCircle);
  const drawSpline = useSketchStore((state) => state.drawSpline);
  const clearSelection = useSketchStore((state) => state.clearSelection);
  const dragPoint = useSketchStore((state) => state.dragPoint);
  const openContextMenu = useSketchStore((state) => state.openContextMenu);

  /** Anchor for the entity being drawn: line start, rectangle corner, circle centre. */
  const [anchor, setAnchor] = useState<Point2 | null>(null);
  /** Points collected so far for a multi-click spline. */
  const [splinePoints, setSplinePoints] = useState<Point2[]>([]);
  const [cursor, setCursor] = useState<Point2 | null>(null);

  const draggingPointId = useRef<string | null>(null);

  const isDrawingTool =
    tool === "line" || tool === "rectangle" || tool === "circle" ||
    tool === "spline" || tool === "construction-line";

  /** Converts an event to sketch coordinates, snapping to a nearby existing point. */
  const toSketch = (event: ThreeEvent<PointerEvent | MouseEvent>): Point2 => {
    const local = worldToSketch(sketch.planeId, event.point);
    const snapped = findPointNear(sketch, local.x, local.y, SNAP_TOLERANCE);
    return snapped ? { x: snapped.x, y: snapped.y } : local;
  };

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (tool !== "select" || event.button !== 0) return;

    const local = worldToSketch(sketch.planeId, event.point);
    const hit = findPointNear(sketch, local.x, local.y, SNAP_TOLERANCE);
    if (hit) {
      draggingPointId.current = hit.id;
      event.stopPropagation();
    }
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    const local = toSketch(event);
    setCursor(local);

    if (draggingPointId.current) {
      dragPoint(draggingPointId.current, worldToSketch(sketch.planeId, event.point));
    }
  };

  const handlePointerUp = () => {
    draggingPointId.current = null;
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.button !== 0) return;

    if (!isDrawingTool) {
      // A click on empty canvas clears the selection, as in any sketcher.
      clearSelection();
      return;
    }

    event.stopPropagation();
    const position = toSketch(event);

    if (tool === "spline") {
      setSplinePoints((current) => [...current, position]);
      return;
    }

    if (!anchor) {
      setAnchor(position);
      return;
    }

    switch (tool) {
      case "line":
      case "construction-line":
        drawLine(anchor, position, tool === "construction-line");
        // Chain from the endpoint so a profile is drawn in one continuous gesture.
        setAnchor(position);
        break;
      case "rectangle":
        drawRectangle(anchor, position);
        setAnchor(null);
        break;
      case "circle":
        drawCircle(anchor, Math.hypot(position.x - anchor.x, position.y - anchor.y));
        setAnchor(null);
        break;
    }
  };

  /** Right-click or Escape ends the current chain without discarding what is drawn. */
  const finishChain = () => {
    if (tool === "spline" && splinePoints.length >= 2) {
      drawSpline(splinePoints);
    }
    setSplinePoints([]);
    setAnchor(null);
  };

  const preview = buildPreview(tool, anchor, cursor, splinePoints);

  return (
    <group>
      <mesh
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setCursor(null)}
        onClick={handleClick}
        onContextMenu={(event) => {
          event.stopPropagation();
          // Stop the browser/OS's own right-click menu — our menu (or the finish-chain
          // shortcut below) is meant to be the only one that appears here.
          event.nativeEvent.preventDefault();

          const isMidDraw = anchor !== null || splinePoints.length > 0;
          if (isMidDraw) {
            // Right-click while drawing keeps its existing shortcut: finish or cancel the
            // in-progress entity, rather than interrupting the gesture with a menu.
            finishChain();
            return;
          }

          openContextMenu(event.nativeEvent.clientX, event.nativeEvent.clientY);
        }}
        position={[0, 0, -0.01]}
      >
        <planeGeometry args={[CANVAS_SIZE, CANVAS_SIZE]} />
        <meshBasicMaterial transparent opacity={0} side={DoubleSide} depthWrite={false} />
      </mesh>

      {preview.length >= 2 && (
        <Line points={preview} color="#0078d4" lineWidth={1.5} dashed dashSize={2} gapSize={1.5} />
      )}

      {cursor && isDrawingTool && (
        <mesh position={[cursor.x, cursor.y, 0.03]}>
          <circleGeometry args={[0.9, 12]} />
          <meshBasicMaterial color="#0078d4" depthTest={false} />
        </mesh>
      )}
    </group>
  );
}

/** Rubber-band geometry shown between the anchor and the cursor. */
function buildPreview(
  tool: string,
  anchor: Point2 | null,
  cursor: Point2 | null,
  splinePoints: Point2[],
): [number, number, number][] {
  if (tool === "spline" && splinePoints.length > 0) {
    const points = cursor ? [...splinePoints, cursor] : splinePoints;
    return points.map((point) => [point.x, point.y, 0.01]);
  }

  if (!anchor || !cursor) return [];

  if (tool === "line" || tool === "construction-line") {
    return [
      [anchor.x, anchor.y, 0.01],
      [cursor.x, cursor.y, 0.01],
    ];
  }

  if (tool === "rectangle") {
    return [
      [anchor.x, anchor.y, 0.01],
      [cursor.x, anchor.y, 0.01],
      [cursor.x, cursor.y, 0.01],
      [anchor.x, cursor.y, 0.01],
      [anchor.x, anchor.y, 0.01],
    ];
  }

  if (tool === "circle") {
    const radius = Math.hypot(cursor.x - anchor.x, cursor.y - anchor.y);
    const segments = 64;
    return Array.from({ length: segments + 1 }, (_, index) => {
      const angle = (index / segments) * Math.PI * 2;
      return [
        anchor.x + Math.cos(angle) * radius,
        anchor.y + Math.sin(angle) * radius,
        0.01,
      ] as [number, number, number];
    });
  }

  return [];
}
