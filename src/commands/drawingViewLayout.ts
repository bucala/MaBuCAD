import type { DrawingHoleTargetData, DrawingViewData, ProjectionMethod, ScreenAxis, StandardProjectionKind } from "@/types/document";

/**
 * Pure sheet-position math for the standard six-view (plus Isometric) layout — factored out
 * of `drawingCommands.ts` so both the initial Insert Model View layout and a later
 * projection-method toggle can share exactly one source of truth for "where does each
 * standard view sit relative to Front."
 *
 * ISO 128-30 defines two projection conventions that place the same six orthogonal views in
 * mirrored positions around Front — see `ProjectionMethod`'s own doc comment in
 * `types/document.ts`. Every placed `"standard"` view is *associated* to whichever one is
 * `"front"`: its sheet position is always re-derived from Front's own position plus its own
 * projection direction, never stored independently, so switching a document's
 * `projectionMethod` (or adding a further Projected View later) can always recompute a
 * fully consistent layout from scratch rather than accumulating drift.
 */

export const DEFAULT_PROJECTION_METHOD: ProjectionMethod = "ISO-E";

/** mm between neighbouring views' bounding boxes. */
export const VIEW_GAP = 30;
/** Sheet margin the initial layout starts its top-left-most view from. */
export const SHEET_MARGIN = 40;

interface StepOffset {
  /** Steps to the right of Front (negative = left), in units of "one view + one gap". */
  stepX: -1 | 0 | 1 | 2;
  /** Steps below Front (negative = above). */
  stepY: -1 | 0 | 1;
}

/**
 * ISO-A (3rd quadrant / American arrangement): Top above, Bottom below, Right beside Right,
 * Left beside Left — the "as seen" placement every view's own name already suggests.
 */
const ISO_A_STEPS: Record<StandardProjectionKind, StepOffset> = {
  front: { stepX: 0, stepY: 0 },
  top: { stepX: 0, stepY: -1 },
  bottom: { stepX: 0, stepY: 1 },
  right: { stepX: 1, stepY: 0 },
  left: { stepX: -1, stepY: 0 },
  back: { stepX: 2, stepY: 0 },
  iso: { stepX: 1, stepY: -1 },
};

/**
 * ISO-E (1st quadrant / European arrangement): each view lands on the *opposite* side from
 * where its name suggests — the projection plane sits on the far side of the object from
 * the observer, so "the view from the right" unfolds onto the left. Back stays on the same
 * side as ISO-A's own convention (both arrangements' own six-view "cross" diagrams place it
 * as a fourth item continuing the same row the side views started, rather than mirroring it
 * too — there is nothing to mirror it *against*, since Back has no "as seen" side to begin
 * with).
 */
const ISO_E_STEPS: Record<StandardProjectionKind, StepOffset> = {
  front: { stepX: 0, stepY: 0 },
  top: { stepX: 0, stepY: 1 },
  bottom: { stepX: 0, stepY: -1 },
  right: { stepX: -1, stepY: 0 },
  left: { stepX: 1, stepY: 0 },
  back: { stepX: 2, stepY: 0 },
  iso: { stepX: 1, stepY: -1 },
};

function stepFor(projection: StandardProjectionKind, method: ProjectionMethod): StepOffset {
  return (method === "ISO-E" ? ISO_E_STEPS : ISO_A_STEPS)[projection];
}

export const PROJECTION_LABELS: Record<StandardProjectionKind, string> = {
  front: "FRONT",
  top: "TOP",
  bottom: "BOTTOM",
  left: "LEFT",
  right: "RIGHT",
  back: "BACK",
  iso: "ISO",
};

interface SizedView {
  width: number;
  height: number;
  scale: number;
}

/** What `layoutInitialViews` needs per direction beyond bare sizing — the actual cached
 * geometry a fresh `DrawingViewData` is built from. */
interface InitialViewGeometry extends SizedView {
  visiblePaths: string[];
  hiddenPaths: string[];
  originX: number;
  originY: number;
  threadPaths?: string[];
  holeTargets?: DrawingHoleTargetData[];
}

