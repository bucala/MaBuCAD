import { drawProjection, FaceFinder, lookFromPlane, makeBaseBox, ProjectionCamera } from "replicad";
import type { AnyShape, Face, PlaneName, ProjectionPlane, Wire } from "replicad";

import { resolveTapDrill } from "@/data/holeResolution";
import type { TappedStandardId } from "@/data/holeStandards";
import type { Sketch } from "@/sketch/types";
import type {
  CadDocument,
  DrawingHoleCalloutMetadata,
  DrawingHoleTargetData,
  DrawingProjectionKind,
  ScreenAxis,
  StandardProjectionKind,
} from "@/types/document";

import { fitCircle } from "./drawingGeometry";
import { getCurrentShape, rebuildDocument } from "./rebuild";

/** One projected view's geometry, in the part's own millimetre space, shifted to land at
 * (0, 0) — see `projectOne`'s own doc comment for why — with `originX`/`originY`
 * preserving the shift so a view's own local coordinates can still be mapped back to the
 * part's real world space (`sectionAxisAndOffset` below is what that's for). */
export interface ProjectedGeometry {
  visiblePaths: string[];
  hiddenPaths: string[];
  width: number;
  height: number;
  originX: number;
  originY: number;
  /** ISO 6410's own thin, 3/4-broken circle at the thread's major diameter, drawn around
   * whichever of `visiblePaths`/`hiddenPaths` circle turns out to be a tapped hole's own
   * minor-diameter (tap drill) circle — see `threadOverlaysFor`'s own doc comment for how
   * that match is made. Absent/empty when the part has no tapped holes, or none of them
   * happen to be viewed straight down their own axis. */
  threadPaths?: string[];
  /** Hole Wizard circles found in this view, with enough structured metadata for the
   * drawing's Hole Callout tool to write a standards-aware note from one pick. */
  holeTargets?: DrawingHoleTargetData[];
}

export type ProjectedViews = Record<StandardProjectionKind, ProjectedGeometry>;

/** The three standard views a section cut can be taken from — unlike Front/Top/Right,
 * Isometric's projection axes aren't world-axis-aligned, so a horizontal/vertical cut
 * line drawn on it wouldn't correspond to a flat world-space cutting plane. */
export type OrthoProjection = "front" | "top" | "right";
/** The screen axis an auxiliary camera is tilted around — the same axis concept
 * `ScreenAxis` (`types/document.ts`) persists for section/broken metadata. */
export type AuxiliaryTiltAxis = ScreenAxis;

/** Guards against a degenerate view (an empty/near-planar projection) collapsing to a
 * zero-size bounding box, which would make an SVG `viewBox` invalid. */
const MIN_VIEW_SIZE = 1;

/** A conventional isometric camera — replicad has no named shortcut for one (its own
 * `ProjectionPlane` union only covers the axis-aligned faces), so this is built the same
 * way `lookFromPlane` builds any other: a position and a viewing direction, here both the
 * standard (1, -1, 1) corner. Built lazily (not at module scope) because `ProjectionCamera`
 * is WASM-backed and the kernel isn't loaded until the first `rebuildDocument` call below. */
function isometricCamera(): ProjectionCamera {
  return new ProjectionCamera([1, -1, 1], [1, -1, 1]);
}

/** `Drawing.toSVGPaths()` returns a flat `string[]` for a single blueprint but a nested
 * `string[][]` once a projection has more than one disjoint loop (e.g. a part with a
 * through-hole) — flattened here so `DrawingViewData` can stay a plain `string[]`. */
function flattenPaths(paths: string[] | string[][]): string[] {
  return paths.flatMap((path) => (Array.isArray(path) ? path : [path]));
}

/**
 * Projects one view and normalises it into the shape used by `types/document.ts`'s
 * `DrawingViewData`.
 *
 * `drawProjection` returns visible and hidden edges as separate `Drawing`s in whatever
 * coordinate space the projection camera happens to produce — not necessarily anywhere
 * near the origin. Translating both by their combined bounding box's own minimum corner
 * before extracting SVG paths means `DrawingSheet.tsx` can give every view a plain
 * `0 0 width height` viewBox rather than also having to carry that offset around; the
 * subtracted corner is returned as `originX`/`originY` for the one thing that does still
 * need it — mapping a click on the view back to the part's real world space.
 */
