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
  "feature.sweep": "sweep",
  "feature.loft": "loft",

  "feature.cut-sweep": "cut-sweep",
  "feature.hole-wizard": "hole",

  "feature.fillet": "fillet",
  "feature.chamfer": "chamfer",
  "feature.shell": "shell",
  "feature.draft": "draft",
  "feature.rib": "rib",

  "reference.plane": "reference-plane",
  "reference.axis": "reference-axis",
  "reference.point": "reference-point",
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
function addSketchFeature(kind: "extrude" | "cut-extrude" | "revolve" | "cut-revolve") {
  const documentState = useDocumentStore.getState();
  const { sketches } = useSketchStore.getState();
  const { features, rollbackIndex } = documentState.document;

  const selectedSketch = documentState.selectedFeatureIds.find(
    (id) => features.some((feature) => feature.id === id && feature.kind === "sketch") && sketches[id],
  );

  const lastSketch = [...features.slice(0, rollbackIndex)]
    .reverse()
    .find((feature) => feature.kind === "sketch" && sketches[feature.id])?.id;

  const sketchId = selectedSketch ?? lastSketch;
  documentState.addFeature(kind, undefined, sketchId ? [sketchId] : []);
}

/** Feature kinds the kernel builds real geometry for — what a pattern or mirror can target. */
const MODELLING_KINDS: ReadonlySet<Feature["kind"]> = new Set([
  "extrude",
  "cut-extrude",
  "revolve",
  "cut-revolve",
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

/** Commands handled directly rather than by creating a feature. */
const DIRECT_COMMANDS: Record<string, () => void> = {
  "feature.extrude": () => addSketchFeature("extrude"),
  "feature.cut-extrude": () => addSketchFeature("cut-extrude"),
  "feature.revolve": () => addSketchFeature("revolve"),
  "feature.cut-revolve": () => addSketchFeature("cut-revolve"),

  "feature.linear-pattern": () => addPatternFeature("linear-pattern"),
  "feature.circular-pattern": () => addPatternFeature("circular-pattern"),
  "feature.mirror": () => addPatternFeature("mirror"),

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
  "view.hide-show": () => useViewportStore.getState().toggleReferenceGeometry(),

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
  // Modelling features cannot be created from inside a sketch.
  if (commandId.startsWith("feature.") || commandId === "sketch.new") return !inSketchMode;
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
