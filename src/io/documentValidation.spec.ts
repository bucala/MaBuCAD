import { describe, expect, it } from "vitest";

import {
  DOCUMENT_FORMAT_VERSION,
  MIN_SUPPORTED_FORMAT_VERSION,
  migrateSavedDocument,
  validateSavedDocument,
} from "./documentValidation";

/**
 * The validator is the gate between an untrusted `.mabucad` file and the stores/kernel, so
 * these tests pin the shape checks that used to be three `"x" in value` lookups: every
 * rejection below is a crash (or worse, a wrong rebuild) that previously reached the
 * kernel as arbitrary JSON.
 */

/** A minimal envelope that passes validation; each test breaks exactly one thing in it. */
function validDocument(): Record<string, unknown> {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    document: {
      name: "Part1",
      kind: "part",
      features: [
        {
          id: "f1",
          name: "Boss-Extrude1",
          kind: "extrude",
          suppressed: false,
          parents: [],
          parameters: { depth: 10 },
        },
      ],
      rollbackIndex: 1,
    },
    sketches: {
      "s1": {
        id: "s1",
        planeId: "front",
        points: [{ id: "p1", x: 0, y: 0 }, { id: "p2", x: 10, y: 0 }],
        entities: [{ id: "l1", kind: "line", start: "p1", end: "p2", construction: false }],
        constraints: [],
        dimensions: [{ id: "d1", kind: "distance", value: 10, points: ["p1", "p2"], entities: [], labelOffset: { x: 0, y: 0 } }],
      },
    },
    unitSystem: "MMGS",
  };
}

function expectRejected(value: unknown, message: RegExp): void {
  const result = validateSavedDocument(value);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatch(message);
}

describe("validateSavedDocument", () => {
  it("accepts a well-formed document and hands back its envelope", () => {
    const result = validateSavedDocument(validDocument());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.saved.document.name).toBe("Part1");
      expect(result.saved.sketches["s1"].points).toHaveLength(2);
    }
  });

  it("rejects non-objects and wrong format versions up front", () => {
    expectRejected(null, /not a MaBuCAD document/);
    expectRejected("Part1", /not a MaBuCAD document/);
    expectRejected([validDocument()], /not a MaBuCAD document/);

    const futureVersion = { ...(validDocument() as object), formatVersion: DOCUMENT_FORMAT_VERSION + 1 } as Record<string, unknown>;
    expectRejected(futureVersion, /unsupported format version/);
  });

  it("rejects documents of an unknown kind", () => {
    const value = validDocument();
    (value.document as Record<string, unknown>).kind = "widget";
    expectRejected(value, /unknown document kind/);
  });

  it("rejects features with a missing id, no name, or an unknown kind", () => {
    const noId = validDocument();
    ((noId.document as Record<string, unknown>).features as Record<string, unknown>[])[0].id = "";
    expectRejected(noId, /has no id/);

    const noName = validDocument();
    ((noName.document as Record<string, unknown>).features as Record<string, unknown>[])[0].name = 7;
    expectRejected(noName, /has no name/);

    const unknownKind = validDocument();
    ((unknownKind.document as Record<string, unknown>).features as Record<string, unknown>[])[0].kind = "teleport";
    expectRejected(unknownKind, /unknown kind/);
  });

  it("rejects a rollback position outside the feature list", () => {
    const value = validDocument();
    (value.document as Record<string, unknown>).rollbackIndex = 2; // one feature, so 0..1
    expectRejected(value, /rollback position is out of range/);
  });

  it("rejects points with non-numeric positions", () => {
    const value = validDocument();
    const sketch = value.sketches as Record<string, Record<string, unknown>>;
    (sketch.s1.points as Record<string, unknown>[])[1].x = Number.NaN;
    expectRejected(value, /non-numeric position/);
  });

  it("rejects entities that reference a point missing from the pool", () => {
    const value = validDocument();
    const sketch = value.sketches as Record<string, Record<string, unknown>>;
    (sketch.s1.entities as Record<string, unknown>[])[0].end = "ghost";
    expectRejected(value, /references a missing point/);
  });

  it("rejects curve entities with a non-numeric radius", () => {
    const value = validDocument();
    const sketch = value.sketches as Record<string, Record<string, unknown>>;
    (sketch.s1.entities as Record<string, unknown>[])[0] = {
      id: "k1",
      kind: "circle",
      center: "p1",
      radius: "five",
      construction: false,
    };
    expectRejected(value, /non-numeric radius/);
  });

  it("rejects constraints and dimensions of unknown kinds", () => {
    const badConstraint = validDocument();
    const withConstraint = badConstraint.sketches as Record<string, Record<string, unknown>>;
    withConstraint.s1.constraints = [{ id: "c1", kind: "parallel-ish", entities: [], points: [] }];
    expectRejected(badConstraint, /unknown kind/);

    const badDimension = validDocument();
    const withDimension = badDimension.sketches as Record<string, Record<string, unknown>>;
    (withDimension.s1.dimensions as Record<string, unknown>[])[0].kind = "diagonal";
    expectRejected(badDimension, /unknown kind/);
  });

  it("rejects dimensions with non-numeric values", () => {
    const value = validDocument();
    const sketch = value.sketches as Record<string, Record<string, unknown>>;
    (sketch.s1.dimensions as Record<string, unknown>[])[0].value = null;
    expectRejected(value, /non-numeric value/);
  });

  it("rejects an unknown unit system", () => {
    const value = validDocument();
    value.unitSystem = "imperial-feet";
    expectRejected(value, /unknown unit system/);
  });

  it("requires a unit system at the current version", () => {
    // v2 files that were hand-stripped of units are broken files, not old files — the
    // migration chain supplies the default for genuinely older ones.
    const value = validDocument();
    delete value.unitSystem;
    expectRejected(value, /unknown unit system/);
  });
});

