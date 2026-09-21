import { sketchStatusFromDiagnostics } from "./solver";
import type { DimensionKind, GeometricConstraintKind, Sketch, SketchDiagnostics, SketchEntity } from "./types";

/**
 * Complete fallback labels for every relation kind the solver can hold — the one place
 * the Sketch Doctor's relation names come from. The viewport glyphs and the Add Relation
 * grid keep their own icon-bearing maps, but any text that has to name an arbitrary
 * relation — including the internal kinds no ribbon button creates (`fix-line`,
 * `point-on-*`, `midpoint`, `arc-radius`) — should fall back to a shared map like this
 * one rather than gaining yet another partial `Record` of its own. The panel renders
 * `t(\`relation.${kind}\`, RELATION_LABEL[kind])`, so the Slovak/English dictionary wins
 * for the visible kinds while the internal ones still get a stable English name.
 */
export const RELATION_LABEL: Record<GeometricConstraintKind, string> = {
  coincident: "Coincident",
  horizontal: "Horizontal",
  vertical: "Vertical",
  parallel: "Parallel",
  perpendicular: "Perpendicular",
  tangent: "Tangent",
  concentric: "Concentric",
  equal: "Equal",
  "point-on-line": "Point on line",
  "point-on-circle": "Point on circle",
  "point-on-spline": "Point on spline",
  midpoint: "Midpoint",
  fix: "Fix point",
  "fix-line": "Fix line (extendable)",
  colinear: "Colinear",
  "arc-radius": "Arc radius",
};

export type DoctorStatus = "fully-defined" | "under-defined" | "over-defined";

/**
 * A sketch entity named the way a user would name it: "Line 2" / "Circle 1", i.e. the
 * kind plus a 1-based ordinal counted over entities of the *same kind* in sketch order.
 * The ordinals are computed structurally here (pure, deterministic) so the panel can
 * localise just the kind word while the numbering stays exact.
 */
export interface EntityRef {
  id: string;
  kind: SketchEntity["kind"];
  ordinal: number;
}

/**
 * One relation the sketch is over-defined *through* — a constraint or dimension whose
 * individual removal clears the conflict (the store's `conflictingIds`, computed by
 * `findConflictingConstraints`). Point-only relations (coincident, fix-on-a-point, …)
 * leave `targets` empty; the panel then renders the bare relation name. A discriminated
 * union so consumers can narrow `kind` by `source` without casts — which is also how the
 * two shapes genuinely differ: a dimension's `targets` are always empty and only a
 * dimension carries a measured `value`.
 */
export type DoctorConflict =
  | {
      id: string;
      source: "constraint";
      kind: GeometricConstraintKind;
      /** Entity references the relation acts on — empty for point-only relations. */
      targets: EntityRef[];
    }
  | {
      id: string;
      source: "dimension";
      kind: DimensionKind;
      targets: EntityRef[];
      /** Driving value in millimetres, or degrees for angles. */
      value?: number;
    };

/** The Sketch Doctor section's whole render input, ready to consume without further logic. */
export interface SketchHealth {
  status: DoctorStatus;
  dof: number;
  /** Relations flagged by `findConflictingConstraints` — empty when none is singly to blame. */
  conflicts: DoctorConflict[];
  /** Movable entities (blue in the viewport), in sketch order — construction geometry excluded. */
  freeEntities: EntityRef[];
}

/**
 * Pure, presentation-free diagnosis of a sketch for the Sketch Doctor panel section.
 *
 * It deliberately does no i18n (the panel composes labels with its own `t()`), owns no
 * React state, and never re-solves anything: it reinterprets the solver output the store
 * already holds (`diagnostics`, `conflictingIds`, `underDefinedEntityIds`) into
 * render-ready structure. Construction entities are left off the free list because they
 * stay in their type-specific colour in the viewport rather than turning blue — listing
 * them here would invite the user to "select the blue one" that isn't blue.
 *
 * Driven (reference) dimensions can never reach the conflict list: they contribute no
 * equations (see `residuals.ts`), so `findConflictingConstraints` cannot flag them, and
 * nothing in here re-adds them — the two layers' agreement is what the conflict rows must
 * not lie about.
 */
export function diagnoseSketch(
  sketch: Sketch,
  diagnostics: SketchDiagnostics,
  conflictingIds: readonly string[],
  underDefinedEntityIds: readonly string[],
): SketchHealth {
  const conflicted = new Set(conflictingIds);
  const underDefined = new Set(underDefinedEntityIds);

  // 1-based per-kind ordinals in sketch order — the "Line 2"/"Circle 1" halves of labels.
  const ordinalOf = new Map<string, number>();
  const nextOrdinal = new Map<SketchEntity["kind"], number>();
  for (const entity of sketch.entities) {
    const next = (nextOrdinal.get(entity.kind) ?? 0) + 1;
    nextOrdinal.set(entity.kind, next);
    ordinalOf.set(entity.id, next);
  }

  const entityRefOf = (id: string): EntityRef | null => {
    const entity = sketch.entities.find((candidate) => candidate.id === id);
    if (!entity) return null;
    return { id, kind: entity.kind, ordinal: ordinalOf.get(id) ?? 0 };
  };

  const conflicts: DoctorConflict[] = [];
  for (const constraint of sketch.constraints) {
    if (!conflicted.has(constraint.id)) continue;
    conflicts.push({
      id: constraint.id,
      source: "constraint",
      kind: constraint.kind,
      targets: constraint.entities
        .map(entityRefOf)
        .filter((ref): ref is EntityRef => ref !== null),
    });
  }
  for (const dimension of sketch.dimensions) {
    if (!conflicted.has(dimension.id)) continue;
    conflicts.push({
      id: dimension.id,
      source: "dimension",
      kind: dimension.kind,
      targets: [],
      value: dimension.value,
    });
  }

  const freeEntities: EntityRef[] = [];
  for (const entity of sketch.entities) {
    if (!underDefined.has(entity.id) || entity.construction) continue;
    const ref = entityRefOf(entity.id);
    if (ref) freeEntities.push(ref);
  }

  return {
    status: sketchStatusFromDiagnostics(diagnostics),
    dof: diagnostics.dof,
    conflicts,
    freeEntities,
  };
}
