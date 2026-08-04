import { useEffect, useMemo, useRef, useState } from "react";
import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { DoubleSide, Plane, Raycaster, Vector2, Vector3 } from "three";

import { useSceneAccentColor } from "@/hooks/useSceneAccentColor";
import { planeBasis, worldToSketch } from "@/sketch/planeBasis";
import { findPointNear } from "@/sketch/sketchModel";
import type { Sketch } from "@/sketch/types";
import { useSettingsStore } from "@/state/settingsStore";
import { useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";

import { DOCUMENT_SCALE, SKETCH_GRID_SIZE } from "../constants";
import { useScreenSpacePixelScale, worldUnitsPerPixel } from "./screenSpaceScale";

/** How close (in screen pixels) a click in Select mode must land to an existing point to
 * start dragging it, rather than falling through to whatever's behind it (an entity's own
 * body, or empty canvas). Deliberately independent of Settings ▸ Sketch's "Snap tolerance"
 * (a world-space/mm value meant for snapping newly-drawn geometry onto existing points) —
 * reusing that here meant a click landing anywhere within a few mm of a point, easily most
 * of a short or heavily zoomed-in line, grabbed and dragged the point instead of letting
 * the click reach the line body the user actually meant to click. */
const DRAG_PICK_TARGET_PX = 9;

interface Point2 {
  x: number;
  y: number;
}

/** Work surface size; generous enough that drawing never runs off the pickable area. */
const CANVAS_SIZE = DOCUMENT_SCALE * 20;

/** Stand-in world point for `worldUnitsPerPixel`'s perspective-camera distance calculation
 * — sketches are drawn through the world origin (see `drawPlane` below), so this is exact
 * for the app's default orthographic camera (which ignores it entirely) and a reasonable
 * approximation for perspective. */
const PLANE_ORIGIN = new Vector3(0, 0, 0);

const CURSOR_DOT_PIXELS = 4;

/** The small dot marking the drawing cursor's snapped position — a constant on-screen size
 * rather than a fixed world-space radius, the same fix applied to sketch point dots
 * (`SketchGeometry.tsx`'s `SketchPointDot`) and for the same reason. */
function CursorDot({ x, y, color }: { x: number; y: number; color: string }) {
  const ref = useScreenSpacePixelScale(CURSOR_DOT_PIXELS);
  return (
    <mesh ref={ref} position={[x, y, 0.03]}>
      <circleGeometry args={[1, 12]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  );
}

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
  const beginDrag = useSketchStore((state) => state.beginDrag);
  const dragPoint = useSketchStore((state) => state.dragPoint);
  const commitDragSnap = useSketchStore((state) => state.commitDragSnap);
  const trimWindowSelect = useSketchStore((state) => state.trimWindowSelect);
  const openContextMenu = useSketchStore((state) => state.openContextMenu);
  const pendingDimension = useSketchStore((state) => state.pendingDimension);
  const commitPendingDimension = useSketchStore((state) => state.commitPendingDimension);
  const cancelPendingDimension = useSketchStore((state) => state.cancelPendingDimension);
  const setHoverPosition = useSketchStore((state) => state.setHoverPosition);
  const snapTolerance = useSettingsStore((state) => state.snapTolerance);
  const snapToGridEnabled = useViewportStore((state) => state.snapToGridEnabled);

  /** Anchor for the entity being drawn: line start, rectangle corner, circle/arc centre. */
  const [anchor, setAnchor] = useState<Point2 | null>(null);
  /** An arc's second click (its start point, which also fixes its radius). */
  const [arcStart, setArcStart] = useState<Point2 | null>(null);
  /** Points collected so far for a multi-click spline. */
  const [splinePoints, setSplinePoints] = useState<Point2[]>([]);
  const [cursor, setCursor] = useState<Point2 | null>(null);
  /** The window being dragged out for a Trim marquee-select, in sketch space — `null`
   * whenever nothing is being dragged, including the still-ambiguous moment right after a
   * plain click's own pointerdown (see `handlePointerDown`'s own note on why a marquee
   * only actually starts once the pointer has moved). */
  const [trimMarquee, setTrimMarquee] = useState<{ start: Point2; end: Point2 } | null>(null);

  const draggingPointId = useRef<string | null>(null);
  /** Screen-space pointerdown position while the Trim tool is armed, used only to decide
   * whether a gesture is a plain click (handled entirely by each entity's own `onTrim`) or
   * a drag that should become a marquee — screen pixels, not sketch units, so the same
   * threshold means the same thing at any zoom level, matching `useClickGuard.ts`'s own
   * `DRAG_THRESHOLD_PX` for the identical click-vs-drag question in the 3D viewport. */
  const trimPointerDownAt = useRef<{ x: number; y: number } | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);
  const accent = useSceneAccentColor();

  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const raycaster = useMemo(() => new Raycaster(), []);
  // A mathematical plane matching the sketch's own orientation, through the origin — the
  // same ray-plane intersection `SketchDimensions.tsx`'s `screenToSketch` already uses for
  // dragging, and for the same reason: React Three Fiber's own pointer-event raycasting
  // (`event.point`) can unproject against a camera whose `projectionMatrix`/
  // `matrixWorldInverse` hasn't caught up yet with a `left`/`right`/`zoom`/orientation
  // change from moments earlier — most visible right after switching sketch tools, where
  // it silently lands a fresh circle's centre (or any other entity's anchor) tens of
  // sketch units from the actual click. Recomputing here, fresh, from the camera's current
  // properties (already proven correct at that point — the app's own repaint has settled
  // well before the click) sidesteps whatever in R3F's internal event pipeline is stale.
  const drawPlane = useMemo(() => {
    const basis = planeBasis(sketch.planeId);
    return new Plane().setFromNormalAndCoplanarPoint(basis.normal, new Vector3(0, 0, 0));
  }, [sketch.planeId]);

  const screenToSketch = (clientX: number, clientY: number): Point2 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = new Vector3();
    return raycaster.ray.intersectPlane(drawPlane, hit) ? worldToSketch(sketch.planeId, hit) : null;
  };

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

  const snapToGrid = (point: Point2): Point2 => ({
    x: Math.round(point.x / SKETCH_GRID_SIZE) * SKETCH_GRID_SIZE,
    y: Math.round(point.y / SKETCH_GRID_SIZE) * SKETCH_GRID_SIZE,
  });

  /** Converts an event to sketch coordinates, snapping to a nearby existing point first
   * and, failing that, to the sketch grid when that toggle is on — existing geometry
   * always wins over the grid, the same priority every other CAD sketcher uses. */
  const toSketch = (event: ThreeEvent<PointerEvent | MouseEvent>): Point2 => {
    const native = event.nativeEvent as PointerEvent | MouseEvent;
    const local = screenToSketch(native.clientX, native.clientY) ?? { x: 0, y: 0 };
    const snapped = findPointNear(sketch, local.x, local.y, snapTolerance);
    if (snapped) return { x: snapped.x, y: snapped.y };
    return snapToGridEnabled ? snapToGrid(local) : local;
  };

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (tool === "trim" && event.button === 0) {
      // Doesn't `stopPropagation()`: a plain click still needs to reach whichever entity's
      // own `onTrim` it landed on (see `SketchGeometry.tsx`) — this only remembers where
      // the gesture started, in case `handlePointerMove` below decides it has become a
      // drag. Recorded in *screen* pixels for the click-vs-drag distance check, and
      // separately in sketch space (`screenToSketch`) as the marquee's first corner, since
      // dragging the camera between down and up (impossible mid-gesture here, but a fixed
      // reference point is simpler than re-deriving one) must not move an already-fixed
      // corner.
      trimPointerDownAt.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
      const local = screenToSketch(event.nativeEvent.clientX, event.nativeEvent.clientY);
      if (local) setTrimMarquee({ start: local, end: local });
      return;
    }

    if (tool !== "select" || event.button !== 0) return;

    const local = screenToSketch(event.nativeEvent.clientX, event.nativeEvent.clientY);
    if (!local) return;
    // A fixed pixel radius, not `snapTolerance` — see `DRAG_PICK_TARGET_PX`'s own doc
    // comment on why reusing the (world-space) drawing-snap tolerance here made a click
    // anywhere near a point drag it instead of reaching whatever was actually clicked.
    const dragPickRadius = DRAG_PICK_TARGET_PX * worldUnitsPerPixel(camera, size.height, PLANE_ORIGIN);
    const hit = findPointNear(sketch, local.x, local.y, dragPickRadius);
    if (hit) {
      // One history entry per drag gesture, not per pointer-move — see `beginDrag`'s own
      // doc comment for why `dragPoint` below does not push its own history.
      beginDrag();
      draggingPointId.current = hit.id;
      event.stopPropagation();
    }
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    const local = toSketch(event);
    setCursor(local);
    // Feeds `SmartDimensionPreview.tsx`, which has no pointer events of its own to track
    // this from — only meaningful while a proposal is pending, but cheap enough to just
    // always keep current rather than gate it on tool/pendingDimension.
    const hover = screenToSketch(event.nativeEvent.clientX, event.nativeEvent.clientY);
    if (hover) setHoverPosition(hover);

    if (draggingPointId.current && hover) {
      // Deliberately not `toSketch`'s point-snapping here — snapping a dragged point onto
      // whatever other point it passes near would fight the drag. Grid-snapping is fine to
      // share, though: it only rounds, it never jumps to unrelated geometry.
      dragPoint(draggingPointId.current, snapToGridEnabled ? snapToGrid(hover) : hover);
    }

    if (trimPointerDownAt.current && hover) {
      setTrimMarquee((current) => (current ? { start: current.start, end: hover } : current));
    }
  };

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    if (trimPointerDownAt.current) {
      const downAt = trimPointerDownAt.current;
      trimPointerDownAt.current = null;
      const marquee = trimMarquee;
      setTrimMarquee(null);

      // Same click-vs-drag threshold `useClickGuard.ts` uses for the 3D viewport — below
      // it, this was a plain click and each entity's own `onTrim` (fired as a separate
      // "click" event) already handled it; only a real drag becomes a window-select.
      const travelled = Math.hypot(
        event.nativeEvent.clientX - downAt.x,
        event.nativeEvent.clientY - downAt.y,
      );
      if (marquee && travelled > 4) {
        trimWindowSelect(
          Math.min(marquee.start.x, marquee.end.x),
          Math.min(marquee.start.y, marquee.end.y),
          Math.max(marquee.start.x, marquee.end.x),
          Math.max(marquee.start.y, marquee.end.y),
        );
      }
    }

    // "Constrains smart": applies whatever relation the drag ended up close to (see
    // `commitDragSnap`'s own doc comment) — a no-op when nothing was suggested.
    if (draggingPointId.current) commitDragSnap(draggingPointId.current);
    draggingPointId.current = null;
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.button !== 0) return;

    if (!isDrawingTool) {
      // A click on empty canvas while a Smart Dimension proposal is pending is the
      // "place it here" gesture the Inventor-style flow ends on — see
      // `commitPendingDimension`'s own doc comment. Otherwise, same as any sketcher: a
      // click on empty canvas clears the selection.
      if (tool === "smart-dimension" && pendingDimension) {
        commitPendingDimension(toSketch(event));
        return;
      }
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

          if (tool === "smart-dimension" && pendingDimension) {
            // Same shortcut as mid-draw below: right-click cancels the in-progress thing
            // (here, the pending proposal) rather than opening a menu over it.
            cancelPendingDimension();
            return;
          }

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

      {trimMarquee && (
        <Line
          points={[
            [trimMarquee.start.x, trimMarquee.start.y, 0.02],
            [trimMarquee.end.x, trimMarquee.start.y, 0.02],
            [trimMarquee.end.x, trimMarquee.end.y, 0.02],
            [trimMarquee.start.x, trimMarquee.end.y, 0.02],
            [trimMarquee.start.x, trimMarquee.start.y, 0.02],
          ]}
          color={accent}
          lineWidth={1.5}
          dashed
          dashSize={1.5}
          gapSize={1}
        />
      )}

      {cursor && isDrawingTool && <CursorDot x={cursor.x} y={cursor.y} color={accent} />}
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
