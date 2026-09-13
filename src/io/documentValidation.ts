import { FEATURE_CATALOG } from "@/state/featureCatalog";
import type { Sketch } from "@/sketch/types";
import type { CadDocument } from "@/types/document";
import type { UnitSystemId } from "@/types/ui";

/**
 * On-disk `.mabucad` document format: one `formatVersion` envelope around the document,
 * its sketches and the unit system they were drawn in. Shared by `workspaceStore.ts`
 * (File ▸ Open / Save) and `commands/documentIO.ts` (the autosave snapshot), which used
 * to carry two identical private copies of the same interface.
 */
export interface SavedDocument {
  formatVersion: number;
  document: CadDocument;
  sketches: Record<string, Sketch>;
  unitSystem: UnitSystemId;
}

/**
 * The on-disk version this build writes. Reading a file is more forgiving: any version
 * back to `MIN_SUPPORTED_FORMAT_VERSION` is accepted and upgraded through `MIGRATIONS` to
 * this one, so an old file opens in a newer app instead of being rejected the moment the
 * envelope grows a field. A version *ahead* of this one is still refused — that file was
 * written by an app with changes this build cannot know about.
 */
export const DOCUMENT_FORMAT_VERSION = 2;
/** Oldest version this build can still read and migrate forward from. */
export const MIN_SUPPORTED_FORMAT_VERSION = 1;

/**
 * One migration step, keyed by the version it starts *from*: given a file saved at that
 * version (structurally intact enough that its own fields are trustworthy, since it passed
 * a prior app's save), produce the equivalent file one version newer. A step must only add
 * fields the newer format makes mandatory, filling the exact default the older writer left
 * out — it must never discard or reinterpret data, since nothing in the file tells us
 * which app wrote it.
 */
const MIGRATIONS: Record<number, (draft: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: the unit system the document was drawn in becomes a required envelope field.
  // v1 predates the field (files simply carry no `unitSystem`), and every consumer already
  // read it with a `?? "MMGS"` default — the de-facto value for all pre-unit files — so
  // the migration just makes that default explicit. This is the change that gave the
  // format something real to migrate; the framework is what future fields will ride on.
  1: (draft) => ({ ...draft, unitSystem: draft.unitSystem ?? "MMGS" }),
};

export type SavedDocumentMigration =
  | { ok: true; saved: SavedDocument; fromVersion: number }
  | { ok: false; error: string };

/**
 * Brings any supported on-disk file up to `DOCUMENT_FORMAT_VERSION`, or says why it can't.
 *
 * `fromVersion` lets a caller tell a migrated file from a fresh one (both save with the
 * current version after this). Validation of the *document content* is left to
 * `validateSavedDocument` — this only establishes that the envelope is a version this build
 * understands and rewrites it to the current one.
 */
export function migrateSavedDocument(value: unknown): SavedDocumentMigration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "the file is not a MaBuCAD document" };
  }

  const envelope = value as Record<string, unknown>;
  const version = envelope.formatVersion;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < MIN_SUPPORTED_FORMAT_VERSION ||
    version > DOCUMENT_FORMAT_VERSION
  ) {
    return { ok: false, error: `unsupported format version (${String(version)})` };
  }

  let migrated = envelope;
  for (let from = version; from < DOCUMENT_FORMAT_VERSION; from += 1) {
    const step = MIGRATIONS[from];
    if (!step) return { ok: false, error: `unsupported format version (${String(version)})` };
    migrated = step(migrated);
    // The framework owns the version field: a step adds/fills content, but the envelope
    // only claims the version it has actually been migrated *to* after the step — so a
    // stepped file reads as a current-version document to everything downstream.
    migrated.formatVersion = from + 1;
  }

  return { ok: true, saved: migrated as unknown as SavedDocument, fromVersion: version };
}

const DOCUMENT_KINDS: ReadonlySet<string> = new Set(["part", "assembly", "drawing"]);
const UNIT_SYSTEMS: ReadonlySet<string> = new Set(["MMGS", "CGS", "MKS", "IPS"]);

