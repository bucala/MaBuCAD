import {
  DEFAULT_PROJECTION_METHOD,
  clampBrokenBand,
  clampCropRegion,
  layoutInitialViews,
  positionDerivedView,
  VIEW_GAP,
  SHEET_MARGIN,
} from "@/commands/drawingViewLayout";
import { openFile, readFileAtPath, statAtPath } from "@/io/files";
import { PART_FILE_EXTENSION, parseSavedPart } from "@/io/partFiles";
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
import { useWorkspaceStore } from "@/state/workspaceStore";
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

const EXTENSION = PART_FILE_EXTENSION;

/** A dialog or kernel job can finish after the user switches tabs or edits the sheet. */
function captureDrawingCommand(): () => boolean {
  const { activeId } = useWorkspaceStore.getState();
  const { drawing } = useDocumentStore.getState().document;
  return () => {
    if (useWorkspaceStore.getState().activeId === activeId &&
        useDocumentStore.getState().document.drawing === drawing) return true;
    useGeometryStore.getState().showToast("Drawing command cancelled because the drawing changed");
    return false;
  };
}

/** Picks a saved Part file, projects every direction (cheap — `rebuildAndProjectPart`
 * always computes all seven regardless of how many get placed), and opens the orientation
 * picker rather than placing any view itself — the user's chosen direction becomes the
 * drawing's own "front" and is the only view `runPlaceModelView` places. */