/**
 * Every placed standard view's centre position, given Front's own centre and every present
 * direction's own (unscaled) geometry size — including Front itself, echoed back unchanged.
 * A direction with no entry in `sized` is simply skipped (nothing to position).
 *
 * Walks outward from Front's own edges one direction at a time in ascending step order, so
 * Back (two steps out) always lands beyond whichever view occupies the one step in between,
 * however wide that view turns out to be — the same "accumulate real extents, don't assume
 * a fixed column width" approach `runCreateProjectedView` already used for a single pair of
 * views, generalised to the whole six-view set.
 */
export function computeStandardViewPositions(
  front: { x: number; y: number } & SizedView,
  sized: Partial<Record<StandardProjectionKind, SizedView>>,
  method: ProjectionMethod,
  gap: number = VIEW_GAP,
): Partial<Record<StandardProjectionKind, { x: number; y: number }>> {
  const positions: Partial<Record<StandardProjectionKind, { x: number; y: number }>> = {
    front: { x: front.x, y: front.y },
  };

  const halfExtent = (view: SizedView) => ({ w: (view.width * view.scale) / 2, h: (view.height * view.scale) / 2 });
  const frontHalf = halfExtent(front);

  const directions = (Object.keys(sized) as StandardProjectionKind[]).filter((direction) => direction !== "front");
  const byStep = (predicate: (step: StepOffset) => boolean) =>
    directions
      .filter((direction) => predicate(stepFor(direction, method)))
      .sort((a, b) => {
        const sa = stepFor(a, method);
        const sb = stepFor(b, method);
        return Math.abs(sa.stepX) + Math.abs(sa.stepY) - (Math.abs(sb.stepX) + Math.abs(sb.stepY));
      });

  const rightChain = byStep((step) => step.stepX > 0 && step.stepY === 0);
  const leftChain = byStep((step) => step.stepX < 0 && step.stepY === 0);
  const belowChain = byStep((step) => step.stepY > 0 && step.stepX === 0);
  const aboveChain = byStep((step) => step.stepY < 0 && step.stepX === 0);

  let rightEdge = front.x + frontHalf.w;
  for (const direction of rightChain) {
    const half = halfExtent(sized[direction]!);
    const cx = rightEdge + gap + half.w;
    positions[direction] = { x: cx, y: front.y };
    rightEdge = cx + half.w;
  }

  let leftEdge = front.x - frontHalf.w;
  for (const direction of leftChain) {
    const half = halfExtent(sized[direction]!);
    const cx = leftEdge - gap - half.w;
    positions[direction] = { x: cx, y: front.y };
    leftEdge = cx - half.w;
  }

  let bottomEdge = front.y + frontHalf.h;
  for (const direction of belowChain) {
    const half = halfExtent(sized[direction]!);
    const cy = bottomEdge + gap + half.h;
    positions[direction] = { x: front.x, y: cy };
    bottomEdge = cy + half.h;
  }

  let topEdge = front.y - frontHalf.h;
  for (const direction of aboveChain) {
    const half = halfExtent(sized[direction]!);
    const cy = topEdge - gap - half.h;
    positions[direction] = { x: front.x, y: cy };
    topEdge = cy - half.h;
  }

  // Iso has no shared axis of its own to align to (its projection isn't world-axis-aligned)
  // — parked in the same corner as whichever views occupy the immediate right/above slots,
  // falling back to its own computed offset from Front when one of those is missing.
  if (sized.iso) {
    const isoHalf = halfExtent(sized.iso);
    const fallbackX = front.x + frontHalf.w + gap + isoHalf.w;
    const fallbackY = front.y - frontHalf.h - gap - isoHalf.h;
    positions.iso = {
      x: positions[rightChain[0]]?.x ?? fallbackX,
      y: positions[aboveChain[0]]?.y ?? fallbackY,
    };
  }

  return positions;
}

