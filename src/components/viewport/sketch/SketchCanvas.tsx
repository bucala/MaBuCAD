import { useEffect, useRef, useState } from "react";
import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { DoubleSide } from "three";

import { useSceneAccentColor } from "@/hooks/useSceneAccentColor";
import { worldToSketch } from "@/sketch/planeBasis";
import { findPointNear } from "@/sketch/sketchModel";
import type { Sketch } from "@/sketch/types";
import { useSettingsStore } from "@/state/settingsStore";
import { useSketchStore } from "@/state/sketchStore";

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
  const drawPoint = useSketchStore((state) => state.drawPoint);
  const drawArc = useSketchStore((state) => state.drawArc);
  const clearSelection = useSketchStore((state) => state.clearSelection);
  const dragPoint = useSketchStore((state) => state.dragPoint);
  const openContextMenu = useSketchStore((state) => state.openContextMenu);
  const snapTolerance = useSettingsStore((state) => state.snapTolerance);

  /** Anchor for the entity being drawn: line start, rectangle corner, circle/arc centre. */
  const [anchor, setAnchor] = useState<Point2 | null>(null);
  /** An arc's second click (its start point, which also fixes its radius). */
  const [arcStart, setArcStart] = useState<Point2 | null>(null);
  /** Points collected so far for a multi-click spline. */
  const [splinePoints, setSplinePoints] = useState<Point2[]>([]);
  const [cursor, setCursor] = useState<Point2 | null>(null);

  const draggingPointId = useRef<string | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  const accent = useSceneAccentColor();

  // Line and construction-line deliberately leave `anchor` set after finishing an entity
  // so the next click chains from that endpoint (see the "line"/"construction-line" case
  // below) — but that same leftover anchor would otherwise survive a switch to a
  // different tool, so the very next click there would misfire using geometry from a
  // tool the user already moved on from (e.g. an arc's first click landing in the
  // `arcStart` branch instead of `anchor`, using a stale line endpoint as its centre).
  useEffect(() => {
    setAnchor(null);
    setArcStart(null);
    setSplinePoints([]);
    // With `frameloop="demand"`, a canvas that has not rendered since some earlier state
    // change can occasionally miss a click landing right after a tool switch — nothing
    // else here asks for a fresh frame, and picking a tool is exactly the moment right
    // before the next click matters most (drawing a corner/anchor). This narrows, but does
    // not fully close, a pointer-event race that a real user is very unlikely to hit —
    // it needs a click with essentially no gap after the tool switch to reproduce.
    invalidate();
  }, [tool, invalidate]);

  const isDrawingTool =
    tool === "line" || tool === "rectangle" || tool === "circle" ||
    tool === "spline" || tool === "construction-line" || tool === "axis-line" ||
    tool === "point" || tool === "arc";

  /** Converts an event to sketch coordinates, snapping to a nearby existing point. */
  const toSketch = (event: ThreeEvent<PointerEvent | MouseEvent>): Point2 => {
    const local = worldToSketch(sketch.planeId, event.point);
    const snapped = findPointNear(sketch, local.x, local.y, snapTolerance);
    return snapped ? { x: snapped.x, y: snapped.y } : local;
  };

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (tool !== "select" || event.button !== 0) return;

    const local = worldToSketch(sketch.planeId, event.point);
    const hit = findPointNear(sketch, local.x, local.y, snapTolerance);
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

    // A point is placed with a single click, unlike every other tool here, which pairs
    // an anchor click with a second click to finish.
    if (tool === "point") {
      drawPoint(position);
      return;
    }

    // An arc needs three clicks — centre, then start (which also fixes the radius), then
    // end — so it tracks its own second anchor rather than sharing the single `anchor`
    // every other tool here uses for just a first-and-second-click gesture.
    if (tool === "arc") {
      if (!anchor) {
        setAnchor(position);
        return;
      }
      if (!arcStart) {
        setArcStart(position);
        return;
      }
      drawArc(anchor, arcStart, position);
      setAnchor(null);
      setArcStart(null);
      return;
    }

    if (!anchor) {
      setAnchor(position);
      return;
    }

    switch (tool) {
      case "line":
      case "construction-line":
      case "axis-line":
        drawLine(anchor, position, tool === "construction-line" || tool === "axis-line", tool === "axis-line");
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
    setArcStart(null);
  };

  const preview = buildPreview(tool, anchor, arcStart, cursor, splinePoints);

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

          const isMidDraw = anchor !== null || arcStart !== null || splinePoints.length > 0;
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
        <Line points={preview} color={accent} lineWidth={1.5} dashed dashSize={2} gapSize={1.5} />
      )}

      {cursor && isDrawingTool && (
        <mesh position={[cursor.x, cursor.y, 0.03]}>
          <circleGeometry args={[0.9, 12]} />
          <meshBasicMaterial color={accent} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}

/** Rubber-band geometry shown between the anchor and the cursor. */
function buildPreview(
  tool: string,
  anchor: Point2 | null,
  arcStart: Point2 | null,
  cursor: Point2 | null,
  splinePoints: Point2[],
): [number, number, number][] {
  if (tool === "spline" && splinePoints.length > 0) {
    const points = cursor ? [...splinePoints, cursor] : splinePoints;
    return points.map((point) => [point.x, point.y, 0.01]);
  }

  if (tool === "arc" && anchor && cursor) {
    // Before the start click: a plain radius circle, the same affordance as the circle
    // tool's own preview. After it: the actual counter-clockwise sweep from the start
    // point to the cursor, at the radius the start click already fixed.
    const centre = anchor;
    const radius = Math.hypot((arcStart ?? cursor).x - centre.x, (arcStart ?? cursor).y - centre.y);
    const segments = 48;

    if (!arcStart) {
      return Array.from({ length: segments + 1 }, (_, index) => {
        const angle = (index / segments) * Math.PI * 2;
        return [centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius, 0.01] as [
          number,
          number,
          number,
        ];
      });
    }

    const startAngle = Math.atan2(arcStart.y - centre.y, arcStart.x - centre.x);
    let endAngle = Math.atan2(cursor.y - centre.y, cursor.x - centre.x);
    if (endAngle <= startAngle) endAngle += Math.PI * 2;

    return Array.from({ length: segments + 1 }, (_, index) => {
      const angle = startAngle + ((endAngle - startAngle) * index) / segments;
      return [centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius, 0.01] as [
        number,
        number,
        number,
      ];
    });
  }

  if (!anchor || !cursor) return [];

  if (tool === "line" || tool === "construction-line" || tool === "axis-line") {
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