/**
 * Structural validation of an untrusted parsed `.mabucad` payload — a document a user
 * picked from disk (or an autosave snapshot a previous run left behind) is exactly as
 * untrusted as any other file, and the previous "document" in value check let arbitrary
 * JSON straight into the stores and the kernel, where a wrong shape was a crash at best.
 *
 * Runs any older-format migration first (see `migrateSavedDocument`), then checks the
 * migrated, current-version envelope: every feature kind must be one the app knows, every
 * numeric field must be finite, and every id an entity/constraint references must exist in
 * the sketch's own point pool. It runs once per Open, so the extra passes over arrays
 * nobody will notice.
 */
export type SavedDocumentValidation =
  | { ok: true; saved: SavedDocument }
  | { ok: false; error: string };

export function validateSavedDocument(value: unknown): SavedDocumentValidation {
  const migration = migrateSavedDocument(value);
  if (!migration.ok) return migration;

  const envelope = migration.saved as unknown as Record<string, unknown>;

  // Required from v2 on: the migration step for v1 fills `"MMGS"` (that version's
  // de-facto default), so anything reaching this check without a known system is a file
  // that was edited by hand, not one an older app wrote.
  if (
    typeof envelope.unitSystem !== "string" ||
    !UNIT_SYSTEMS.has(envelope.unitSystem)
  ) {
    return { ok: false, error: `unknown unit system (${String(envelope.unitSystem)})` };
  }

  const documentError = validateDocument(envelope.document);
  if (documentError) return { ok: false, error: documentError };

  const sketchesError = validateSketches(envelope.sketches);
  if (sketchesError) return { ok: false, error: sketchesError };

  return { ok: true, saved: migration.saved };
}

function validateDocument(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "the file is not a MaBuCAD document";
  const document = value as Record<string, unknown>;

  if (typeof document.name !== "string") return "the document has no name";
  if (!DOCUMENT_KINDS.has(String(document.kind))) return `unknown document kind (${String(document.kind)})`;

  if (!Array.isArray(document.features)) return "the document has no feature list";
  for (const rawFeature of document.features) {
    if (typeof rawFeature !== "object" || rawFeature === null) return "a feature is not an object";
    const feature = rawFeature as Record<string, unknown>;
    if (typeof feature.id !== "string" || feature.id.length === 0) return "a feature has no id";
    if (typeof feature.name !== "string") return `feature "${feature.id}" has no name`;
    if (!Object.prototype.hasOwnProperty.call(FEATURE_CATALOG, feature.kind as PropertyKey)) {
      return `feature "${feature.id}" has unknown kind "${String(feature.kind)}"`;
    }
    if (typeof feature.suppressed !== "boolean") return `feature "${feature.id}" has a non-boolean suppressed flag`;
    if (
      Array.isArray(feature.parents) &&
      feature.parents.some((parent) => typeof parent !== "string")
    ) {
      return `feature "${feature.id}" has a non-string parent reference`;
    }
    if (
      feature.parameters !== undefined &&
      (typeof feature.parameters !== "object" || feature.parameters === null)
    ) {
      return `feature "${feature.id}" has non-object parameters`;
    }
  }

  const rollbackIndex = document.rollbackIndex;
  if (
    typeof rollbackIndex !== "number" ||
    !Number.isInteger(rollbackIndex) ||
    rollbackIndex < 0 ||
    rollbackIndex > (document.features as unknown[]).length
  ) {
    return "the rollback position is out of range";
  }

  return null;
}

const ENTITY_KINDS: ReadonlySet<string> = new Set(["line", "circle", "arc", "spline", "point"]);
const CONSTRAINT_KINDS: ReadonlySet<string> = new Set([
  "coincident",
  "horizontal",
  "vertical",
  "parallel",
  "perpendicular",
  "tangent",
  "concentric",
  "equal",
  "point-on-line",
  "point-on-circle",
  "point-on-spline",
  "fix",
  "fix-line",
  "midpoint",
  "colinear",
  "arc-radius",
]);
const DIMENSION_KINDS: ReadonlySet<string> = new Set([
  "distance",
  "horizontal-distance",
  "vertical-distance",
  "point-line-distance",
  "radius",
  "diameter",
  "angle",
  "ordinate-x",
  "ordinate-y",
]);