function projectOne(shape: AnyShape, camera: ProjectionPlane | ProjectionCamera): ProjectedGeometry {
  const { visible, hidden } = drawProjection(shape, camera);

  const box = visible.boundingBox;
  box.add(hidden.boundingBox);
  const [[minX, minY], [maxX, maxY]] = box.bounds;
  const width = Math.max(maxX - minX, MIN_VIEW_SIZE);
  const height = Math.max(maxY - minY, MIN_VIEW_SIZE);

  return {
    visiblePaths: flattenPaths(visible.translate(-minX, -minY).toSVGPaths()),
    hiddenPaths: flattenPaths(hidden.translate(-minX, -minY).toSVGPaths()),
    width,
    height,
    originX: minX,
    originY: minY,
  };
}

/**
 * Builds a supplementary/auxiliary camera by tilting a standard orthographic camera around
 * one of its screen axes. This deliberately uses a bounded angle rather than pretending the
 * browser can pick an arbitrary B-Rep face: the source view's Front/Top/Right direction is
 * the stable reference, and the resulting view is still a real kernel projection.
 */
export function auxiliaryCamera(
  projection: OrthoProjection,
  tiltAxis: AuxiliaryTiltAxis,
  angle: number,
): ProjectionCamera {
  const base = lookFromPlane(projection);
  const axis = tiltAxis === "horizontal" ? base.xAxis : base.yAxis;
  const rotatedDirection = base.direction.rotate(angle, [0, 0, 0], axis.toTuple());
  const rotatedXAxis = base.xAxis.rotate(angle, [0, 0, 0], axis.toTuple());
  return new ProjectionCamera(rotatedDirection.toTuple(), rotatedDirection.toTuple(), rotatedXAxis.toTuple());
}

/**
 * Headlessly rebuilds a referenced part's document into its kernel shape — shared by
 * every projection flow below (the four standard views, and a section cut). Not a
 * live/continuously-synced background document: a Drawing's views are a cache
 * (`DrawingViewData`'s own doc comment) refreshed on demand by "Update View"/a section's
 * own recompute, the same "can go out of date" relationship a SolidWorks drawing has with
 * its referenced part. There is no worker-isolated second kernel instance here either; a
 * concurrent rebuild of the same part in its own open tab would race this one, an accepted
 * limitation of layering Drawing views on a kernel that was never built to run more than
 * one job at a time (see `rebuild.ts`'s own module-level `currentShape`).
 *
 * Returns `null` when the referenced document has no built geometry (an empty part, or
 * one that fails to build at all).
 */
async function rebuildPartShape(
  document: CadDocument,
  sketches: Record<string, Sketch>,
): Promise<{ shape: AnyShape; errors: Record<string, string> } | null> {
  const built = document.features.slice(0, document.rollbackIndex);
  const result = await rebuildDocument(built, sketches);
  const shape = getCurrentShape();
  if (!result.mesh || !shape) return null;
  return { shape: shape as unknown as AnyShape, errors: result.errors };
}

/** One Hole Wizard feature reduced to what view projection needs: the radius the kernel
 * actually cuts (what the projected circle will measure), the cosmetic thread's major
 * radius when tapped, and the structured callout metadata the drawing stores per target. */
interface HoleProjectionSource {
  sourceFeatureId: string;
  cutRadius: number;
  threadMajorRadius?: number;
  metadata: DrawingHoleCalloutMetadata;
}

function stripThreadClass(designation: string): string {
  return designation.replace(/\s*\([^)]*\)\s*$/, "");
}

function threadClassFromDisplay(designation: string | undefined): string | undefined {
  return designation?.match(/\(([^)]+)\)\s*$/)?.[1];
}

/** Every Hole Wizard feature actually built in `document` (suppressed/rolled-back ones
 * excluded, matching the Hole Table's own "the rollback bar is the truth" convention),
 * reduced to one projection source per feature. A feature's multiple placement points all
 * share this metadata; the per-circle distinction is made later from the projected paths. */