/**
 * Lays out a fresh set of standard views with Front anchored near the sheet's own top-left
 * margin — used by Insert Model View, which is always starting from an empty sheet. Leaves
 * room above/left of Front for whichever directions the active `method` puts there, so the
 * whole group (not just Front) ends up inset from the margin.
 *
 * `roomSizes` (defaulting to `geometry` itself, the old behaviour) is what the above/left
 * reservation is actually sized from — kept as a separate parameter because the orientation
 * picker (`runPlaceModelView`) only ever places *one* view in `geometry`, but still knows
 * every other direction's real projected size up front (`rebuildAndProjectPart` always
 * computes all seven). Passing those sizes here means a Projected View added later still
 * lands with room already reserved for it, rather than the group needing to shift once a
 * neighbour actually appears above/left of a Front that was inset for nothing but itself.
 */
export function layoutInitialViews(
  geometry: Partial<Record<StandardProjectionKind, InitialViewGeometry>>,
  method: ProjectionMethod,
  roomSizes: Partial<Record<StandardProjectionKind, SizedView>> = geometry,
): DrawingViewData[] {
  const front = geometry.front;
  if (!front) return [];

  const halfExtent = (view: SizedView) => ({ w: (view.width * view.scale) / 2, h: (view.height * view.scale) / 2 });
  const frontHalf = halfExtent(front);

  const aboveDirection = (Object.keys(roomSizes) as StandardProjectionKind[]).find((direction) => {
    const step = stepFor(direction, method);
    return step.stepX === 0 && step.stepY === -1;
  });
  const leftDirection = (Object.keys(roomSizes) as StandardProjectionKind[]).find((direction) => {
    const step = stepFor(direction, method);
    return step.stepX < 0 && step.stepY === 0;
  });

  const aboveRoom = aboveDirection && roomSizes[aboveDirection] ? halfExtent(roomSizes[aboveDirection]!).h * 2 + VIEW_GAP : 0;
  const leftRoom = leftDirection && roomSizes[leftDirection] ? halfExtent(roomSizes[leftDirection]!).w * 2 + VIEW_GAP : 0;

  const frontCentre = {
    x: SHEET_MARGIN + leftRoom + frontHalf.w,
    y: SHEET_MARGIN + aboveRoom + frontHalf.h,
  };

  const positions = computeStandardViewPositions({ ...frontCentre, ...front }, geometry, method);

  return (Object.keys(geometry) as StandardProjectionKind[]).map((direction) => {
    const view = geometry[direction]!;
    const position = positions[direction]!;
    return {
      id: `view-${direction}`,
      label: PROJECTION_LABELS[direction],
      projection: direction,
      x: position.x,
      y: position.y,
      scale: view.scale,
      visiblePaths: view.visiblePaths,
      hiddenPaths: view.hiddenPaths,
      width: view.width,
      height: view.height,
      originX: view.originX,
      originY: view.originY,
      threadPaths: view.threadPaths,
      holeTargets: view.holeTargets,
      kind: "standard" as const,
    };
  });
}

/**
 * Re-derives every placed `"standard"` view's sheet position from Front's own current
 * position under `method` — called both right after adding a further Projected View (so
 * the whole group stays internally consistent, not just the two views directly involved)
 * and whenever the sheet's `projectionMethod` itself is toggled. Linked descendants follow
 * source movement along their shared axis; unlinked and freely placed views stay put.
 */
export function repositionStandardViews(views: DrawingViewData[], method: ProjectionMethod): DrawingViewData[] {
  const front = views.find((view) => (!view.kind || view.kind === "standard") && view.projection === "front");
  if (!front) return views;

  const sized: Partial<Record<StandardProjectionKind, SizedView>> = {};
  for (const view of views) {
    if (view.kind && view.kind !== "standard") continue;
    sized[view.projection as StandardProjectionKind] = { width: view.width, height: view.height, scale: view.scale };
  }

  const positions = computeStandardViewPositions(front, sized, method);

  let result = views;
  for (const view of views) {
    if ((view.kind && view.kind !== "standard") || view.alignmentUnlocked) continue;
    const position = positions[view.projection as StandardProjectionKind];
    if (position) result = moveAlignedViews(result, view.id, position.x, position.y);
  }
  return result;
}

