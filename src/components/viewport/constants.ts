/**
 * Scene constants for the graphics area.
 *
 * MaBuCAD works in millimetres and one scene unit is one millimetre, so a 100 unit
 * reference plane is a 100 mm square. SolidWorks is Y-up with the Front plane on XY,
 * which is exactly the three.js convention — no axis conversion is needed anywhere.
 */

/** Nominal size of a new, empty document, used to scale the default geometry. */
export const DOCUMENT_SCALE = 100;

/** Edge length of the square reference planes. */
export const PLANE_SIZE = DOCUMENT_SCALE;

/** Half-length of each origin axis leg. */
export const ORIGIN_AXIS_LENGTH = DOCUMENT_SCALE * 0.18;

/** Axis colours, matching the swatches already used in the status bar gizmo. */
export const AXIS_COLORS = {
  x: "#d9463d",
  y: "#4caf50",
  z: "#3d7ad9",
} as const;

/** Sketch grid cell size, in sketch units (mm) — matches `SketchScene.tsx`'s own grid
 * `cellSize` and is what the snap-to-grid toggle snaps drawn points to. */
export const SKETCH_GRID_SIZE = DOCUMENT_SCALE / 20;

/** Rough average of the viewport's background gradient (see `Viewport.module.css`'s
 * `--bg-viewport-top`/`--bg-viewport-bottom`), used to dim the reference grids' line
 * colours toward the backdrop rather than just picking darker/lighter constants by hand. */
export const VIEWPORT_BG_APPROX = {
  dark: "#25282d",
  light: "#c4ceda",
} as const;

/**
 * Reference plane definitions.
 *
 * `rotation` orients a three.js plane (which is born on XY facing +Z) onto the target
 * plane, so the Front plane needs no rotation at all.
 */
export const REFERENCE_PLANES = [
  {
    id: "plane-front",
    label: "Front Plane",
    /** XY, normal +Z */
    rotation: [0, 0, 0],
    color: "#3d7ad9",
  },
  {
    id: "plane-top",
    label: "Top Plane",
    /** XZ, normal +Y */
    rotation: [-Math.PI / 2, 0, 0],
    color: "#4caf50",
  },
  {
    id: "plane-right",
    label: "Right Plane",
    /** YZ, normal +X */
    rotation: [0, Math.PI / 2, 0],
    color: "#d9463d",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  rotation: readonly [number, number, number];
  color: string;
}[];

export type ReferencePlaneId = (typeof REFERENCE_PLANES)[number]["id"];

/**
 * Default camera placement: the front-top-right octant looking back at the origin,
 * matching the trimetric view a new SolidWorks document opens in.
 */
export const DEFAULT_CAMERA_POSITION: [number, number, number] = [
  DOCUMENT_SCALE * 1.4,
  DOCUMENT_SCALE * 1.05,
  DOCUMENT_SCALE * 1.75,
];

/** Distance limits so the model cannot be dollied inside-out or lost to infinity. */
export const MIN_ZOOM_DISTANCE = DOCUMENT_SCALE * 0.05;
export const MAX_ZOOM_DISTANCE = DOCUMENT_SCALE * 40;