function holeProjectionSources(document: CadDocument): HoleProjectionSource[] {
  const sources: HoleProjectionSource[] = [];

  for (const feature of document.features.slice(0, document.rollbackIndex)) {
    if (feature.kind !== "hole" || feature.suppressed) continue;

    const parameters = feature.parameters;
    const cutRadius = parameters.radius ?? 3;
    if (!Number.isFinite(cutRadius) || cutRadius <= 0) continue;

    const isTapped = parameters.holeType === "tapped" || parameters.holeType === "taper-tapped";
    const tappedEntry =
      isTapped && parameters.holeStandard && parameters.holeSize
        ? resolveTapDrill(parameters.holeStandard as TappedStandardId, parameters.holeSize)
        : undefined;
    const rawDesignation = tappedEntry?.designation ?? parameters.holeSize ?? parameters.threadDesignation;
    const designation = rawDesignation ? stripThreadClass(rawDesignation) : undefined;

    sources.push({
      sourceFeatureId: feature.id,
      cutRadius,
      threadMajorRadius: tappedEntry ? tappedEntry.nominalSize / 2 : undefined,
      metadata: {
        sourceFeatureId: feature.id,
        holeType: parameters.holeType ?? "simple",
        diameter: cutRadius * 2,
        holeDepth: Math.abs(parameters.depth ?? 10),
        endCondition: parameters.endCondition ?? "through-all",
        designation,
        holeStandard: parameters.holeStandard,
        holeSize: parameters.holeSize,
        holeFit: parameters.holeFit,
        threadClass: tappedEntry?.internalClass ?? threadClassFromDisplay(parameters.threadDesignation),
        threadDirection: parameters.threadDirection,
        fullDepthThread: parameters.fullDepthThread,
        threadDepth: parameters.threadDepth,
        seatType: parameters.seatType,
        seatDiameter: parameters.seatDiameter,
        seatDepthOrAngle: parameters.seatDepthOrAngle,
      },
    });
  }

  return sources;
}

/** ISO 6410's own thread-major-diameter symbol: a thin circle broken over a 90° gap (the
 * standard requires a visible break somewhere so it reads as "the thread crest," not a
 * second real edge; it doesn't mandate exactly where, so a fixed gap in the upper-right
 * reads consistently across every thread this app draws). */
const THREAD_ARC_GAP_DEGREES = 90;

function threadArcPath(cx: number, cy: number, r: number): string {
  const startDeg = 45;
  const sweepDeg = 360 - THREAD_ARC_GAP_DEGREES;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const startX = cx + r * Math.cos(toRad(startDeg));
  const startY = cy + r * Math.sin(toRad(startDeg));
  const endX = cx + r * Math.cos(toRad(startDeg + sweepDeg));
  const endY = cy + r * Math.sin(toRad(startDeg + sweepDeg));
  const largeArcFlag = sweepDeg > 180 ? 1 : 0;
  return `M ${startX} ${startY} A ${r} ${r} 0 ${largeArcFlag} 1 ${endX} ${endY}`;
}

function nearestHoleSource(circleRadius: number, sources: HoleProjectionSource[]): HoleProjectionSource | null {
  let best: HoleProjectionSource | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const source of sources) {
    const tolerance = Math.max(source.cutRadius * 0.05, 0.05);
    const delta = Math.abs(circleRadius - source.cutRadius);
    if (delta < tolerance && delta < bestDelta) {
      best = source;
      bestDelta = delta;
    }
  }
  return best;
}

interface HoleProjectionDecoration {
  threadPaths: string[];
  holeTargets: DrawingHoleTargetData[];
}

/**
 * One pass over `geometry`'s cached paths produces both Hole Wizard decorations: the
 * pickable callout targets for every hole that projects as a circle, and ISO 6410's
 * major-diameter arc for whichever of those circles is a tapped hole's drilled minor
 * diameter. Both consumers need exactly the same expensive `fitCircle` parse, so they
 * share it rather than scanning the view twice.
 *
 * Matching is deliberately geometric rather than feature-order-based: a circle is only a
 * hole target in views where it projects as a circle (straight down its own axis), and
 * duplicate visible/hidden loops for the same physical edge collapse to one target. Two
 * distinct hole features with identical radii remain geometrically ambiguous; the
 * closest/earliest source wins, with the saved callout still carrying its full snapshot.
 */
