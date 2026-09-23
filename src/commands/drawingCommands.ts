import {
  DEFAULT_PROJECTION_METHOD,
  clampBrokenBand,
  clampCropRegion,
  layoutInitialViews,
  repositionStandardViews,
  VIEW_GAP,
  SHEET_MARGIN,
} from "@/commands/drawingViewLayout";
import { openFile, readFileAtPath, statAtPath } from "@/io/files";
import {
  rebuildAndProjectAuxiliary,
  rebuildAndProjectPart,
  rebuildAndProjectSection,
  sectionAxisAndOffset,
  sectionViewCamera,
  type AuxiliaryTiltAxis,
  type OrthoProjection,
} from "@/kernel/drawingProjection";
import { viewsMatchSource } from "@/kernel/drawingStaleness";
import { contentHash } from "@/kernel/rebuildCache";
import type { PointEntity, Sketch } from "@/sketch/types";
import { useDocumentStore } from "@/state/documentStore";
import { useDrawingToolStore } from "@/state/drawingToolStore";
import { useGeometryStore } from "@/state/geometryStore";
import type {
  CadDocument,
  DrawingSheetData,
  DrawingViewData,
  ScreenAxis,
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

/** The four standard views Insert Model View places by default — the other two axis-aligned
 * directions (Bottom, Left, Back) and the rest can be added one at a time via Projected
 * View, the same "start small, add what's actually needed" default the ribbon's own
 * `PROJECTED_VIEW_PREFERENCE` below already assumes. */
const DEFAULT_DIRECTIONS: StandardProjectionKind[] = ["front", "top", "right", "iso"];

/** Picks a saved Part file and generates the default set of standard views onto the active
 * Drawing's (empty) sheet, replacing whatever was there before — laid out per the sheet's
 * own `projectionMethod` (ISO-E by default). */
export async function runInsertModelView(): Promise<void> {
  const { showToast } = useGeometryStore.getState();

  try {
    const picked = await openFile([EXTENSION, "json"]);
    if (!picked) return;

    const text = new TextDecoder().decode(picked.data);
    const parsed: unknown = JSON.parse(text);
    if (!isSavedPart(parsed)) throw new Error(`${picked.name} is not a saved Part document`);

    showToast("Generating views…", 15000);
    const projected = await rebuildAndProjectPart(parsed.document, parsed.sketches);
    if (!projected) {
      showToast(`${picked.name} has no geometry to project`, 5000);
      return;
    }

    const existingMethod = useDocumentStore.getState().document.drawing?.projectionMethod;
    const method = existingMethod ?? DEFAULT_PROJECTION_METHOD;
    const geometry = Object.fromEntries(
      DEFAULT_DIRECTIONS.map((direction) => [direction, { ...projected.views[direction], scale: 1 }]),
    );

    useDocumentStore.getState().setDrawingSheet({
      sourcePart: { fileName: picked.name, path: picked.path },
      // Stamp the part file as it is right now, so the drawing can later tell (against a
      // fresh stat) whether the file changed since these views were projected — the
      // "out of date" hint `DrawingSheet.tsx` shows on Update Views.
      sourceStamp: picked.path ? (await statAtPath(picked.path)) ?? undefined : undefined,
      // The exact provenance of this cache, so a later Update Views can tell whether
      // re-projecting would change anything at all — see `DrawingSheetData`'s own comment.
      sourceContentHash: contentHash(text),
      views: layoutInitialViews(geometry, method),
      projectionMethod: method,
    });
    showToast(`Inserted views of ${picked.name}`);
  } catch (error) {
    showToast(`Insert Model View failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}

/** Toggles the sheet's `projectionMethod` (ISO-E ↔ ISO-A) and re-lays out every placed
 * standard view to match — the title block's own projection-method symbol cell calls this
 * on click. */
export function runToggleProjectionMethod(): void {
  const sheet = useDocumentStore.getState().document.drawing;
  if (!sheet) return;
  const next = (sheet.projectionMethod ?? DEFAULT_PROJECTION_METHOD) === "ISO-E" ? "ISO-A" : "ISO-E";
  useDocumentStore.getState().setDrawingSheet({
    ...sheet,
    projectionMethod: next,
    views: repositionStandardViews(sheet.views, next),
  });
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
): Promise<{
  document: CadDocument;
  sketches: Record<string, Sketch>;
  label: string;
  /** Hash of the exact bytes just read — what a caller stores as
   * `DrawingSheetData.sourceContentHash`, or compares against it to decide whether a
   * rebuild is needed at all. Computed here because this is where the bytes exist. */
  contentHash: string;
} | null> {
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

  const text = new TextDecoder().decode(data);
  const parsed: unknown = JSON.parse(text);
  if (!isSavedPart(parsed)) throw new Error(`${label} is not a saved Part document`);
  return { document: parsed.document, sketches: parsed.sketches, label, contentHash: contentHash(text) };
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
    const { document: partDocument, sketches, label, contentHash: onDiskHash } = source;

    const current = useDocumentStore.getState().document.drawing;
    const hasStandardViews = current?.views.some((view) => !view.kind || view.kind === "standard");
    // The part file is byte-for-byte what these views were projected from, so a rebuild and
    // re-projection would reproduce the cache it already has — seconds of kernel work for a
    // guaranteed identical result. Re-stamp instead, which also clears the out-of-date
    // indicator for the honest case of a part file merely re-saved without changing.
    if (current && hasStandardViews && viewsMatchSource(current.sourceContentHash, onDiskHash)) {
      const sourceStamp = sourcePart.path ? (await statAtPath(sourcePart.path)) ?? undefined : undefined;
      useDocumentStore.getState().setDrawingSheet({ ...current, sourceStamp });
      showToast(`${label} is unchanged — views are already up to date`);
      return;
    }

    showToast("Updating views…", 15000);
    const projected = await rebuildAndProjectPart(partDocument, sketches);
    if (!projected) {
      showToast(`${label} has no geometry to project`, 5000);
      return;
    }

    const sheet = useDocumentStore.getState().document.drawing;
    if (!sheet) return;

    // No derived view (Section/Detail/Auxiliary/Crop/Broken) is a plain re-projection of
    // `view.projection` — a section is a *cut* solid, an auxiliary a tilted re-projection,
    // and detail/crop/broken are 2D derivations of another view's own cache. Blanket-
    // refreshing them from `projected.views` here would silently replace any of them with
    // the wrong geometry. They keep their last-computed cache until recreated by their own
    // tool (auxiliary could be refreshed via `rebuildAndProjectAuxiliary`; that wiring is a
    // deliberate later step, not an oversight).
    const refreshed = sheet.views.map((view) => {
      if (view.kind && view.kind !== "standard") return view;
      // Safe: only a "standard" view reaches here, and those are always created with one
      // of `StandardProjectionKind`'s own values (see `layoutInitialViews`/
      // `repositionStandardViews` in `drawingViewLayout.ts`).
      const next = projected.views[view.projection as StandardProjectionKind];
      return {
        ...view,
        visiblePaths: next.visiblePaths,
        hiddenPaths: next.hiddenPaths,
        width: next.width,
        height: next.height,
        originX: next.originX,
        originY: next.originY,
        threadPaths: next.threadPaths,
        holeTargets: next.holeTargets,
      };
    });

    // Re-stamp the part file we just re-projected from: the new cache matches what is on
    // disk *now*, so the out-of-date indicator clears the moment the views are refreshed.
    const sourceStamp = sourcePart.path ? (await statAtPath(sourcePart.path)) ?? undefined : undefined;
    useDocumentStore
      .getState()
      .setDrawingSheet({ ...sheet, views: refreshed, sourceStamp, sourceContentHash: onDiskHash });
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
  orientation: ScreenAxis,
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

    // Read the sheet fresh — the earlier `document` snapshot predates the file pick, so
    // anything created while it was open would make this count (and letter) stale.
    const sheet = useDocumentStore.getState().document.drawing;
    if (!sheet) return;
    const letter = nextDerivedLetter(sheet, "section");

    const newView: DrawingViewData = {
      id: crypto.randomUUID(),
      label: `SECTION ${letter}-${letter}`,
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
      section: {
        axis,
        offset,
        keepPositiveSide: !flipped,
        sourceViewId: sourceView.id,
        orientation,
        localScreenPosition,
        letter,
      },
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

  const letter = nextDerivedLetter(sheet, "detail");
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

function nextDerivedLetter(sheet: DrawingSheetData, kind: DrawingViewData["kind"]): string {
  const count = sheet.views.filter((view) => view.kind === kind).length;
  return String.fromCharCode(65 + count);
}

/**
 * Creates a Crop view: a same-scale rectangular window into a source view's cached paths.
 * Unlike Detail, it is not magnified and uses a rectangular engineering crop boundary.
 */
export function runCreateCropView(
  sourceView: DrawingViewData,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const sheet = useDocumentStore.getState().document.drawing;
  if (!sheet) return;

  const crop = clampCropRegion(sourceView.width, sourceView.height, { x, y, width, height });
  const letter = nextDerivedLetter(sheet, "crop");

  const newView: DrawingViewData = {
    id: crypto.randomUUID(),
    label: `CROP ${letter}`,
    projection: sourceView.projection,
    kind: "crop",
    x: sourceView.x + sourceView.width * sourceView.scale + crop.width * sourceView.scale / 2 + 30,
    y: sourceView.y,
    scale: sourceView.scale,
    visiblePaths: sourceView.visiblePaths,
    hiddenPaths: sourceView.hiddenPaths,
    width: crop.width,
    height: crop.height,
    originX: sourceView.originX,
    originY: sourceView.originY,
    threadPaths: sourceView.threadPaths,
    holeTargets: sourceView.holeTargets,
    cropOf: {
      sourceViewId: sourceView.id,
      ...crop,
      sourceHeight: sourceView.height,
      letter,
    },
  };

  useDocumentStore.getState().addDrawingView(newView);
  useDrawingToolStore.getState().resetPicking();
  useGeometryStore.getState().showToast("Crop view created");
}

/**
 * Creates a Broken view: the source geometry remains the same, but the middle band is
 * masked at render time so a long repetitive part can be shortened without rebuilding it.
 */
export function runCreateBrokenView(
  sourceView: DrawingViewData,
  orientation: ScreenAxis,
  start: number,
  end: number,
): void {
  const sheet = useDocumentStore.getState().document.drawing;
  if (!sheet) return;

  const extent = orientation === "vertical" ? sourceView.width : sourceView.height;
  const { start: bandStart, end: bandEnd } = clampBrokenBand(extent, start, end);
  const letter = nextDerivedLetter(sheet, "broken");
  const newView: DrawingViewData = {
    id: crypto.randomUUID(),
    label: `BROKEN ${letter}`,
    projection: sourceView.projection,
    kind: "broken",
    x: sourceView.x + sourceView.width * sourceView.scale + 40,
    y: sourceView.y,
    scale: sourceView.scale,
    visiblePaths: sourceView.visiblePaths,
    hiddenPaths: sourceView.hiddenPaths,
    width: sourceView.width,
    height: sourceView.height,
    originX: sourceView.originX,
    originY: sourceView.originY,
    threadPaths: sourceView.threadPaths,
    holeTargets: sourceView.holeTargets,
    brokenOf: {
      sourceViewId: sourceView.id,
      orientation,
      start: bandStart,
      end: bandEnd,
      letter,
    },
  };

  useDocumentStore.getState().addDrawingView(newView);
  useDrawingToolStore.getState().resetPicking();
  useGeometryStore.getState().showToast("Broken view created");
}

/**
 * Creates an Auxiliary view by re-projecting the referenced part with a 30° (or user-set)
 * tilt from a Front/Top/Right source view. ISO is intentionally not offered as a base because
 * it has no single orthographic screen axis to use as the auxiliary reference.
 */
export async function runCreateAuxiliaryView(
  sourceView: DrawingViewData,
  tiltAxis: AuxiliaryTiltAxis,
  angle: number,
): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const { document } = useDocumentStore.getState();
  const sourcePart = document.drawing?.sourcePart;
  if (!sourcePart || sourceView.kind !== "standard" || sourceView.projection === "iso") return;

  try {
    const source = await readSourcePart(sourcePart, `Pick ${sourcePart.fileName} again to create the auxiliary view`);
    if (!source) return;

    showToast("Creating auxiliary view…", 15000);
    const projected = await rebuildAndProjectAuxiliary(
      source.document,
      source.sketches,
      sourceView.projection as OrthoProjection,
      tiltAxis,
      angle,
    );
    if (!projected) {
      showToast(`${source.label} has no geometry to project`, 5000);
      return;
    }

    const sheet = useDocumentStore.getState().document.drawing;
    if (!sheet) return;
    const letter = nextDerivedLetter(sheet, "auxiliary");
    const newView: DrawingViewData = {
      id: crypto.randomUUID(),
      label: `AUXILIARY ${letter}`,
      projection: sourceView.projection,
      kind: "auxiliary",
      x: sourceView.x + sourceView.width * sourceView.scale + 50,
      y: sourceView.y,
      scale: sourceView.scale,
      ...projected,
      auxiliaryOf: {
        sourceViewId: sourceView.id,
        baseProjection: sourceView.projection as Exclude<StandardProjectionKind, "iso">,
        tiltAxis,
        angle,
        letter,
      },
    };

    useDocumentStore.getState().addDrawingView(newView);
    useDrawingToolStore.getState().resetPicking();
    showToast("Auxiliary view created");
  } catch (error) {
    showToast(`Auxiliary view failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}

/** `drawing.projected`: preference order of the other directions, given whichever one was
 * picked as the source — mirrors Inventor's own "click a base view, get the next logical
 * projection" default. There is no drag-to-direction UI here; the six-view layout's own
 * fixed slots (`drawingViewLayout.ts`) are the only positions a standard view can occupy. */
const PROJECTED_VIEW_PREFERENCE: Record<StandardProjectionKind, StandardProjectionKind[]> = {
  front: ["top", "right", "iso", "bottom", "left", "back"],
  top: ["front", "right", "iso", "bottom", "left", "back"],
  bottom: ["front", "right", "iso", "top", "left", "back"],
  right: ["front", "top", "iso", "bottom", "left", "back"],
  left: ["front", "top", "iso", "bottom", "right", "back"],
  back: ["front", "top", "iso", "bottom", "left", "right"],
  iso: ["front", "top", "right", "bottom", "left", "back"],
};

/**
 * Creates a Projected View: whichever standard projection isn't on the sheet yet
 * (`PROJECTED_VIEW_PREFERENCE`, filtered to what's missing), then re-derives *every* placed
 * standard view's position from Front (`repositionStandardViews`) rather than just placing
 * the new one relative to `sourceView` — keeps the whole associated set internally
 * consistent even if `sourceView` itself wasn't Front. Re-reads the source part and
 * re-projects every direction the same way Update Views does, since only the views already
 * placed have cached paths — an unplaced projection has none.
 */
export async function runCreateProjectedView(sourceView: DrawingViewData): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const sheet = useDocumentStore.getState().document.drawing;
  const sourcePart = sheet?.sourcePart;
  if (!sheet || !sourcePart || sourceView.kind !== "standard") return;

  const existing = new Set(
    sheet.views.filter((view) => view.kind === "standard").map((view) => view.projection),
  );
  const preference = PROJECTED_VIEW_PREFERENCE[sourceView.projection as StandardProjectionKind];
  const target = preference.find((projection) => !existing.has(projection));
  if (!target) {
    showToast("Every standard view is already on the sheet");
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

    const newView: DrawingViewData = {
      id: crypto.randomUUID(),
      label: target.toUpperCase(),
      projection: target,
      kind: "standard",
      // Placeholder position — `repositionStandardViews` below overwrites this (and every
      // other placed standard view's own position) immediately after insertion.
      x: sourceView.x,
      y: sourceView.y,
      scale,
      visiblePaths: targetGeometry.visiblePaths,
      hiddenPaths: targetGeometry.hiddenPaths,
      width: targetGeometry.width,
      height: targetGeometry.height,
      originX: targetGeometry.originX,
      originY: targetGeometry.originY,
      threadPaths: targetGeometry.threadPaths,
      holeTargets: targetGeometry.holeTargets,
    };

    useDocumentStore.getState().addDrawingView(newView);
    const method = sheet.projectionMethod ?? DEFAULT_PROJECTION_METHOD;
    const afterAdd = useDocumentStore.getState().document.drawing;
    if (afterAdd) {
      useDocumentStore.getState().setDrawingSheet({ ...afterAdd, views: repositionStandardViews(afterAdd.views, method) });
    }
    useDrawingToolStore.getState().resetPicking();
    showToast(`${target.toUpperCase()} view projected`);
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