export async function runInsertModelView(): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const isCurrent = captureDrawingCommand();

  try {
    const picked = await openFile([EXTENSION, "json"]);
    if (!picked) return;

    const text = new TextDecoder().decode(picked.data);
    const parsed = parseSavedPart(text, picked.name);
    if (!isCurrent()) return;

    showToast("Generating views…", 15000);
    const projected = await rebuildAndProjectPart(parsed.document, parsed.sketches);
    if (!projected) {
      showToast(`${picked.name} has no geometry to project`, 5000);
      return;
    }

    const sourceStamp = picked.path ? (await statAtPath(picked.path)) ?? undefined : undefined;
    if (!isCurrent()) return;
    useDrawingToolStore.getState().openModelViewPicker({
      fileName: picked.name,
      path: picked.path,
      // Stamped/hashed here, while the picked file is still in hand, and carried through to
      // `runPlaceModelView` unchanged — same provenance `DrawingSheetData.sourceStamp` and
      // `sourceContentHash` always needed, just computed before the user's orientation pick
      // instead of after.
      sourceStamp,
      sourceContentHash: contentHash(text),
      views: projected.views,
    });
    showToast("Choose the model's main view orientation", 3000);
  } catch (error) {
    showToast(`Insert Model View failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}

/** `ModelViewOrientationDialog.tsx`'s own confirm action: places the picked direction as the
 * drawing's sole initial view, tagged `projection: "front"` — `layoutInitialViews` and every
 * later Projected View/alignment computation already anchor the whole standard-view set on
 * whichever view *is* front, so the chosen direction becoming "front" is what makes the rest
 * of the layout machinery treat it as the main view without any further change. */
export function runPlaceModelView(direction: StandardProjectionKind): void {
  const picker = useDrawingToolStore.getState().modelViewPicker;
  if (!picker || useDocumentStore.getState().document.kind !== "drawing") return;

  const existingMethod = useDocumentStore.getState().document.drawing?.projectionMethod;
  const method = existingMethod ?? DEFAULT_PROJECTION_METHOD;
  const geometry = { front: { ...picker.views[direction], scale: 1 } };
  // Every direction's real projected size, for `layoutInitialViews`'s room reservation —
  // whichever ones the user adds later via Projected View use these exact labels/sizes
  // (`runCreateProjectedView` re-projects the same seven directions), so reserving space
  // for them now means the group never has to shift once they actually appear.
  const roomSizes = Object.fromEntries(
    (Object.keys(picker.views) as StandardProjectionKind[]).map((key) => [key, { ...picker.views[key], scale: 1 }]),
  );

  useDocumentStore.getState().setDrawingSheet({
    sourcePart: { fileName: picker.fileName, path: picker.path },
    sourceStamp: picker.sourceStamp,
    sourceContentHash: picker.sourceContentHash,
    views: layoutInitialViews(geometry, method, roomSizes),
    projectionMethod: method,
  });
  useDrawingToolStore.getState().closeModelViewPicker();
  useGeometryStore.getState().showToast(`Inserted view of ${picker.fileName}`);
}

/** Toggles the sheet's `projectionMethod` (ISO-E ↔ ISO-A) and re-lays out every placed
 * standard view to match — the title block's own projection-method symbol cell calls this
 * on click. */
export function runToggleProjectionMethod(): void {
  const sheet = useDocumentStore.getState().document.drawing;
  if (!sheet) return;
  const next = (sheet.projectionMethod ?? DEFAULT_PROJECTION_METHOD) === "ISO-E" ? "ISO-A" : "ISO-E";
  useDocumentStore.getState().layoutDrawingViews(next);
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
  path: string | null;
  contentHash: string;
} | null> {
  let label = sourcePart.fileName;
  let path = sourcePart.path;
  let data: ArrayBuffer | undefined;
  if (path) {
    try {
      data = await readFileAtPath(path);
    } catch {
      // The file may have moved or its read approval expired when the app closed.
    }
  }
  if (!data) {
    useGeometryStore.getState().showToast(promptMessage, 4000);
    const picked = await openFile([EXTENSION, "json"]);
    if (!picked) return null;
    ({ name: label, path, data } = picked);
  }
  const text = new TextDecoder().decode(data);
  const { document, sketches } = parseSavedPart(text, label);
  return { document, sketches, label, path, contentHash: contentHash(text) };
}

/**
 * Re-reads the referenced part and refreshes every existing view's cached geometry in
 * place, keeping each view's own placement/scale — unlike Insert Model View, which lays
 * views out fresh.
 */
export async function runUpdateViews(): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const isCurrent = captureDrawingCommand();
  const { document } = useDocumentStore.getState();
  const sourcePart = document.drawing?.sourcePart;
  if (!sourcePart) {
    showToast("Insert a Model View first");
    return;
  }

  try {
    const source = await readSourcePart(sourcePart, `Pick ${sourcePart.fileName} again to update its views`);
    if (!source || !isCurrent()) return;
    const { document: partDocument, sketches, label, path, contentHash: onDiskHash } = source;
    const linkedPart = { fileName: label, path };

    const current = document.drawing;
    const hasStandardViews = current?.views.some((view) => !view.kind || view.kind === "standard");
    // The part file is byte-for-byte what these views were projected from, so a rebuild and
    // re-projection would reproduce the cache it already has — seconds of kernel work for a
    // guaranteed identical result. Re-stamp instead, which also clears the out-of-date
    // indicator for the honest case of a part file merely re-saved without changing.
    if (current && hasStandardViews && viewsMatchSource(current.sourceContentHash, onDiskHash)) {
      const sourceStamp = path ? (await statAtPath(path)) ?? undefined : undefined;
      if (!isCurrent()) return;
      useDocumentStore.getState().setDrawingSheet({ ...current, sourcePart: linkedPart, sourceStamp });
      showToast(`${label} is unchanged — views are already up to date`);
      return;
    }

    showToast("Updating views…", 15000);
    const projected = await rebuildAndProjectPart(partDocument, sketches);
    if (!projected) {
      showToast(`${label} has no geometry to project`, 5000);
      return;
    }

    const sheet = document.drawing;
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
    const sourceStamp = path ? (await statAtPath(path)) ?? undefined : undefined;
    if (!isCurrent()) return;
    useDocumentStore.getState().setDrawingSheet({
      ...sheet, views: refreshed, sourcePart: linkedPart, sourceStamp, sourceContentHash: onDiskHash,
    });
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
  const isCurrent = captureDrawingCommand();
  const { document } = useDocumentStore.getState();
  const sourcePart = document.drawing?.sourcePart;
  if (!sourcePart) return;

  try {
    const source = await readSourcePart(sourcePart, `Pick ${sourcePart.fileName} again to create the section view`);
    if (!source || !isCurrent()) return;

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
      ...positionDerivedView(
        sourceView,
        { ...projected, scale: sourceView.scale },
        orientation === "vertical" ? "horizontal" : "vertical",
      ),
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

    if (!isCurrent()) return;
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
  const isCurrent = captureDrawingCommand();
  const { document } = useDocumentStore.getState();
  const sourcePart = document.drawing?.sourcePart;
  if (!sourcePart || sourceView.kind !== "standard" || sourceView.projection === "iso") return;

  try {
    const source = await readSourcePart(sourcePart, `Pick ${sourcePart.fileName} again to create the auxiliary view`);
    if (!source || !isCurrent()) return;

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
      ...positionDerivedView(
        sourceView,
        { ...projected, scale: sourceView.scale },
        tiltAxis === "horizontal" ? "vertical" : "horizontal",
      ),
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

    if (!isCurrent()) return;
    useDocumentStore.getState().addDrawingView(newView);
    useDrawingToolStore.getState().resetPicking();
    showToast("Auxiliary view created");
  } catch (error) {
    showToast(`Auxiliary view failed: ${error instanceof Error ? error.message : "unknown error"}`, 6000);
  }
}

/**
 * Creates a Projected View in `target`'s direction from `sourceView` — the direction comes
 * from `ProjectedViewOverlay.tsx`'s own cardinal-arrow/Iso-corner pick
 * (`drawingViewLayout.ts`'s `projectableDirections`), not an auto-picked "next logical
 * projection"; there is a real drag-to-direction choice before this ever runs. Re-derives
 * *every* placed standard view's position from Front (`repositionStandardViews`, via
 * `addDrawingView`) rather than just placing the new one relative to `sourceView` — keeps
 * the whole associated set internally consistent even if `sourceView` itself wasn't Front.
 * Re-reads the source part and re-projects every direction the same way Update Views does,
 * since only the views already placed have cached paths — an unplaced projection has none.
 */
export async function runCreateProjectedView(
  sourceView: DrawingViewData,
  target: StandardProjectionKind,
): Promise<void> {
  const { showToast } = useGeometryStore.getState();
  const isCurrent = captureDrawingCommand();
  const sheet = useDocumentStore.getState().document.drawing;
  const sourcePart = sheet?.sourcePart;
  if (!sheet || !sourcePart || sourceView.kind !== "standard") return;

  try {
    const source = await readSourcePart(sourcePart, `Pick ${sourcePart.fileName} again to create the projected view`);
    if (!source || !isCurrent()) return;

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

    if (!isCurrent()) return;
    useDocumentStore.getState().addDrawingView(newView);
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
  const isCurrent = captureDrawingCommand();
  const { document: activeDocument } = useDocumentStore.getState();
  const sheet = activeDocument.drawing;
  const sourcePart = sheet?.sourcePart;
  if (!sheet || !sourcePart) {
    showToast("Insert a Model View first");
    return;
  }

  try {
    const source = await readSourcePart(sourcePart, `Pick ${sourcePart.fileName} again to build the hole table`);
    if (!source || !isCurrent()) return;

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
  const isCurrent = captureDrawingCommand();
  const { document: activeDocument } = useDocumentStore.getState();
  const sheet = activeDocument.drawing;
  const sourcePart = sheet?.sourcePart;
  if (!sheet || !sourcePart) {
    showToast("Insert a Model View first");
    return;
  }

  try {
    const source = await readSourcePart(sourcePart, `Pick ${sourcePart.fileName} again to build the BOM`);
    if (!source || !isCurrent()) return;

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