function holeDecorationsFor(
  geometry: { visiblePaths: string[]; hiddenPaths: string[] },
  sources: HoleProjectionSource[],
  projection: StandardProjectionKind,
): HoleProjectionDecoration {
  const decoration: HoleProjectionDecoration = { threadPaths: [], holeTargets: [] };
  if (sources.length === 0) return decoration;

  const seenTargets = new Set<string>();
  const seenThreads = new Set<string>();
  for (const d of [...geometry.visiblePaths, ...geometry.hiddenPaths]) {
    const circle = fitCircle(d);
    if (!circle) continue;
    const source = nearestHoleSource(circle.r, sources);
    if (!source) continue;

    const targetKey = [circle.cx, circle.cy, circle.r].map((value) => value.toFixed(4)).join("|");
    if (!seenTargets.has(targetKey)) {
      seenTargets.add(targetKey);
      decoration.holeTargets.push({
        id: `${projection}-${source.sourceFeatureId}-${decoration.holeTargets.length}`,
        cx: circle.cx,
        cy: circle.cy,
        radius: circle.r,
        metadata: source.metadata,
      });
    }

    if (!source.threadMajorRadius) continue;
    const threadKey = [circle.cx, circle.cy, source.threadMajorRadius].map((value) => value.toFixed(4)).join("|");
    if (seenThreads.has(threadKey)) continue;
    seenThreads.add(threadKey);
    decoration.threadPaths.push(threadArcPath(circle.cx, circle.cy, source.threadMajorRadius));
  }

  return decoration;
}

export async function rebuildAndProjectPart(
  document: CadDocument,
  sketches: Record<string, Sketch>,
): Promise<{ views: ProjectedViews; errors: Record<string, string> } | null> {
  const built = await rebuildPartShape(document, sketches);
  if (!built) return null;

  const iso = isometricCamera();
  // All six axis-aligned directions plus Isometric are projected every time, not just
  // whichever four the sheet currently shows — a Projected View (or a projection-method
  // toggle re-laying out an existing set) needs any of the six's own geometry on demand,
  // and re-running the WASM-backed `drawProjection` call seven times instead of four is
  // cheap next to the boolean-cut work a Section view already redoes on every recompute.
  const views: ProjectedViews = {
    front: projectOne(built.shape, "front"),
    top: projectOne(built.shape, "top"),
    bottom: projectOne(built.shape, "bottom"),
    left: projectOne(built.shape, "left"),
    right: projectOne(built.shape, "right"),
    back: projectOne(built.shape, "back"),
    iso: projectOne(built.shape, iso),
  };

  const holeSources = holeProjectionSources(document);
  if (holeSources.length > 0) {
    for (const key of Object.keys(views) as StandardProjectionKind[]) {
      const decoration = holeDecorationsFor(views[key], holeSources, key);
      views[key] = {
        ...views[key],
        threadPaths: decoration.threadPaths,
        holeTargets: decoration.holeTargets,
      };
    }
  }

  return { views, errors: built.errors };
}

/** Rebuilds and projects one auxiliary view. Kept separate from the seven standard-view
 * batch because the command creates only one supplementary direction at a time. */
export async function rebuildAndProjectAuxiliary(
  document: CadDocument,
  sketches: Record<string, Sketch>,
  projection: OrthoProjection,
  tiltAxis: AuxiliaryTiltAxis,
  angle: number,
): Promise<ProjectedGeometry | null> {
  const built = await rebuildPartShape(document, sketches);
  if (!built) return null;

  const geometry = projectOne(built.shape, auxiliaryCamera(projection, tiltAxis, angle));
  const sources = holeProjectionSources(document);
  if (sources.length === 0) return geometry;

  const decoration = holeDecorationsFor(geometry, sources, projection);
  return {
    ...geometry,
    threadPaths: decoration.threadPaths,
    holeTargets: decoration.holeTargets,
  };
}

