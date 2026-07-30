import { Html, Line } from "@react-three/drei";

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
  // Dimension labels are real DOM buttons layered over the canvas via drei's Html, so
  // they intercept a click before it ever reaches the WebGL raycaster underneath — if one
  // happens to sit where the user is trying to draw, `pointer-events: none` lets that
  // click fall through to the canvas instead of selecting the dimension.
  const isSelectMode = useSketchStore((state) => state.tool === "select");

  const isSelected = selection.includes(dimension.id);
  const isOrdinate = dimension.kind === "ordinate-x" || dimension.kind === "ordinate-y";
  const color = isSelected ? "#0078d4" : isOrdinate ? ORDINATE_COLOR : DIMENSION_COLOR;

  const first = dimension.points[0] ? pointById(sketch, dimension.points[0]) : undefined;
  const second = dimension.points[1] ? pointById(sketch, dimension.points[1]) : undefined;

  const entity = dimension.entities[0]
    ? sketch.entities.find((candidate) => candidate.id === dimension.entities[0])
    : undefined;

  let leader: [number, number, number][] = [];
  let labelPosition: [number, number, number] = [0, 0, 0.05];
  let text = "";

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
      labelPosition = [second.x, first.y - offset - 3, 0.05];
    } else {
      leader = [
        [second.x, second.y, 0],
        [first.x - offset, second.y, 0],
        [first.x - offset, first.y, 0],
      ];
      labelPosition = [first.x - offset - 3, second.y, 0.05];
    }

    text = `${dimension.value.toFixed(2)}`;
  } else if (first && second) {
    const midX = (first.x + second.x) / 2 + dimension.labelOffset.x;
    const midY = (first.y + second.y) / 2 + dimension.labelOffset.y;
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
  } else if (entity?.kind === "circle") {
    const centre = pointById(sketch, entity.center);
    if (!centre) return null;

    const edgeX = centre.x + entity.radius * Math.SQRT1_2;
    const edgeY = centre.y + entity.radius * Math.SQRT1_2;

    leader = [
      [centre.x, centre.y, 0],
      [edgeX + 4, edgeY + 4, 0],
    ];
    labelPosition = [edgeX + 6, edgeY + 6, 0.05];
    text = `${dimension.kind === "diameter" ? "⌀" : "R"}${dimension.value.toFixed(2)}`;
  } else if (dimension.kind === "angle") {
    labelPosition = [dimension.labelOffset.x, dimension.labelOffset.y, 0.05];
    text = `${dimension.value.toFixed(1)}°`;
  }

  if (!text) return null;

  return (
    <group>
      {leader.length >= 2 && (
        <Line points={leader} color={color} lineWidth={1} transparent opacity={0.9} />
      )}

      <Html position={labelPosition} center zIndexRange={[20, 0]}>
        <button
          type="button"
          className={`${styles.label} ${isOrdinate ? styles.ordinate : ""} ${
            isSelected ? styles.selected : ""
          }`}
          style={isSelectMode ? undefined : { pointerEvents: "none" }}
          data-dimension-id={dimension.id}
          onClick={(event) => {
            event.stopPropagation();
            toggleSelection(dimension.id, event.ctrlKey || event.metaKey);
          }}
        >
          {text}
        </button>
      </Html>
    </group>
  );
}
