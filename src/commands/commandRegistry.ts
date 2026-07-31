import type { Feature, FeatureKind } from "@/types/document";
import type { GeometricConstraintKind } from "@/sketch/types";
import { DEFAULT_PLANE_IDS, useDocumentStore } from "@/state/documentStore";
import { useSketchStore, type SketchTool } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";

import { runNewDocument, runOpenDocument, runSaveDocument } from "./documentIO";
import { runExport, runImport } from "./interchange";

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
  "feature.rib": "rib",
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
  const featureId = documentState.addFeature("sketch");
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
 */
function addHoleFeature() {
  const sketchId = resolveTargetSketchId();
  useDocumentStore.getState().addFeature("hole", undefined, sketchId ? [sketchId] : []);
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
 * A one-shot `window.prompt` for the offset matches `sketch.offset`/`sketch.pattern` below —
 * the smallest UI a single-number tool needs without a dedicated dialog. The base plane is
 * stored in `Feature.parents` rather than a new parameter, reusing the field that already
 * means "features this one consumes". Offsetting from another *user-created* reference plane
 * is not supported yet — that needs the same base-plane picking UI this stands in for.
 */
function addReferencePlane() {
  const documentState = useDocumentStore.getState();
  const basePlaneId =
    documentState.selectedFeatureIds.find((id) => (DEFAULT_PLANE_IDS as readonly string[]).includes(id)) ??
    DEFAULT_PLANE_IDS[0];

  const input = window.prompt("Offset distance from the selected plane (mm) — negative flips the side:", "10");
  if (input === null) return;
  const distance = Number(input);
  if (!Number.isFinite(distance)) return;
  documentState.addFeature("reference-plane", { distance }, [basePlaneId]);
}

/** Creates a reference axis aligned to a world axis — the same stand-in `FeatureParameters.axis` already documents for patterns, until edge/face picking exists. */
function addReferenceAxis() {
  const input = window.prompt('World axis to align to — "x", "y" or "z":', "z");
  if (input === null) return;
  const axis = input.trim().toLowerCase();
  if (axis !== "x" && axis !== "y" && axis !== "z") return;
  useDocumentStore.getState().addFeature("reference-axis", { axis });
}

/** Creates a reference point offset from the origin along a world axis. */
function addReferencePoint() {
  const axisInput = window.prompt('Axis to offset along from the origin — "x", "y" or "z":', "z");
  if (axisInput === null) return;
  const axis = axisInput.trim().toLowerCase();
  if (axis !== "x" && axis !== "y" && axis !== "z") return;
  const distanceInput = window.prompt("Distance from the origin (mm):", "10");
  if (distanceInput === null) return;
  const distance = Number(distanceInput);
  if (!Number.isFinite(distance)) return;
  useDocumentStore.getState().addFeature("reference-point", { distance, axis });
}

/** Commands handled directly rather than by creating a feature. */
const DIRECT_COMMANDS: Record<string, () => void> = {
  "feature.extrude": () => addSketchFeature("extrude"),
  "feature.cut-extrude": () => addSketchFeature("cut-extrude"),
  "feature.revolve": () => addSketchFeature("revolve"),
  "feature.cut-revolve": () => addSketchFeature("cut-revolve"),
  "feature.hole-wizard": addHoleFeature,
  "feature.loft": addLoftFeature,

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

  "doc.new": runNewDocument,
  "doc.open": () => void runOpenDocument(),
  "doc.save": () => void runSaveDocument(),

  "edit.undo": () => useDocumentStore.getState().undo(),
  "edit.redo": () => useDocumentStore.getState().redo(),
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

  "dimension.smart": () => useSketchStore.getState().applySmartDimension(),
  "dimension.ordinate": () => useSketchStore.getState().applyOrdinateDimension("both"),
  "dimension.horizontal-ordinate": () => useSketchStore.getState().applyOrdinateDimension("x"),
  "dimension.vertical-ordinate": () => useSketchStore.getState().applyOrdinateDimension("y"),

  "sketch.mirror": () => useSketchStore.getState().mirrorSelection(),
  "sketch.offset": () => {
    // No inline numeric-entry UI exists for a one-shot tool like this yet (unlike a
    // dimension, which is added and then edited afterward) — a prompt is the smallest
    // way to ask for the one number this needs. Negative flips which side a line offsets
    // to and shrinks rather than grows a circle or arc; both are explained right there.
    const input = window.prompt("Offset distance (mm) — negative flips the side/shrinks:", "5");
    if (input === null) return;
    const distance = Number(input);
    if (!Number.isFinite(distance) || distance === 0) return;
    useSketchStore.getState().offsetSelection(distance);
  },
  "sketch.pattern": () => {
    // Same reasoning as sketch.offset: a chain of prompts is the smallest UI a one-shot
    // array tool needs. A circular pattern has no picked centre yet — no reference-point
    // picking UI exists — so it always rotates about the sketch origin, the same stand-in
    // FeatureParameters.axis documents for the feature-level pattern.
    const kindInput = window.prompt('Pattern type — type "linear" or "circular":', "linear");
    if (kindInput === null) return;
    const mode = kindInput.trim().toLowerCase();
    if (mode !== "linear" && mode !== "circular") return;

    const countInput = window.prompt("Instance count (including the original):", "3");
    if (countInput === null) return;
    const count = Number(countInput);
    if (!Number.isFinite(count) || count < 2) return;

    if (mode === "linear") {
      const dxInput = window.prompt("X spacing per instance (mm):", "10");
      if (dxInput === null) return;
      const dyInput = window.prompt("Y spacing per instance (mm):", "0");
      if (dyInput === null) return;
      const dx = Number(dxInput);
      const dy = Number(dyInput);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      useSketchStore.getState().patternSelection({ mode: "linear", count, dx, dy });
      return;
    }

    const angleInput = window.prompt("Total sweep angle (degrees):", "360");
    if (angleInput === null) return;
    const angleDegrees = Number(angleInput);
    if (!Number.isFinite(angleDegrees)) return;
    useSketchStore.getState().patternSelection({ mode: "circular", count, angleDegrees });
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
  // Modelling and reference-geometry features cannot be created from inside a sketch.
  if (commandId.startsWith("feature.") || commandId.startsWith("reference.") || commandId === "sketch.new") {
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
