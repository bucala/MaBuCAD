import { openFile, readFileAtPath } from "@/io/files";
import {
  rebuildAndProjectPart,
  rebuildAndProjectSection,
  sectionAxisAndOffset,
  sectionViewCamera,
  type OrthoProjection,
  type ProjectedViews,
} from "@/kernel/drawingProjection";
import type { PointEntity, Sketch } from "@/sketch/types";
import { useDocumentStore } from "@/state/documentStore";
import { useDrawingToolStore } from "@/state/drawingToolStore";
import { useGeometryStore } from "@/state/geometryStore";
import type {
  CadDocument,
  DrawingSheetData,
  DrawingViewData,
  StandardProjectionKind,
} from "@/types/document";

/**
 * Drawing-only commands: Insert Model View and Update Views.
 *
 * Both read a saved `.mabucad` Part file independently of whatever tabs happen to be open
 * (see `workspaceStore.ts`'s own doc comment on why a Drawing references a file rather
 * than another open document directly) and project it into the active Drawing's sheet.
 */

const EXTENSION = "mabucad";

interface SavedDocument {
  formatVersion: number;
  document: CadDocument;
  sketches: Record<string, Sketch>;
}

function isSavedPart(value: unknown): value is SavedDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    "document" in value &&
    "sketches" in value &&
    (value as SavedDocument).document?.kind === "part"
  );
}

/** mm between neighbouring views' bounding boxes, and the sheet margin views start from. */
const VIEW_GAP = 30;
const SHEET_MARGIN = 40;

/**
 * Arranges the four standard views in the classic third-angle layout, in sheet
 * coordinates with Y growing downward (`DrawingSheet.tsx` renders the sheet the same way
 * every other 2D UI in this app already does — see its own doc comment on the per-view Y
 * flip): Top at the top-left, Front directly below it sharing the same left edge so the
 * two align vertically, Right beside Front sharing its top edge, and Isometric filling
 * the remaining corner beside Top.
 */
function layoutViews(views: ProjectedViews): DrawingViewData[] {
  const scale = 1;
  const columnWidth = Math.max(views.front.width, views.top.width) * scale;

  const centerOf = (projection: StandardProjectionKind, columnX: number, rowY: number) => ({
    x: columnX + (views[projection].width * scale) / 2,
    y: rowY + (views[projection].height * scale) / 2,
  });

  const frontColumnX = SHEET_MARGIN;
  const rightColumnX = SHEET_MARGIN + columnWidth + VIEW_GAP;
  const topRowY = SHEET_MARGIN;
  const frontRowY = SHEET_MARGIN + views.top.height * scale + VIEW_GAP;

  const centers: Record<StandardProjectionKind, { x: number; y: number }> = {
    top: centerOf("top", frontColumnX, topRowY),
    front: centerOf("front", frontColumnX, frontRowY),
    right: centerOf("right", rightColumnX, frontRowY),
    iso: centerOf("iso", rightColumnX, topRowY),
  };

  const labels: Record<StandardProjectionKind, string> = { front: "FRONT", top: "TOP", right: "RIGHT", iso: "ISO" };

  return (Object.keys(views) as StandardProjectionKind[]).map((projection) => ({
    id: `view-${projection}`,
    label: labels[projection],
    projection,
    x: centers[projection].x,
    y: centers[projection].y,
    scale,
    visiblePaths: views[projection].visiblePaths,
    hiddenPaths: views[projection].hiddenPaths,
    width: views[projection].width,
    height: views[projection].height,
    originX: views[projection].originX,
    originY: views[projection].originY,
    kind: "standard" as const,
  }));
}

/** Picks a saved Part file and generates all four standard views onto the active Drawing's
 * (empty) sheet, replacing whatever was there before. */
