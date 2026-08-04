import { openFile, readFileAtPath } from "@/io/files";
import { rebuildAndProjectPart, type ProjectedViews } from "@/kernel/drawingProjection";
import type { Sketch } from "@/sketch/types";
import { useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";
import type { CadDocument, DrawingProjectionKind, DrawingViewData } from "@/types/document";

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
 * Re-reads the referenced part and refreshes every existing view's cached geometry in
 * place, keeping each view's own placement/scale — unlike Insert Model View, which lays
 * views out fresh. Silently re-reads the file under Tauri when a real path was captured;
 * in the browser (or if the part was never picked, e.g. `null` `sourcePart`, which
 * `commandRegistry.ts` already guards against) it re-prompts with the file picker.
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
    let data: ArrayBuffer;
    let label = sourcePart.fileName;

    if (sourcePart.path) {
      data = await readFileAtPath(sourcePart.path);
    } else {
      showToast(`Pick ${sourcePart.fileName} again to update its views`, 4000);
      const picked = await openFile([EXTENSION, "json"]);
      if (!picked) return;
      data = picked.data;
      label = picked.name;
    }

    const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
    if (!isSavedPart(parsed)) throw new Error(`${label} is not a saved Part document`);

    showToast("Updating views…", 15000);
    const projected = await rebuildAndProjectPart(parsed.document, parsed.sketches);
    if (!projected) {
      showToast(`${label} has no geometry to project`, 5000);
      return;
    }

    const sheet = useDocumentStore.getState().document.drawing;
    if (!sheet) return;

    const refreshed = sheet.views.map((view) => {
      const next = projected.views[view.projection];
      return { ...view, visiblePaths: next.visiblePaths, hiddenPaths: next.hiddenPaths, width: next.width, height: next.height };
    });

    useDocumentStore.getState().setDrawingSheet({ ...sheet, views: refreshed });
    showToast("Views updated");
  } catch (error) {
    showToast(`Update Views failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}