/**
 * The creation-direction alignment link of a view: which sheet axis it shares with its
 * source, the coordinate that locks it, and the source's id — the drafting convention that
 * a projected/section view slides along its projection direction but stays square with the
 * view it was made from.
 *
 * Standard views align to Front (top/bottom share its X, left/right/back share its Y) —
 * the same association `computeStandardViewPositions` lays them out with, kept live while
 * dragging. A Section locks the axis *perpendicular* to its cut line's orientation (a
 * vertical cut projects horizontally, so Y stays locked) and an Auxiliary locks the axis
 * perpendicular to its tilt axis. Detail/Crop/Broken views return `null`: drafting places
 * them freely. The link is reported regardless of `alignmentUnlocked` — callers decide
 * whether it currently applies (a drag) or is being restored (re-link snaps back to it).
 */
export function alignmentLinkFor(
  view: DrawingViewData,
  views: DrawingViewData[],
): { axis: "x" | "y"; coordinate: number; sourceId: string } | null {
  const source = (id: string) => views.find((candidate) => candidate.id === id && candidate.id !== view.id);

  if (view.kind === "section" && view.section) {
    const parent = source(view.section.sourceViewId);
    if (!parent) return null;
    return view.section.orientation === "vertical"
      ? { axis: "y", coordinate: parent.y, sourceId: parent.id }
      : { axis: "x", coordinate: parent.x, sourceId: parent.id };
  }
  if (view.kind === "auxiliary" && view.auxiliaryOf) {
    const parent = source(view.auxiliaryOf.sourceViewId);
    if (!parent) return null;
    return view.auxiliaryOf.tiltAxis === "horizontal"
      ? { axis: "x", coordinate: parent.x, sourceId: parent.id }
      : { axis: "y", coordinate: parent.y, sourceId: parent.id };
  }
  if (!view.kind || view.kind === "standard") {
    if (view.projection === "front" || view.projection === "iso") return null;
    const front = views.find((candidate) =>
      candidate.id !== view.id &&
      (!candidate.kind || candidate.kind === "standard") &&
      candidate.projection === "front",
    );
    if (!front) return null;
    return view.projection === "top" || view.projection === "bottom"
      ? { axis: "x", coordinate: front.x, sourceId: front.id }
      : { axis: "y", coordinate: front.y, sourceId: front.id };
  }
  return null;
}

/** The link as it applies right now — absent when the user has deliberately unlinked the
 * view (`alignmentUnlocked`), which is the whole point of that flag. */
export function alignmentTargetFor(
  view: DrawingViewData,
  views: DrawingViewData[],
): { axis: "x" | "y"; coordinate: number; sourceId: string } | null {
  return view.alignmentUnlocked ? null : alignmentLinkFor(view, views);
}

/** Constrains a drag and carries linked descendants along their shared axis, without
 * changing their distance from the source along the free axis. A visited set also keeps
 * malformed source cycles in imported documents from looping forever. */
export function moveAlignedViews(
  views: DrawingViewData[],
  id: string,
  x: number,
  y: number,
  alignment?: { alignmentUnlocked: boolean },
): DrawingViewData[] {
  const original = views.find((view) => view.id === id);
  if (!original || !Number.isFinite(x) || !Number.isFinite(y)) return views;

  const moved = { ...original, ...alignment, x, y };
  const link = alignmentTargetFor(moved, views);
  if (link) moved[link.axis] = link.coordinate;
  if (moved.x === original.x && moved.y === original.y &&
      moved.alignmentUnlocked === original.alignmentUnlocked) return views;

  const positions = new Map([[id, moved]]);
  const queue = [id];
  for (let index = 0; index < queue.length; index += 1) {
    const sourceId = queue[index];
    const source = positions.get(sourceId)!;
    for (const candidate of views) {
      if (positions.has(candidate.id)) continue;
      const target = alignmentTargetFor(candidate, views);
      if (!target || target.sourceId !== sourceId) continue;
      positions.set(candidate.id, { ...candidate, [target.axis]: source[target.axis] });
      queue.push(candidate.id);
    }
  }

  return views.map((view) => {
    const position = positions.get(view.id);
    return position && (position.x !== view.x || position.y !== view.y ||
      position.alignmentUnlocked !== view.alignmentUnlocked) ? position : view;
  });
}