describe("migrateSavedDocument", () => {
  /** A version-1 envelope — no `unitSystem` at all, exactly as v1 saved them. */
  function v1Document(): Record<string, unknown> {
    const current = validDocument();
    delete current.unitSystem;
    current.formatVersion = 1;
    return current;
  }

  it("upgrades a v1 file to the current version, defaulting units to MMGS", () => {
    const migration = migrateSavedDocument(v1Document());
    expect(migration.ok).toBe(true);
    if (migration.ok) {
      expect(migration.fromVersion).toBe(1);
      expect(migration.saved.formatVersion).toBe(DOCUMENT_FORMAT_VERSION);
      expect(migration.saved.unitSystem).toBe("MMGS");
      // Everything the v1 file actually contained survives the round trip.
      expect(migration.saved.document.name).toBe("Part1");
      expect(migration.saved.sketches["s1"].points).toHaveLength(2);
    }
  });

  it("treats a pre-v1 explicit unit system as authoritative, not the default", () => {
    const value = v1Document();
    value.unitSystem = "CGS";
    const migrated = migrateSavedDocument(value);
    expect(migrated.ok).toBe(true);
    if (migrated.ok) expect(migrated.saved.unitSystem).toBe("CGS");
  });

  it("feeds the validator, so a migrated v1 file opens as a current document", () => {
    const validated = validateSavedDocument(v1Document());
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.saved.unitSystem).toBe("MMGS");
  });

  it("rejects versions outside what this build can read or migrate", () => {
    for (const version of [-1, 0, 3, 1.5, "1", null]) {
      const value = { ...(validDocument() as object), formatVersion: version } as Record<string, unknown>;
      const migrated = migrateSavedDocument(value);
      expect(migrated.ok, `version ${String(version)}`).toBe(false);
      if (!migrated.ok) expect(migrated.error).toMatch(/unsupported format version/);
    }
  });

  it("documents the supported version range in one place", () => {
    expect(MIN_SUPPORTED_FORMAT_VERSION).toBe(1);
    expect(DOCUMENT_FORMAT_VERSION).toBe(MIN_SUPPORTED_FORMAT_VERSION + 1);
  });
});
