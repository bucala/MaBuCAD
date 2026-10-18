import type { DrawingSheetData, DrawingViewData } from "@/types/document";

/** Apply each view's position delta to its bound annotations, for drags and relayouts. */
export function withDrawingViewPositions(drawing: DrawingSheetData, views: DrawingViewData[]): DrawingSheetData {
  if (views === drawing.views) return drawing;
  const originals = new Map(drawing.views.map((view) => [view.id, view]));
  const deltas = new Map<string, { dx: number; dy: number }>();
  for (const view of views) {
    const original = originals.get(view.id);
    if (!original) continue;
    const dx = view.x - original.x;
    const dy = view.y - original.y;
    if (dx !== 0 || dy !== 0) deltas.set(view.id, { dx, dy });
  }
  if (deltas.size === 0) return { ...drawing, views };

  const shiftBound = <T extends { parentViewId?: string }>(
    items: T[] | undefined,
    shift: (item: T, delta: { dx: number; dy: number }) => T,
  ) => items?.map((item) => {
    const delta = deltas.get(item.parentViewId ?? "");
    return delta ? shift(item, delta) : item;
  });

  const shiftLeader = <T extends {
    anchorX: number; anchorY: number; labelX: number; labelY: number;
  }>(item: T, delta: { dx: number; dy: number }): T => ({
    ...item,
    anchorX: item.anchorX + delta.dx,
    anchorY: item.anchorY + delta.dy,
    labelX: item.labelX + delta.dx,
    labelY: item.labelY + delta.dy,
  });

  return {
    ...drawing,
    views,
    dimensions: shiftBound(drawing.dimensions, (dimension, delta) => ({
      ...dimension,
      x1: dimension.x1 + delta.dx,
      y1: dimension.y1 + delta.dy,
      x2: dimension.x2 + delta.dx,
      y2: dimension.y2 + delta.dy,
    })),
    ordinateChains: shiftBound(drawing.ordinateChains, (chain, delta) => ({
      ...chain,
      datumX: chain.datumX + delta.dx,
      datumY: chain.datumY + delta.dy,
      points: chain.points.map((point) => ({ ...point, x: point.x + delta.dx, y: point.y + delta.dy })),
    })),
    datums: shiftBound(drawing.datums, shiftLeader),
    gdtFrames: shiftBound(drawing.gdtFrames, shiftLeader),
    surfaceFinishes: shiftBound(drawing.surfaceFinishes, shiftLeader),
    welds: shiftBound(drawing.welds, shiftLeader),
    holeCallouts: shiftBound(drawing.holeCallouts, shiftLeader),
  };
}
