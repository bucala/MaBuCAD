import type { FeatureKind } from "@/types/document";
import { useDocumentStore } from "@/state/documentStore";

/**
 * Ribbon command ids that create a feature, mapped to the kind they create.
 *
 * This is the seam between the declarative ribbon in `ribbonConfig.ts` and the document
 * store: adding a command to the ribbon does not require touching the store, and wiring
 * a command up is a one-line entry here.
 */
const FEATURE_COMMANDS: Record<string, FeatureKind> = {
  "sketch.new": "sketch",

  "feature.extrude": "extrude",
  "feature.revolve": "revolve",
  "feature.sweep": "sweep",
  "feature.loft": "loft",

  "feature.cut-extrude": "cut-extrude",
  "feature.cut-revolve": "cut-revolve",
  "feature.cut-sweep": "cut-sweep",
  "feature.hole-wizard": "hole",

  "feature.fillet": "fillet",
  "feature.chamfer": "chamfer",
  "feature.shell": "shell",
  "feature.draft": "draft",
  "feature.rib": "rib",

  "feature.linear-pattern": "linear-pattern",
  "feature.circular-pattern": "circular-pattern",
  "feature.mirror": "mirror",

  "reference.plane": "reference-plane",
  "reference.axis": "reference-axis",
  "reference.point": "reference-point",
};

/** Commands handled directly rather than by creating a feature. */
const DIRECT_COMMANDS: Record<string, () => void> = {
  "edit.undo": () => useDocumentStore.getState().undo(),
  "edit.redo": () => useDocumentStore.getState().redo(),
  "edit.delete": () => {
    const { selectedFeatureIds, deleteFeature } = useDocumentStore.getState();
    selectedFeatureIds.forEach(deleteFeature);
  },
};

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
