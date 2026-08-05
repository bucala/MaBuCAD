import type { Vector3 } from "three";

import type { Feature, FeatureKind } from "@/types/document";
import type { GeometricConstraintKind } from "@/sketch/types";
import { planeBasis, worldToSketch } from "@/sketch/planeBasis";
import { DEFAULT_PLANE_IDS, useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";
import { useInspectStore } from "@/state/inspectStore";
import { useDrawingToolStore } from "@/state/drawingToolStore";
import { useSketchStore, type SketchTool } from "@/state/sketchStore";
import { useTemplateStore } from "@/state/templateStore";
import { useViewportStore } from "@/state/viewportStore";

import { runOpenDocument, runSaveDocument, runSaveDocumentAs } from "./documentIO";
import { runInsertBomTable, runInsertHoleTable, runInsertModelView, runUpdateViews } from "./drawingCommands";
import { runExport, runImport } from "./interchange";

/** How close to parallel (dot product of unit normals) a clicked face's normal needs to
 * be to one of the three default planes' own normal to count as "on that plane" — allows
 * for float error, not for a genuinely angled face. */
const FACE_PLANE_ALIGNMENT_TOLERANCE = 0.98;

/**
 * Ribbon command ids that create a feature, mapped to the kind they create.
 *
 * This is the seam between the declarative ribbon in `ribbonConfig.ts` and the document
 * store: adding a command to the ribbon does not require touching the store, and wiring
 * a command up is a one-line entry here.
 */
const FEATURE_COMMANDS: Record<string, FeatureKind> = {
  "feature.fillet": "fillet",
  "feature.chamfer": "chamfer",
  "feature.shell": "shell",
  "feature.draft": "draft",
};

/** Sketch tools, active only while a sketch is open. */
const SKETCH_TOOL_COMMANDS: Record<string, SketchTool> = {
  "sketch.select": "select",
  "sketch.line": "line",
  "sketch.rectangle": "rectangle",
  "sketch.circle": "circle",
  "sketch.spline": "spline",
  "sketch.construction": "construction-line",
  "sketch.point": "point",
  "sketch.arc": "arc",
  "sketch.trim": "trim",
};

const SKETCH_RELATION_COMMANDS: Record<string, GeometricConstraintKind> = {
  "relation.horizontal": "horizontal",
  "relation.vertical": "vertical",
  "relation.parallel": "parallel",
  "relation.perpendicular": "perpendicular",
  "relation.tangent": "tangent",
  "relation.coincident": "coincident",
  "relation.concentric": "concentric",
  "relation.equal": "equal",
  "relation.fix": "fix",
};

/**
 * Opens a sketch: resumes editing the selected one if there is one, otherwise starts a new
 * sketch on the selected plane.
 *
 * Matches SolidWorks: clicking Sketch with an existing sketch selected re-enters it rather
 * than creating a second, unrelated empty sketch. A new sketch needs a plane, so that path
 * uses the current selection and falls back to the Front plane — the same default a new
 * SolidWorks part offers.
 */
function beginSketch() {
  const documentState = useDocumentStore.getState();
  const sketchStore = useSketchStore.getState();

  const selectedSketchId = documentState.selectedFeatureIds.find(
    (id) =>
      documentState.document.features.some(
        (feature) => feature.id === id && feature.kind === "sketch",
      ) && sketchStore.sketches[id],
  );

  if (selectedSketchId) {
    sketchStore.resumeSketch(selectedSketchId);
    return;
  }

  const selectedPlane = documentState.selectedFeatureIds.find((id) =>
    (DEFAULT_PLANE_IDS as readonly string[]).includes(id),
  );

  const planeId = selectedPlane ?? DEFAULT_PLANE_IDS[0];
  const featureId = documentState.addFeature("sketch", undefined, [planeId]);
  sketchStore.beginSketch(featureId, planeId);
}

/**
 * Creates an extrude or revolve feature from a sketch.
 *
 * Both consume a profile, so the command resolves one from the selection and falls back to
 * the most recent sketch above the rollback bar — the sketch you just finished is almost
 * always the one you mean.
 */
function resolveTargetSketchId(): string | undefined {
  const documentState = useDocumentStore.getState();
  const { sketches } = useSketchStore.getState();
  const { features, rollbackIndex } = documentState.document;

  const selectedSketch = documentState.selectedFeatureIds.find(
    (id) => features.some((feature) => feature.id === id && feature.kind === "sketch") && sketches[id],
  );

  const lastSketch = [...features.slice(0, rollbackIndex)]
    .reverse()
    .find((feature) => feature.kind === "sketch" && sketches[feature.id])?.id;

  return selectedSketch ?? lastSketch;
}

function addSketchFeature(kind: "extrude" | "cut-extrude" | "revolve" | "cut-revolve") {
  const sketchId = resolveTargetSketchId();
  useDocumentStore.getState().addFeature(kind, undefined, sketchId ? [sketchId] : []);
}

/**
 * Creates a Hole Wizard feature from the target sketch's points, one hole per point — the
 * same sketch-resolution `addSketchFeature` uses. The dialog Inventor pops up before
 * placement (Hole Type, Standard, Size, Fit...) is the `PropertyManager.tsx` "Hole Wizard"
 * section instead, opened by selecting the new feature after creation — consistent with
 * every other feature in this app, which is created with defaults and then tuned in the
 * property panel rather than through an upfront wizard dialog.
 *
 * If no selected/most-recent sketch actually has a point in it yet, there is nothing for
 * `buildHoleSolid` (`kernel/rebuild.ts`) to cut a hole at — creating the feature anyway
 * used to just hand the user a broken "Place at least one point..." error. Instead this
 * arms `holePlacementActive`, and `SolidModel.tsx`'s click handler (`placeHoleAtPick`
 * below) creates the backing sketch and the hole feature together once the user actually
 * clicks a face.
 */
function addHoleFeature() {
  const sketchId = resolveTargetSketchId();
  const sketch = sketchId ? useSketchStore.getState().sketches[sketchId] : undefined;
  const hasPoint = sketch?.entities.some((entity) => entity.kind === "point") ?? false;

  if (sketchId && hasPoint) {
    useDocumentStore.getState().addFeature("hole", undefined, [sketchId]);
    return;
  }

  useViewportStore.getState().setHolePlacementActive(true);
  useGeometryStore
    .getState()
    .showToast("Hole Wizard: click a face parallel to Front, Top or Right to place a hole", 5000);
}

/**
 * Turns a raycaster hit on the solid (a world point plus the clicked triangle's face
 * normal, both from `SolidModel.tsx`'s own click handler) into a Hole Wizard feature —
 * the part of item 1 ("Select" placement) that does not need real per-face identity from
 * the kernel: a point and a normal are all `buildHoleSolid` needs, the same as the
 * Fillet/Chamfer edge-pick flow only ever needed raw 3D points, never a real edge id.
 *
 * The face has to be (anti-)parallel to one of the three default planes, because
 * `kernel/rebuild.ts` only knows how to orient a hole feature's cylinders by
 * `sketch.planeId`, and `planeBasis()` only has a rotation for those three ids — there is
 * no notion yet of a plane offset along its own normal (see `planeBasis.ts`). That is not
 * the limitation it sounds like for the common case: `buildHoleSolid`'s default end
 * condition is "through-all", which is already a deliberately oversized cut centred on
 * the sketch plane in *both* directions (`extrusionRange`), so it reaches a face offset
 * from the origin along that same normal regardless. An angled/non-axis-aligned face
 * (e.g. a chamfer or a revolved surface) is correctly rejected rather than silently
 * producing a hole in the wrong place.
 *
 * Returns whether a hole was placed, so the caller knows whether to stay in placement
 * mode (misaligned face — let the user try a different one) or leave it (success).
 */
export function placeHoleAtPick(worldPoint: Vector3, worldNormal: Vector3): boolean {
  const planeId = DEFAULT_PLANE_IDS.find(
    (id) => Math.abs(planeBasis(id).normal.dot(worldNormal)) > FACE_PLANE_ALIGNMENT_TOLERANCE,
  );

  if (!planeId) {
    useGeometryStore
      .getState()
      .showToast("That face isn't parallel to Front, Top or Right — pick another one", 4000);
    return false;
  }

  const { x, y } = worldToSketch(planeId, worldPoint);

  const documentState = useDocumentStore.getState();
  const sketchStore = useSketchStore.getState();
  const sketchFeatureId = documentState.addFeature("sketch", undefined, [planeId]);
  sketchStore.beginSketch(sketchFeatureId, planeId);
  sketchStore.drawPoint({ x, y });
  sketchStore.exitSketch();

  documentState.addFeature("hole", undefined, [sketchFeatureId]);
  useViewportStore.getState().setHolePlacementActive(false);
  return true;
}

/** Creates a Rib feature from the target sketch's first non-construction line — the same
 * sketch-resolution `addSketchFeature`/`addHoleFeature` use. */
function addRibFeature() {
  const sketchId = resolveTargetSketchId();
  useDocumentStore.getState().addFeature("rib", undefined, sketchId ? [sketchId] : []);
}

/**
 * Creates a Loft feature between two or more sketches — unlike every other sketch-consuming
 * feature here, a loft genuinely needs more than one, so this resolves a *list* rather than
 * `resolveTargetSketchId`'s single id: the currently multi-selected sketches (Ctrl/Cmd-click
 * several rows in the tree, the same gesture `edit.delete` already treats as "act on all of
 * these"), or — with fewer than two selected — the two most recent sketches above the
 * rollback bar, oldest first. `kernel/rebuild.ts` additionally requires every sketch in the
 * list to share one plane; see its own note on why.
 */
function addLoftFeature() {
  const documentState = useDocumentStore.getState();
  const { sketches } = useSketchStore.getState();
  const { features, rollbackIndex } = documentState.document;
  const isUsableSketch = (id: string) =>
    features.some((feature) => feature.id === id && feature.kind === "sketch") && sketches[id];

  const selected = documentState.selectedFeatureIds.filter(isUsableSketch);
  const sketchIds =
    selected.length >= 2
      ? selected
      : features
          .slice(0, rollbackIndex)
          .filter((feature) => isUsableSketch(feature.id))
          .map((feature) => feature.id)
          .slice(-2);

  documentState.addFeature("loft", undefined, sketchIds);
}

/**
 * Creates a Sweep or Cut-Sweep feature from two sketches: a profile (the cross-section) and
 * a path (a construction line marking the sweep direction) — resolved the same way
 * `addLoftFeature` resolves its list, except order matters here (`parents[0]` is always the
 * profile, `parents[1]` the path), so this keeps selection order rather than sorting it.
 */
function addSweepFeature(kind: "sweep" | "cut-sweep") {
  const documentState = useDocumentStore.getState();
  const { sketches } = useSketchStore.getState();
  const { features, rollbackIndex } = documentState.document;
  const isUsableSketch = (id: string) =>
    features.some((feature) => feature.id === id && feature.kind === "sketch") && sketches[id];

  const selected = documentState.selectedFeatureIds.filter(isUsableSketch);
  const sketchIds =
    selected.length >= 2
      ? selected
      : features
          .slice(0, rollbackIndex)
          .filter((feature) => isUsableSketch(feature.id))
          .map((feature) => feature.id)
          .slice(-2);

  documentState.addFeature(kind, undefined, sketchIds);
}

/** Feature kinds the kernel builds real geometry for — what a pattern or mirror can target. */
const MODELLING_KINDS: ReadonlySet<Feature["kind"]> = new Set([
  "extrude",
  "cut-extrude",
  "revolve",
  "cut-revolve",
  "hole",
  "imported",
]);

/**
 * Creates a linear pattern, circular pattern, or mirror feature from an existing modelling
 * feature, resolved the same way `addSketchFeature` resolves a sketch: prefer the current
 * selection, otherwise fall back to the most recent modelling feature above the rollback bar.
 */
function addPatternFeature(kind: "linear-pattern" | "circular-pattern" | "mirror") {
  const documentState = useDocumentStore.getState();
  const { features, rollbackIndex } = documentState.document;

  const selectedSource = documentState.selectedFeatureIds.find((id) =>
    features.some((feature) => feature.id === id && MODELLING_KINDS.has(feature.kind)),
  );

  const lastModelling = [...features.slice(0, rollbackIndex)]
    .reverse()
    .find((feature) => MODELLING_KINDS.has(feature.kind))?.id;

  const sourceId = selectedSource ?? lastModelling;
  documentState.addFeature(kind, undefined, sourceId ? [sourceId] : []);
}

/**
 * Creates a reference plane, offset from a selected default plane (or the Front plane, if
 * none is selected) along that plane's normal.
 *
 * Lands with `FEATURE_CATALOG`'s own default distance (10mm) rather than prompting for
 * one — exactly the same "create now, dial in the value afterward" flow every other
 * feature (Extrude, Fillet, a pattern's count/spacing, ...) already uses: `addFeature`
 * auto-selects the new feature, and `PropertyManager.tsx`'s generic field list already
 * renders an editable "Distance" input for any feature whose parameters include one —
 * no feature-specific UI needed here at all. The base plane is stored in `Feature.parents`
 * rather than a new parameter, reusing the field that already means "features this one
 * consumes". Offsetting from another *user-created* reference plane is not supported yet
 * — that needs a base-plane picking UI, a separate gap from the one this used to stand in
 * for with `window.prompt()`.
 */
function addReferencePlane() {
  const documentState = useDocumentStore.getState();
  const basePlaneId =
    documentState.selectedFeatureIds.find((id) => (DEFAULT_PLANE_IDS as readonly string[]).includes(id)) ??
    DEFAULT_PLANE_IDS[0];

  documentState.addFeature("reference-plane", undefined, [basePlaneId]);
}

/** Creates a reference axis aligned to a world axis (`FEATURE_CATALOG`'s default, "z") —
 * `PropertyManager.tsx`'s generic axis `<select>` (any feature whose parameters include
 * `axis`) is what actually lets it be pointed anywhere else afterward. */
function addReferenceAxis() {
  useDocumentStore.getState().addFeature("reference-axis");
}

/** Creates a reference point offset from the origin along a world axis — same "create with
 * `FEATURE_CATALOG` defaults, edit via the generic property fields" flow as
 * `addReferenceAxis`/`addReferencePlane` above. */
function addReferencePoint() {
  useDocumentStore.getState().addFeature("reference-point");
}

/** Commands handled directly rather than by creating a feature. */
const DIRECT_COMMANDS: Record<string, () => void> = {
  "feature.extrude": () => addSketchFeature("extrude"),
  "feature.cut-extrude": () => addSketchFeature("cut-extrude"),
  "feature.revolve": () => addSketchFeature("revolve"),
  "feature.cut-revolve": () => addSketchFeature("cut-revolve"),
  "feature.hole-wizard": addHoleFeature,
  "feature.rib": addRibFeature,
  "feature.loft": addLoftFeature,
  "feature.sweep": () => addSweepFeature("sweep"),
  "feature.cut-sweep": () => addSweepFeature("cut-sweep"),

  "feature.linear-pattern": () => addPatternFeature("linear-pattern"),
  "feature.circular-pattern": () => addPatternFeature("circular-pattern"),
  "feature.mirror": () => addPatternFeature("mirror"),

  "reference.plane": addReferencePlane,
  "reference.axis": addReferenceAxis,
  "reference.point": addReferencePoint,
  "reference.csys": () => useDocumentStore.getState().addFeature("reference-csys"),

  // `file.export-iges` is deliberately absent: the bundled OpenCASCADE build contains no
  // IGES support, so the ribbon button stays disabled and says why in its tooltip rather
  // than failing at the point of use.
  "file.import": () => void runImport(),
  "file.export-step": () => void runExport("step"),
  "file.export-stl": () => void runExport("stl-binary"),

  "doc.new": () => useDocumentStore.getState().openNewDocumentDialog(),
  "doc.open": () => void runOpenDocument(),
  "doc.save": () => void runSaveDocument(),
  "doc.save-as": () => void runSaveDocumentAs(),

  "drawing.model-view": () => void runInsertModelView(),
  "drawing.update-views": () => void runUpdateViews(),
  "drawing.sheet-format": () => useTemplateStore.getState().openManager(),
  "drawing.edit-background": () => useTemplateStore.getState().openManager("borders"),
  "drawing.section": () => useDrawingToolStore.getState().setTool("section"),
  "drawing.detail": () => useDrawingToolStore.getState().setTool("detail"),
  "drawing.projected": () => useDrawingToolStore.getState().setTool("projected"),
  "annotation.note": () => useDrawingToolStore.getState().setTool("note"),
  "annotation.smart-dimension": () => useDrawingToolStore.getState().setTool("smart-dimension"),
  "annotation.ordinate": () => useDrawingToolStore.getState().setTool("ordinate"),
  "annotation.datum": () => useDrawingToolStore.getState().setTool("datum"),
  "annotation.gdt": () => useDrawingToolStore.getState().setTool("gdt"),
  "annotation.surface-finish": () => useDrawingToolStore.getState().setTool("surface-finish"),
  "table.bom": () => void runInsertBomTable(),
  "table.hole": () => void runInsertHoleTable(),
  // There's no "drawing sheet" to print yet (Assembly and Drawing document types are
  // still "Coming soon" in NewDocumentDialog.tsx) — this prints the 3D view as currently
  // shown. `PrintCapture.tsx` (inside the Canvas) does the actual capture once it sees
  // this request; `PrintOverlay.tsx` renders it and opens the browser's print dialog.
  "doc.print": () => useViewportStore.getState().requestPrint(),

  // A sketch's own edits (drawing, dimensioning, dragging) never reach `documentStore` —
  // its history is a separate stack scoped to the current sketch session (see
  // `sketchStore.ts`'s `past`/`future`) — so Undo/Redo while a sketch is open must target
  // that stack instead, the same "sketch mode redirects the command" pattern `edit.delete`
  // already uses below.
  "edit.undo": () => {
    const sketchState = useSketchStore.getState();
    if (sketchState.activeSketchId) {
      sketchState.undo();
      return;
    }
    useDocumentStore.getState().undo();
  },
  "edit.redo": () => {
    const sketchState = useSketchStore.getState();
    if (sketchState.activeSketchId) {
      sketchState.redo();
      return;
    }
    useDocumentStore.getState().redo();
  },
  "edit.delete": () => {
    const sketchState = useSketchStore.getState();
    if (sketchState.activeSketchId) {
      sketchState.deleteSelection();
      return;
    }
    const { selectedFeatureIds, deleteFeature } = useDocumentStore.getState();
    selectedFeatureIds.forEach(deleteFeature);
  },

  "sketch.new": beginSketch,
  "sketch.exit": () => useSketchStore.getState().exitSketch(),

  // Arms the tool rather than dimensioning the current selection once: Smart Dimension
  // stays active across clicks (see SketchGeometry.tsx/SketchDimensions.tsx's own
  // handling of the "smart-dimension" tool), the same "stays armed until you pick
  // something else" convention every drawing tool already follows.
  "dimension.smart": () => useSketchStore.getState().setTool("smart-dimension"),
  "dimension.ordinate": () => useSketchStore.getState().applyOrdinateDimension("both"),
  "dimension.horizontal-ordinate": () => useSketchStore.getState().applyOrdinateDimension("x"),
  "dimension.vertical-ordinate": () => useSketchStore.getState().applyOrdinateDimension("y"),

  "sketch.mirror": () => {
    if (!useSketchStore.getState().mirrorSelection()) {
      useGeometryStore
        .getState()
        .showToast("Select the entities to mirror plus one construction line to use as the axis.", 3500);
    }
  },
  // Offset and Pattern both need more than one number, which a ribbon click alone can't
  // gather — the Sketch panel's own "Modify" section is the real UI for both (numeric
  // fields plus an Apply button, no browser-native prompt() dialogs breaking the app's own
  // look). This entry exists so the ribbon button does something other than nothing; it
  // just points at where the actual controls live rather than duplicating them here.
  "sketch.offset": () => {
    useGeometryStore
      .getState()
      .showToast("Set the offset distance in the Modify section of the Sketch panel, then click Apply.", 3500);
  },
  "sketch.pattern": () => {
    useGeometryStore
      .getState()
      .showToast("Set the pattern options in the Modify section of the Sketch panel, then click Apply Pattern.", 3500);
  },

  "view.zoom-fit": () => useViewportStore.getState().requestZoomFit(),
  "view.display-mode": () => useViewportStore.getState().cycleDisplayMode(),
  // Toggles visibility for whatever is selected — a plane, the origin, or (since the
  // kernel fuses every modelling feature into one mesh) any feature that contributed to
  // the solid, which hides the whole body. See hiddenFeatureIds's own doc comment.
  "view.hide-show": () => {
    const { selectedFeatureIds } = useDocumentStore.getState();
    const { toggleFeatureVisibility } = useViewportStore.getState();
    selectedFeatureIds.forEach(toggleFeatureVisibility);
  },
  "view.constraints": () => useViewportStore.getState().toggleConstraintsVisible(),

  // Every Inspect command opens its own tool in the property panel the same way — and
  // first cancels any other modal viewport interaction (Hole Wizard placement, a Fillet/
  // Chamfer's own edge picking) before arming itself, the same defensive reset every other
  // mode-switching command in this file already applies to itself.
  ...Object.fromEntries(
    (
      [
        "measure",
        "mass",
        "section",
        "geometry",
        "draft-analysis",
        "parent-child",
        "equations",
        "sensors",
        "appearance",
      ] as const
    ).map((tool) => [
      `inspect.${tool}`,
      () => {
        useViewportStore.getState().setHolePlacementActive(false);
        useViewportStore.getState().setEdgePickMode(null);
        useInspectStore.getState().openTool(tool);
      },
    ]),
  ),

  ...Object.fromEntries(
    Object.entries(SKETCH_TOOL_COMMANDS).map(([id, tool]) => [
      id,
      () => useSketchStore.getState().setTool(tool),
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(SKETCH_RELATION_COMMANDS).map(([id, kind]) => [
      id,
      () => useSketchStore.getState().applyConstraint(kind),
    ]),
  ),
};

/** Commands that only make sense while a sketch is open. */
const SKETCH_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  "sketch.exit",
  ...Object.keys(SKETCH_TOOL_COMMANDS),
  ...Object.keys(SKETCH_RELATION_COMMANDS),
  "sketch.mirror",
  "sketch.offset",
  "sketch.pattern",
  "dimension.smart",
  "dimension.ordinate",
  "dimension.horizontal-ordinate",
  "dimension.vertical-ordinate",
]);

/** Whether a command can be invoked right now, given sketch mode. */
export function isCommandAvailable(commandId: string, inSketchMode: boolean): boolean {
  if (!IMPLEMENTED_COMMANDS.has(commandId)) return false;
  if (SKETCH_ONLY_COMMANDS.has(commandId)) return inSketchMode;
  // Modelling, reference-geometry and Inspect commands all act on the 3D body, which a
  // sketch's own tools and property panel replace while it's open.
  if (
    commandId.startsWith("feature.") ||
    commandId.startsWith("reference.") ||
    commandId.startsWith("inspect.") ||
    commandId === "sketch.new"
  ) {
    return !inSketchMode;
  }
  return true;
}

/** Every command id that currently does something, for greying out the rest. */
export const IMPLEMENTED_COMMANDS: ReadonlySet<string> = new Set([
  ...Object.keys(FEATURE_COMMANDS),
  ...Object.keys(DIRECT_COMMANDS),
]);

/**
 * Runs a ribbon command. Returns false when the command has no implementation yet, so
 * the caller can report it rather than failing silently.
 *
 * Features created here carry only their default parameters. Step 5 opens the property
 * manager first and builds real geometry from what the user enters.
 */
export function runCommand(commandId: string): boolean {
  const direct = DIRECT_COMMANDS[commandId];
  if (direct) {
    direct();
    return true;
  }

  const kind = FEATURE_COMMANDS[commandId];
  if (kind) {
    useDocumentStore.getState().addFeature(kind);
    return true;
  }

  return false;
}
