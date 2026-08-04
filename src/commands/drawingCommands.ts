import { openFile, readFileAtPath } from "@/io/files";
import {
  rebuildAndProjectPart,
  rebuildAndProjectSection,
  sectionAxisAndOffset,
  type OrthoProjection,
  type ProjectedViews,
} from "@/kernel/drawingProjection";
import type { Sketch } from "@/sketch/types";
import { useDocumentStore } from "@/state/documentStore";
import { useDrawingToolStore } from "@/state/drawingToolStore";
import { useGeometryStore } from "@/state/geometryStore";
import type { CadDocument, DrawingProjectionKind, DrawingSheetData, DrawingViewData } from "@/types/document";

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

  const centerOf = (projection: DrawingProjectionKind, columnX: number, rowY: number) => ({
    x: columnX + (views[projection].width * scale) / 2,
    y: rowY + (views[projection].height * scale) / 2,
  });

  const frontColumnX = SHEET_MARGIN;
  const rightColumnX = SHEET_MARGIN + columnWidth + VIEW_GAP;
  const topRowY = SHEET_MARGIN;
  const frontRowY = SHEET_MARGIN + views.top.height * scale + VIEW_GAP;

  const centers: Record<DrawingProjectionKind, { x: number; y: number }> = {
    top: centerOf("top", frontColumnX, topRowY),
    front: centerOf("front", frontColumnX, frontRowY),
    right: centerOf("right", rightColumnX, frontRowY),
    iso: centerOf("iso", rightColumnX, topRowY),
  };

  const labels: Record<DrawingProjectionKind, string> = { front: "FRONT", top: "TOP", right: "RIGHT", iso: "ISO" };

  return (Object.keys(views) as DrawingProjectionKind[]).map((projection) => ({
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
async function readSourcePart(
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
      const next = projected.views[view.projection];
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
    const projected = await rebuildAndProjectSection(
      source.document,
      source.sketches,
      sourceView.projection as OrthoProjection,
      axis,
      offset,
      !flipped,
    );
    if (!projected) {
      showToast(`${source.label} has no geometry to project there`, 5000);
      return;
    }

    const newView: DrawingViewData = {
      id: crypto.randomUUID(),
      label: `SECTION ${axis.toUpperCase()}-${axis.toUpperCase()}`,
      projection: sourceView.projection,
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