function validateSketches(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "the document has no sketches";
  }
  const sketches = value as Record<string, unknown>;

  for (const [sketchId, rawSketch] of Object.entries(sketches)) {
    if (typeof rawSketch !== "object" || rawSketch === null) return `sketch "${sketchId}" is not an object`;
    const sketch = rawSketch as Record<string, unknown>;
    if (typeof sketch.planeId !== "string") return `sketch "${sketchId}" has no plane`;

    if (!Array.isArray(sketch.points)) return `sketch "${sketchId}" has no point pool`;
    const pointIds = new Set<string>();
    for (const rawPoint of sketch.points) {
      if (typeof rawPoint !== "object" || rawPoint === null) return `sketch "${sketchId}" has a non-object point`;
      const point = rawPoint as Record<string, unknown>;
      if (typeof point.id !== "string" || point.id.length === 0) return `sketch "${sketchId}" has a point with no id`;
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return `sketch "${sketchId}" has a point with a non-numeric position`;
      }
      pointIds.add(point.id);
    }

    if (!Array.isArray(sketch.entities)) return `sketch "${sketchId}" has no entities`;
    for (const rawEntity of sketch.entities) {
      if (typeof rawEntity !== "object" || rawEntity === null) return `sketch "${sketchId}" has a non-object entity`;
      const entity = rawEntity as Record<string, unknown>;
      if (typeof entity.id !== "string" || entity.id.length === 0) return `sketch "${sketchId}" has an entity with no id`;
      if (!ENTITY_KINDS.has(String(entity.kind))) {
        return `sketch "${sketchId}" has an entity of unknown kind "${String(entity.kind)}"`;
      }
      if (entity.construction !== undefined && typeof entity.construction !== "boolean") {
        return `sketch "${sketchId}" has an entity with a non-boolean construction flag`;
      }
      const references = entityPointReferences(entity);
      for (const referenced of references) {
        if (!pointIds.has(referenced)) {
          return `sketch "${sketchId}" entity "${entity.id}" references a missing point`;
        }
      }
      if ((entity.kind === "circle" || entity.kind === "arc") && !Number.isFinite(entity.radius)) {
        return `sketch "${sketchId}" has a curve entity with a non-numeric radius`;
      }
    }

    if (sketch.constraints !== undefined) {
      if (!Array.isArray(sketch.constraints)) return `sketch "${sketchId}" has a non-array constraints list`;
      for (const rawConstraint of sketch.constraints) {
        if (typeof rawConstraint !== "object" || rawConstraint === null) {
          return `sketch "${sketchId}" has a non-object constraint`;
        }
        const constraint = rawConstraint as Record<string, unknown>;
        if (!CONSTRAINT_KINDS.has(String(constraint.kind))) {
          return `sketch "${sketchId}" has a constraint of unknown kind "${String(constraint.kind)}"`;
        }
      }
    }

    if (sketch.dimensions !== undefined) {
      if (!Array.isArray(sketch.dimensions)) return `sketch "${sketchId}" has a non-array dimensions list`;
      for (const rawDimension of sketch.dimensions) {
        if (typeof rawDimension !== "object" || rawDimension === null) {
          return `sketch "${sketchId}" has a non-object dimension`;
        }
        const dimension = rawDimension as Record<string, unknown>;
        if (!DIMENSION_KINDS.has(String(dimension.kind))) {
          return `sketch "${sketchId}" has a dimension of unknown kind "${String(dimension.kind)}"`;
        }
        if (!Number.isFinite(dimension.value)) {
          return `sketch "${sketchId}" has a dimension with a non-numeric value`;
        }
      }
    }
  }

  return null;
}

/** Every point id an entity's geometry hangs off — used to check referential integrity
 * against the sketch's own point pool, so a hand-edited or truncated file can't leave an
 * entity pointing at a point that isn't there. */
function entityPointReferences(entity: Record<string, unknown>): string[] {
  switch (entity.kind) {
    case "line":
      return [entity.start, entity.end].filter((id): id is string => typeof id === "string");
    case "circle":
      return [entity.center].filter((id): id is string => typeof id === "string");
    case "arc":
      return [entity.center, entity.start, entity.end].filter((id): id is string => typeof id === "string");
    case "point":
      return [entity.at].filter((id): id is string => typeof id === "string");
    case "spline":
      return Array.isArray(entity.points) ? entity.points.filter((id): id is string => typeof id === "string") : [];
    default:
      return [];
  }
}