/**
 * Which world axis a horizontal or vertical section cut line is perpendicular to, and the
 * world-space offset along it, given a click at `(u, v)` in a Front/Top/Right view's own
 * projected space (`projectOne`'s un-normalised (u, v) — i.e. the view's `originX/Y` plus
 * a local coordinate, *not* the sheet-rendered, Y-flipped-for-SVG one).
 *
 * Derived from replicad's own camera basis for each plane (`PROJECTION_PLANES` in its
 * source, `{dir, xAxis}` with `yAxis = dir × xAxis`): Front's (xAxis, yAxis) are
 * (world X, world Z); Top's are (world X, world −Y); Right's are (world −Y, world Z).
 * A *vertical* cut line holds the view's local `u` constant, so its plane's normal is the
 * axis `u` maps to; a *horizontal* line holds `v` constant the same way.
 */
export function sectionAxisAndOffset(
  projection: OrthoProjection,
  orientation: "horizontal" | "vertical",
  u: number,
  v: number,
): { axis: "x" | "y" | "z"; offset: number } {
  if (projection === "front") {
    return orientation === "vertical" ? { axis: "x", offset: u } : { axis: "z", offset: v };
  }
  if (projection === "top") {
    return orientation === "vertical" ? { axis: "x", offset: u } : { axis: "y", offset: -v };
  }
  // "right"
  return orientation === "vertical" ? { axis: "y", offset: -u } : { axis: "z", offset: v };
}

/**
 * Which direction the cutting-plane line's own sighting arrows should point, in
 * `sourceView`'s local screen space — `+1` means increasing local X (rightward) for a
 * vertical cut line, or increasing local screen Y (downward, since screen Y runs opposite
 * the un-normalised `v` register — see `runCreateSectionView`'s own `v = originY + (height
 * - localScreenPosition)` inversion) for a horizontal one.
 *
 * ISO 128-3's own convention: the arrows point in the direction of sight for the resulting
 * section — i.e. toward the kept material. Derived from the same per-projection axis
 * mapping `sectionAxisAndOffset` uses above: each (projection, orientation) pair maps its
 * local coordinate to a world axis value via a pure ±1 scale factor `S` (no offset — e.g.
 * Front-vertical's `u` *is* world X, Top-horizontal's `v` maps to world Y via `-v`), so
 * "which local direction moves toward the kept side" is exactly `keepPositiveSide ? S : -S`,
 * flipped once more for the horizontal case's own screen-Y inversion.
 */
export function sectionArrowSign(
  projection: OrthoProjection,
  orientation: "horizontal" | "vertical",
  keepPositiveSide: boolean,
): 1 | -1 {
  if (orientation === "vertical") {
    const s: 1 | -1 = projection === "right" ? -1 : 1;
    return keepPositiveSide ? s : (-s as 1 | -1);
  }
  const s: 1 | -1 = projection === "top" ? -1 : 1;
  const towardKeptInV = keepPositiveSide ? s : (-s as 1 | -1);
  return -towardKeptInV as 1 | -1;
}

function asCuttable(shape: unknown) {
  return shape as unknown as {
    translate: (vector: [number, number, number]) => unknown;
    rotate: (angle: number, position: [number, number, number], direction: [number, number, number]) => unknown;
  };
}

/**
 * A solid cube big enough to swallow the shape being cut, positioned so cutting it away
 * removes everything on one side of the world-space plane `axis = offset` —
 * `makeBaseBox`'s own Z extent runs from 0 to its length (not centred, unlike its X/Y), so
 * a box already built along Z only needs a translate to land its `z = 0` face exactly on
 * the cutting plane; for X or Y a 90° rotation first re-points that same asymmetric face
 * along the axis actually being cut.
 *
 * `size` is deliberately *not* the fixed `HALF_SPACE_SIZE` constant applied directly —
 * OpenCascade's boolean ops and the `FaceFinder.inPlane` lookup that finds the cut face
 * afterward both lose numerical precision when the cutting tool is many orders of
 * magnitude bigger than the shape it's cutting (a 100-metre box slicing a 50 mm part), so
 * callers instead pass a size scaled to the actual shape (see `cutAndProjectSection`).
 */