/** Initial placement uses the same row/column a later linked drag preserves. */
export function positionDerivedView(
  source: DrawingViewData,
  size: SizedView,
  direction: ScreenAxis,
): { x: number; y: number } {
  return direction === "horizontal"
    ? { x: source.x + (source.width * source.scale + size.width * size.scale) / 2 + VIEW_GAP, y: source.y }
    : { x: source.x, y: source.y + (source.height * source.scale + size.height * size.scale) / 2 + VIEW_GAP };
}

const CARDINAL_DIRECTIONS: StandardProjectionKind[] = ["front", "top", "bottom", "left", "right", "back"];

/** One further standard view reachable from a Projected View's source by exactly one
 * cardinal step, plus which screen arrow it belongs under. */
export interface ProjectableCandidate {
  direction: StandardProjectionKind;
  arrow: "up" | "down" | "left" | "right";
}

/**
 * `drawing.projected`'s own directional-arrow picker (`ProjectedViewOverlay.tsx`) needs to
 * know which further standard views make sense to offer around a clicked source, and under
 * which arrow — replacing a fixed "next logical projection" preference order with a real
 * direction choice. A candidate only qualifies when it differs from the source by a pure
 * step along one sheet axis (the same `stepFor` table `computeStandardViewPositions` already
 * uses), so the arrow shown is always the direction the new view will actually appear in.
 * Iso never qualifies (its projection isn't axis-aligned) — callers offer it separately.
 */
export function projectableDirections(
  source: StandardProjectionKind,
  existing: ReadonlySet<StandardProjectionKind>,
  method: ProjectionMethod,
): ProjectableCandidate[] {
  const sourceStep = stepFor(source, method);
  const byArrow = new Map<ProjectableCandidate["arrow"], ProjectableCandidate & { distance: number }>();
  for (const candidate of CARDINAL_DIRECTIONS) {
    if (candidate === source || existing.has(candidate)) continue;
    const step = stepFor(candidate, method);
    const dx = step.stepX - sourceStep.stepX;
    const dy = step.stepY - sourceStep.stepY;
    if (dx !== 0 && dy !== 0) continue;
    if (dx === 0 && dy === 0) continue;
    const arrow: ProjectableCandidate["arrow"] = dx !== 0 ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    const distance = Math.abs(dx) + Math.abs(dy);
    const current = byArrow.get(arrow);
    if (!current || distance < current.distance) byArrow.set(arrow, { direction: candidate, arrow, distance });
  }
  return Array.from(byArrow.values()).map(({ direction, arrow }) => ({ direction, arrow }));
}

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Keeps a crop window inside its source view and prevents a degenerate SVG viewBox. */
export function clampCropRegion(
  sourceWidth: number,
  sourceHeight: number,
  region: CropRegion,
): CropRegion {
  const width = Math.max(4, Math.min(region.width, sourceWidth));
  const height = Math.max(4, Math.min(region.height, sourceHeight));
  return {
    x: Math.max(0, Math.min(region.x, sourceWidth - width)),
    y: Math.max(0, Math.min(region.y, sourceHeight - height)),
    width,
    height,
  };
}

/** Normalises a broken-view band, preserving the requested direction while ensuring the
 * omitted strip has a visible minimum width and stays inside the source extent. */
export function clampBrokenBand(extent: number, start: number, end: number): { start: number; end: number } {
  const minimumBand = Math.min(4, Math.max(extent, 0));
  const safeStart = Math.max(0, Math.min(start, Math.max(0, extent - minimumBand)));
  const safeEnd = Math.max(safeStart + minimumBand, Math.min(end, extent));
  return { start: safeStart, end: safeEnd };
}