export async function runInsertModelView(): Promise<void> {
  const { showToast } = useGeometryStore.getState();

  try {
    const picked = await openFile([EXTENSION, "json"]);
    if (!picked) return;

    const parsed: unknown = JSON.parse(new TextDecoder().decode(picked.data));
    if (!isSavedPart(parsed)) throw new Error(`${picked.name} is not a saved Part document`);

    showToast("Generating views…", 15000);
    const projected = await rebuildAndProjectPart(parsed.document, parsed.sketches);
    if (!projected) {
      showToast(`${picked.name} has no geometry to project`, 5000);
      return;
    }

    useDocumentStore.getState().setDrawingSheet({
      sourcePart: { fileName: picked.name, path: picked.path },
      views: layoutViews(projected.views),
    });
    showToast(`Inserted views of ${picked.name}`);
  } catch (error) {
    showToast(`Insert Model View failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}

/**
 * Reads whatever Part file a Drawing's `sourcePart` points to — silently under Tauri when
 * a real path was captured, or by re-prompting with the file picker in the browser (or if
 * the part was never picked, e.g. `null` `sourcePart`, which every caller here already
 * guards against before calling this). Shared by Update Views and by creating a new
 * Section view, both of which need the referenced part's real geometry again.
 */
export async function readSourcePart(
  sourcePart: NonNullable<DrawingSheetData["sourcePart"]>,
  promptMessage: string,
): Promise<{ document: CadDocument; sketches: Record<string, Sketch>; label: string } | null> {
  let data: ArrayBuffer;
  let label = sourcePart.fileName;

  if (sourcePart.path) {
    data = await readFileAtPath(sourcePart.path);
  } else {
    useGeometryStore.getState().showToast(promptMessage, 4000);
    const picked = await openFile([EXTENSION, "json"]);
    if (!picked) return null;
    data = picked.data;
    label = picked.name;
  }

  const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
  if (!isSavedPart(parsed)) throw new Error(`${label} is not a saved Part document`);
  return { document: parsed.document, sketches: parsed.sketches, label };
}

/**
 * Re-reads the referenced part and refreshes every existing view's cached geometry in
 * place, keeping each view's own placement/scale — unlike Insert Model View, which lays
 * views out fresh.
 */
export async function runUpdateViews(): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const { document } = useDocumentStore.getState();
  const sourcePart = document.drawing?.sourcePart;
  if (!sourcePart) {
    showToast("Insert a Model View first");
    return;
  }

  try {
    const source = await readSourcePart(sourcePart, `Pick ${sourcePart.fileName} again to update its views`);
    if (!source) return;
    const { document: partDocument, sketches, label } = source;

    showToast("Updating views…", 15000);
    const projected = await rebuildAndProjectPart(partDocument, sketches);
    if (!projected) {
      showToast(`${label} has no geometry to project`, 5000);
      return;
    }

    const sheet = useDocumentStore.getState().document.drawing;
    if (!sheet) return;

    // Section and Detail views aren't a plain re-projection of `view.projection` (a
    // section is a *cut* solid, a detail is a crop of another view's own cache) — blanket-
    // refreshing them from `projected.views` here would silently replace either with the
    // wrong geometry. They keep their last-computed cache until recreated by their own tool.
    const refreshed = sheet.views.map((view) => {
      if (view.kind === "section" || view.kind === "detail") return view;
      // Safe: only a "standard" view reaches here, and those are always created with one
      // of `StandardProjectionKind`'s four values (see `layoutViews` above).
      const next = projected.views[view.projection as StandardProjectionKind];
      return {
        ...view,
        visiblePaths: next.visiblePaths,
        hiddenPaths: next.hiddenPaths,
        width: next.width,
        height: next.height,
        originX: next.originX,
        originY: next.originY,
      };
    });

    useDocumentStore.getState().setDrawingSheet({ ...sheet, views: refreshed });
    showToast("Views updated");
  } catch (error) {
    showToast(`Update Views failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}

/**
 * Creates a Section view from `sourceView` (a Front/Top/Right standard view —
 * `SectionOverlay.tsx` is what restricts the pick to those) by cutting the referenced part
 * along a world-space plane derived from where the cut line sits.
 *
 * `localScreenPosition` is the cut line's position in `sourceView`'s own rendered
 * (screen, Y-down, unscaled) space — `SectionOverlay.tsx` owns the interactive line the
 * user actually dragged; this only needs its final value to convert once into a world
 * offset via `sectionAxisAndOffset`. Re-reads the source part the same way Update Views
 * does, since a section cut needs the real kernel shape, not the cached 2D paths.
 */
export async function runCreateSectionView(
  sourceView: DrawingViewData,
  orientation: "horizontal" | "vertical",
  localScreenPosition: number,
  flipped: boolean,
): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const { document } = useDocumentStore.getState();
  const sourcePart = document.drawing?.sourcePart;
  if (!sourcePart) return;

  try {
    const source = await readSourcePart(sourcePart, `Pick ${sourcePart.fileName} again to create the section view`);
    if (!source) return;

    const originX = sourceView.originX ?? 0;
    const originY = sourceView.originY ?? 0;
    // `sectionAxisAndOffset` wants the raw (u, v) register `projectOne` produced (Y-up,
    // un-normalised) — undo the screen-space flip and add the view's own origin back in.
    const u = originX + localScreenPosition;
    const v = originY + (sourceView.height - localScreenPosition);
    const { axis, offset } = sectionAxisAndOffset(sourceView.projection as OrthoProjection, orientation, u, v);

    showToast("Creating section view…", 15000);
    const projected = await rebuildAndProjectSection(source.document, source.sketches, axis, offset, !flipped);
    if (!projected) {
      showToast(`${source.label} has no geometry to project there`, 5000);
      return;
    }

    const newView: DrawingViewData = {
      id: crypto.randomUUID(),
      label: `SECTION ${axis.toUpperCase()}-${axis.toUpperCase()}`,
      projection: sectionViewCamera(axis, !flipped),
      kind: "section",
      x: sourceView.x + sourceView.width * sourceView.scale + 40,
      y: sourceView.y,
      scale: sourceView.scale,
      visiblePaths: projected.visiblePaths,
      hiddenPaths: projected.hiddenPaths,
      width: projected.width,
      height: projected.height,
      originX: projected.originX,
      originY: projected.originY,
      hatchPaths: projected.hatchPaths,
      section: { axis, offset, keepPositiveSide: !flipped },
    };

    useDocumentStore.getState().addDrawingView(newView);
    useDrawingToolStore.getState().resetPicking();
    showToast("Section view created");
  } catch (error) {
    showToast(`Section view failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}

/**
 * Creates a Detail view: a magnified crop of `sourceView`'s own already-cached paths
 * within a circle (`cx`, `cy`, `radius`, in `sourceView`'s own rendered screen-space) —
 * see `DrawingSheet.tsx`'s `View` component for how `detailOf` drives the actual crop and
 * magnification at render time. No kernel work at all: this is a pure 2D operation on
 * geometry that's already been projected, so unlike a Section it needs no async rebuild.
 */
export function runCreateDetailView(sourceView: DrawingViewData, cx: number, cy: number, radius: number): void {
  const sheet = useDocumentStore.getState().document.drawing;
  if (!sheet) return;

  const existingDetailCount = sheet.views.filter((view) => view.kind === "detail").length;
  const letter = String.fromCharCode(65 + existingDetailCount);
  const scale = sourceView.scale * 2;

  const newView: DrawingViewData = {
    id: crypto.randomUUID(),
    label: `DETAIL ${letter}`,
    projection: sourceView.projection,
    kind: "detail",
    x: sourceView.x + (sourceView.width * sourceView.scale) / 2 + radius * scale + 30,
    y: sourceView.y,
    scale,
    visiblePaths: sourceView.visiblePaths,
    hiddenPaths: sourceView.hiddenPaths,
    width: radius * 2,
    height: radius * 2,
    detailOf: { sourceViewId: sourceView.id, cx, cy, radius, sourceHeight: sourceView.height },
  };

  useDocumentStore.getState().addDrawingView(newView);
  useDrawingToolStore.getState().resetPicking();
}

/** `drawing.projected`: preference order of the other three standard projections, given
 * whichever one was picked as the source — mirrors Inventor's own "click a base view, get
 * the next logical projection" default. There is no drag-to-direction UI here, since the
 * four fixed layout slots `layoutViews` already uses are the only positions this app's
 * standard views actually occupy. */
const PROJECTED_VIEW_PREFERENCE: Record<StandardProjectionKind, StandardProjectionKind[]> = {
  front: ["top", "right", "iso"],
  top: ["front", "right", "iso"],
  right: ["front", "top", "iso"],
  iso: ["front", "top", "right"],
};

const PROJECTION_LABELS: Record<StandardProjectionKind, string> = {
  front: "FRONT",
  top: "TOP",
  right: "RIGHT",
  iso: "ISO",
};

/**
 * Creates a Projected View: whichever of the four standard projections isn't on the sheet
 * yet, aligned to `sourceView` the same way `layoutViews` aligns the initial four (Top
 * shares Front's own x and sits above it, Right shares Front's own y and sits beside it).
 * Re-reads the source part and re-projects all four views the same way Update Views does,
 * since only the views already placed have cached paths — an unplaced projection has none.
 */
export async function runCreateProjectedView(sourceView: DrawingViewData): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const sheet = useDocumentStore.getState().document.drawing;
  const sourcePart = sheet?.sourcePart;
  if (!sheet || !sourcePart || sourceView.kind !== "standard") return;

  const existing = new Set(
    sheet.views.filter((view) => view.kind === "standard").map((view) => view.projection),
  );
  const preference =
    PROJECTED_VIEW_PREFERENCE[sourceView.projection as StandardProjectionKind] ?? (["front", "top", "right", "iso"] as const);
  const target = preference.find((projection) => !existing.has(projection));
  if (!target) {
    showToast("All four standard views are already on the sheet");
    return;
  }

  try {
    const source = await readSourcePart(sourcePart, `Pick ${sourcePart.fileName} again to create the projected view`);
    if (!source) return;

    showToast("Creating projected view…", 15000);
    const projected = await rebuildAndProjectPart(source.document, source.sketches);
    if (!projected) {
      showToast(`${source.label} has no geometry to project`, 5000);
      return;
    }

    const targetGeometry = projected.views[target];
    const scale = sourceView.scale;
    const sourceHalfW = (sourceView.width * scale) / 2;
    const sourceHalfH = (sourceView.height * scale) / 2;
    const targetHalfW = (targetGeometry.width * scale) / 2;
    const targetHalfH = (targetGeometry.height * scale) / 2;

    let x = sourceView.x;
    let y = sourceView.y;
    if (target === "top") {
      x = sourceView.projection === "right" ? sourceView.x - sourceHalfW - VIEW_GAP - targetHalfW : sourceView.x;
      y = sourceView.y - sourceHalfH - VIEW_GAP - targetHalfH;
    } else if (target === "front") {
      if (sourceView.projection === "top") {
        x = sourceView.x;
        y = sourceView.y + sourceHalfH + VIEW_GAP + targetHalfH;
      } else {
        x = sourceView.x - sourceHalfW - VIEW_GAP - targetHalfW;
        y = sourceView.y;
      }
    } else if (target === "right") {
      x = sourceView.x + sourceHalfW + VIEW_GAP + targetHalfW;
      y = sourceView.projection === "top" ? sourceView.y + sourceHalfH + VIEW_GAP + targetHalfH : sourceView.y;
    } else {
      // Iso has no shared axis to align to — parked at the same diagonal offset
      // `layoutViews` reserves for it in the initial four-view layout.
      x = sourceView.x + sourceHalfW + VIEW_GAP + targetHalfW;
      y = sourceView.y - sourceHalfH - VIEW_GAP - targetHalfH;
    }

    const newView: DrawingViewData = {
      id: crypto.randomUUID(),
      label: PROJECTION_LABELS[target],
      projection: target,
      kind: "standard",
      x,
      y,
      scale,
      visiblePaths: targetGeometry.visiblePaths,
      hiddenPaths: targetGeometry.hiddenPaths,
      width: targetGeometry.width,
      height: targetGeometry.height,
      originX: targetGeometry.originX,
      originY: targetGeometry.originY,
    };

    useDocumentStore.getState().addDrawingView(newView);
    useDrawingToolStore.getState().resetPicking();
    showToast(`${PROJECTION_LABELS[target]} view projected`);
  } catch (error) {
    showToast(`Projected View failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}

/** Below the current bounding box of every view already on the sheet, left-aligned to the
 * same margin `layoutViews` starts from — where both new table commands park their result,
 * since neither has a meaningful "near this geometry" anchor the way an annotation's pick
 * does. */
function tablePlacement(sheet: DrawingSheetData): { x: number; y: number } {
  const viewsBottom = sheet.views.reduce(
    (max, view) => Math.max(max, view.y + (view.height * view.scale) / 2),
    SHEET_MARGIN,
  );
  return { x: SHEET_MARGIN, y: viewsBottom + VIEW_GAP };
}

/**
 * Inserts a Hole Table: one row per Hole Wizard feature actually built in the referenced
 * part (suppressed or rolled-back ones excluded, matching the rest of the app's own "the
 * rollback bar is the truth" convention), ordinate-referenced from its own sketch's origin
 * — a hole's placement points live in sketch-local (x, y), the same datum a real ordinate
 * hole table measures from (ASME Y14.5's own "from a common datum" callout, here just the
 * sketch's own zero rather than a separately picked one, since a hole's sketch has no other
 * meaningful origin).
 */
export async function runInsertHoleTable(): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const { document: activeDocument } = useDocumentStore.getState();
  const sheet = activeDocument.drawing;
  const sourcePart = sheet?.sourcePart;
  if (!sheet || !sourcePart) {
    showToast("Insert a Model View first");
    return;
  }

  try {
    const source = await readSourcePart(sourcePart, `Pick ${sourcePart.fileName} again to build the hole table`);
    if (!source) return;

    const { document: partDocument, sketches } = source;
    const holeFeatures = partDocument.features
      .slice(0, partDocument.rollbackIndex)
      .filter((feature) => feature.kind === "hole" && !feature.suppressed);

    if (holeFeatures.length === 0) {
      showToast(`${source.label} has no holes to list`, 4000);
      return;
    }

    const rows: string[][] = [["HOLE", "X", "Y", "SIZE", "TYPE"]];
    let index = 1;
    for (const feature of holeFeatures) {
      const sketch = sketches[feature.parents[0]];
      if (!sketch) continue;
      const pointIds = sketch.entities
        .filter((entity): entity is PointEntity => entity.kind === "point")
        .map((entity) => entity.at);
      for (const pointId of pointIds) {
        const point = sketch.points.find((candidate) => candidate.id === pointId);
        if (!point) continue;
        const size = feature.parameters.holeSize ?? (feature.parameters.radius ? `⌀${(feature.parameters.radius * 2).toFixed(1)}` : "—");
        const type = feature.parameters.holeType ?? "simple";
        rows.push([`H${index}`, point.x.toFixed(2), point.y.toFixed(2), size, type]);
        index += 1;
      }
    }

    if (rows.length === 1) {
      showToast(`${source.label}'s holes have no placement points to list`, 4000);
      return;
    }

    const { x, y } = tablePlacement(sheet);
    useDocumentStore.getState().addDrawingTable({ kind: "hole", title: "HOLE TABLE", x, y, rows });
    showToast("Hole table inserted");
  } catch (error) {
    showToast(`Hole Table failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}

/**
 * Inserts a Bill of Materials table. This app's Drawing documents reference exactly one
 * saved Part (`sourcePart` — see `DrawingSheetData`'s own doc comment on why there is no
 * assembly-level multi-part list to draw from yet), so the table is honestly a one-row BOM
 * for that single part rather than a fabricated multi-item list: part name from the source
 * document's own title, material from its "Material" reference feature's name if the user
 * has renamed it away from the default placeholder.
 */
export async function runInsertBomTable(): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const { document: activeDocument } = useDocumentStore.getState();
  const sheet = activeDocument.drawing;
  const sourcePart = sheet?.sourcePart;
  if (!sheet || !sourcePart) {
    showToast("Insert a Model View first");
    return;
  }

  try {
    const source = await readSourcePart(sourcePart, `Pick ${sourcePart.fileName} again to build the BOM`);
    if (!source) return;

    const materialFeature = source.document.features.find((feature) => feature.kind === "material");
    const material =
      materialFeature && materialFeature.name !== "Material <not specified>" ? materialFeature.name : "—";

    const rows: string[][] = [
      ["ITEM", "PART NAME", "MATERIAL", "QTY"],
      ["1", source.document.name || source.label, material, "1"],
    ];

    const { x, y } = tablePlacement(sheet);
    useDocumentStore.getState().addDrawingTable({ kind: "bom", title: "BILL OF MATERIALS", x, y, rows });
    showToast("BOM table inserted");
  } catch (error) {
    showToast(`BOM Table failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}