function halfSpaceBox(axis: "x" | "y" | "z", offset: number, keepPositiveSide: boolean, size: number) {
  let box = asCuttable(makeBaseBox(size, size, size));
  if (axis === "x") box = asCuttable(box.rotate(90, [0, 0, 0], [0, 1, 0]));
  else if (axis === "y") box = asCuttable(box.rotate(-90, [0, 0, 0], [1, 0, 0]));

  // Removes the negative side by default (box covers [offset - size, offset]); removing
  // the positive side instead just starts that same box at the plane rather than ending
  // there (box covers [offset, offset + size]).
  const shift = keepPositiveSide ? offset - size : offset;
  const translation: [number, number, number] =
    axis === "x" ? [shift, 0, 0] : axis === "y" ? [0, shift, 0] : [0, 0, shift];

  return box.translate(translation);
}

/** The plane a `FaceFinder.inPlane` needs to find the newly exposed cut face(s) — the
 * plane whose normal is the axis being cut, matching `rebuild.ts`'s own `MIRROR_PLANES`. */
const AXIS_PLANE: Record<"x" | "y" | "z", PlaneName> = { x: "YZ", y: "XZ", z: "XY" };

/** Every `DrawingProjectionKind` a Section view's own camera can land on — i.e. every one
 * except `"iso"`, which is also exactly replicad's own `ProjectionPlane` string union, so
 * this is what actually gets passed to `drawProjection` below. */
export type SectionCameraKind = Exclude<DrawingProjectionKind, "iso">;

/**
 * Which of replicad's six axis-aligned cameras a Section view's own camera should use.
 *
 * A section view must look *straight at* the newly exposed cut face — not reuse its
 * source view's own direction — or that face projects edge-on as a line instead of a
 * fillable area (easy to get wrong: cutting a Front view's vertical line still feels like
 * it should stay "front", but the cut face there has normal X, which is perpendicular to
 * Front's own view direction Y, so looking along Y again shows that face edge-on). The
 * camera instead looks *along the cut axis itself*, from whichever side has the kept
 * material, toward the cut: keeping the positive side means viewing from further along
 * the positive axis back toward the cut (e.g. a positive-X cut is viewed by "right", which
 * looks in the −X direction); keeping the negative side flips to the opposite named plane.
 */
export function sectionViewCamera(axis: "x" | "y" | "z", keepPositiveSide: boolean): SectionCameraKind {
  const byAxis: Record<"x" | "y" | "z", [SectionCameraKind, SectionCameraKind]> = {
    x: ["right", "left"],
    y: ["front", "back"],
    // A positive-Z cut is viewed from *below* looking up (replicad's own "bottom" camera
    // looks in the +Z direction) — the kept upper material's cut face faces down.
    z: ["bottom", "top"],
  };
  const [positive, negative] = byAxis[axis];
  return keepPositiveSide ? positive : negative;
}

export interface SectionGeometry extends ProjectedGeometry {
  /** SVG path `d` strings for the newly exposed cut face(s)' own outline — fill these with
   * a hatch pattern (`DrawingSheet.tsx`'s `<pattern>` fill) per ISO 128-3. Empty when the
   * cutting plane happened to miss the solid's interior entirely (a cut past its bounds). */
  hatchPaths: string[];
}

/**
 * Cuts `shape` with a world-space half-space and projects what remains — from a camera
 * chosen to look straight at the cut (`sectionViewCamera`), with the newly exposed face(s)'
 * own outline additionally traced for hatching. Faces are found via `FaceFinder().inPlane`
 * on the *cut* solid (only the boolean cut itself creates them, so this always runs after
 * `cut`), each re-projected from the same camera and folded into the same `minX`/`minY`
 * origin the main geometry uses, so hatch paths land exactly where the outline they fill
 * says they should.
 */
/** Points sampled along a hatch face's wire outline — a Wire is `_1DShape` too (a
 * `BRepAdaptor_CompCurve` treating every edge in it as one continuous curve), so
 * `pointAt(t)` alone walks the whole loop in the right order without touching individual
 * edges' own orientation. Coarse enough for a fill outline, fine enough that filleted
 * corners still read as curves rather than facets. */
const HATCH_WIRE_SAMPLES = 48;

/** Projects one closed wire to a 2D SVG subpath ("M...Z") using the same camera basis
 * `drawProjection` itself resolves a named plane to (`lookFromPlane`'s cameras all sit at
 * the world origin, so `point · axis` alone matches its real projector with no extra
 * offset math needed) — kept in the same `minX`/`minY`-shifted origin as the view's own
 * visible/hidden edges so the fill lands exactly under the outline it belongs to. */
function projectWireOutline(wire: Wire, camera: ProjectionCamera, minX: number, minY: number): string {
  const segments: string[] = [];
  for (let i = 0; i <= HATCH_WIRE_SAMPLES; i += 1) {
    const point = wire.pointAt(i / HATCH_WIRE_SAMPLES);
    const x = point.dot(camera.xAxis) - minX;
    const y = point.dot(camera.yAxis) - minY;
    segments.push(`${i === 0 ? "M" : "L"} ${x} ${y}`);
  }
  return `${segments.join(" ")} Z`;
}

/** One face's full hatch fill outline: its outer boundary plus every inner wire (a hole
 * punched through the cut cross-section) as additional subpaths in the same `d` string,
 * relying on the `fillRule="evenodd"` the caller renders this with to cut them out. */
function faceHatchPath(face: Face, camera: ProjectionCamera, minX: number, minY: number): string {
  // `Face#outerWire()`/`#innerWires()` each delete the face they're called on (replicad's
  // own GC-scoping convention) — `outerWire()` runs on a throwaway `clone()` so the real
  // `face` survives to have `innerWires()` (which deletes it for real) called last.
  const outer = projectWireOutline(face.clone().outerWire(), camera, minX, minY);
  const inner = face.innerWires().map((wire) => projectWireOutline(wire, camera, minX, minY));
  return [outer, ...inner].join(" ");
}

function cutAndProjectSection(
  shape: AnyShape,
  axis: "x" | "y" | "z",
  offset: number,
  keepPositiveSide: boolean,
): SectionGeometry {
  // 10x the shape's own largest dimension (plus a flat margin) safely clears it from every
  // direction without the precision loss `halfSpaceBox`'s own doc comment describes.
  const partBounds = shape.boundingBox;
  const toolSize = Math.max(partBounds.width, partBounds.height, partBounds.depth) * 10 + 100;

  const tool = halfSpaceBox(axis, offset, keepPositiveSide, toolSize);
  const cutShape = (shape as unknown as { cut: (tool: unknown) => AnyShape }).cut(tool);
  const camera = sectionViewCamera(axis, keepPositiveSide);

  const { visible, hidden } = drawProjection(cutShape, camera);
  const box = visible.boundingBox;
  box.add(hidden.boundingBox);
  const [[minX, minY], [maxX, maxY]] = box.bounds;
  const width = Math.max(maxX - minX, MIN_VIEW_SIZE);
  const height = Math.max(maxY - minY, MIN_VIEW_SIZE);

  // Hatching is a finishing touch on top of a geometrically complete section view (the
  // solid really is cut, and its real edges already render above), so a failure tracing
  // the cut face(s) for fill — an edge case in the underlying OpenCascade binding, not
  // anything this app's own code gets to control — degrades to an unhatched-but-otherwise-
  // correct section rather than losing the section view entirely.
  let hatchPaths: string[] = [];
  try {
    const cameraAxes = lookFromPlane(camera);
    const hatchFaces = new FaceFinder().inPlane(AXIS_PLANE[axis], offset).find(cutShape);
    hatchPaths = hatchFaces.map((face) => faceHatchPath(face, cameraAxes, minX, minY));
  } catch (err) {
    console.error("HATCH DEBUG err", err);
    hatchPaths = [];
  }

  return {
    visiblePaths: flattenPaths(visible.translate(-minX, -minY).toSVGPaths()),
    hiddenPaths: flattenPaths(hidden.translate(-minX, -minY).toSVGPaths()),
    width,
    height,
    originX: minX,
    originY: minY,
    hatchPaths,
  };
}

export async function rebuildAndProjectSection(
  document: CadDocument,
  sketches: Record<string, Sketch>,
  axis: "x" | "y" | "z",
  offset: number,
  keepPositiveSide: boolean,
): Promise<SectionGeometry | null> {
  const built = await rebuildPartShape(document, sketches);
  if (!built) return null;
  return cutAndProjectSection(built.shape, axis, offset, keepPositiveSide);
}
