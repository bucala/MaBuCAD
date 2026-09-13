import { describe, expect, it } from "vitest";

import { drawCircle } from "replicad";

import type { Sketch } from "@/sketch/types";
import type { Feature } from "@/types/document";

import { initKernel } from "./occ";
import { registerImportedShape, releaseImportedShape } from "./importedShapes";
import {
  __clearRebuildCacheForTesting,
  __rebuildCacheDiagnosticsForTesting,
  rebuildDocument,
  type MeshData,
} from "./rebuild";
import {
  contentHash,
  longestReusablePrefix,
  planCheckpointEviction,
  prefixKeys,
  type RebuildCheckpoint,
} from "./rebuildCache";

/**
 * The prefix cache's correctness suite, in two halves.
 *
 * The first half exercises the pure, kernel-free decisions in `rebuildCache.ts` — key
 * divergence, prefix matching, and the eviction plan's aliasing rules — with dummy
 * objects, so a regression there is named precisely without a 600 ms kernel replay
 * between assertions.
 *
 * The second half boots the real kernel and proves the property that actually matters:
 * a rebuild resumed from cached checkpoints produces a byte-identical mesh to a full
 * replay of the same document. Those specs need the WASM alias in `vitest.config.ts`
 * (`absoluteWasmUrl`) to boot the kernel under Node.
 */

// ——————————————————————————————————————————————————————————————————————————————
// Fixture: a deep, realistic history (base box → every-edge fillet → nine channels →
// three patterns) whose later features get progressively dearer, i.e. the history shape
// the cache exists for.
// ——————————————————————————————————————————————————————————————————————————————

const PLANE = "plane-front";

function squareSketch(id: string, x: number, y: number, size: number): Sketch {
  const p = (pid: string, px: number, py: number) => ({ id: pid, x: px, y: py });
  return {
    id,
    planeId: PLANE,
    points: [p("q1", x, y), p("q2", x + size, y), p("q3", x + size, y + size), p("q4", x, y + size)],
    entities: [
      { id: "l1", kind: "line", start: "q1", end: "q2", construction: false },
      { id: "l2", kind: "line", start: "q2", end: "q3", construction: false },
      { id: "l3", kind: "line", start: "q3", end: "q4", construction: false },
      { id: "l4", kind: "line", start: "q4", end: "q1", construction: false },
    ],
    constraints: [],
    dimensions: [],
  };
}

function feature(id: string, kind: Feature["kind"], parents: string[], parameters: Feature["parameters"]): Feature {
  return { id, kind, name: id, suppressed: false, isDefault: false, parents, parameters };
}

function deepHistory(): { features: Feature[]; sketches: Record<string, Sketch> } {
  const features: Feature[] = [feature("s1", "sketch", [PLANE], {})];
  const sketches: Record<string, Sketch> = { s1: squareSketch("s1", 0, 0, 30) };

  features.push(feature("f0", "extrude", ["s1"], { depth: 10, endCondition: "blind", operation: "join" }));
  features.push(feature("d1", "fillet", [], { radius: 1.2 }));

  const centres = [9, 16, 23];
  let channel = 0;
  for (const cy of centres) {
    for (const cx of centres) {
      channel += 1;
      const sketchId = `c${channel}`;
      sketches[sketchId] = squareSketch(sketchId, cx - 2, cy - 2, 4);
      features.push(
        feature(
          `cut${channel}`,
          "cut-extrude",
          [sketchId],
          channel === 9 ? { endCondition: "blind", depth: 6, operation: "cut" } : { endCondition: "through-all", operation: "cut" },
        ),
      );
    }
  }

  features.push(feature("pat1", "linear-pattern", ["f0"], { axis: "x", count: 3, distance: 25 }));
  features.push(feature("pat2", "linear-pattern", ["d1"], { axis: "y", count: 2, distance: 27 }));
  features.push(feature("pat3", "mirror", ["f0"], { axis: "y" }));

  return { features, sketches };
}

/** Evaluated features in the fixture: sketch + extrude + fillet + 9 cuts + 3 patterns. */
const EVALUATED_COUNT = 15;

const withRadius = (features: Feature[], id: string, radius: number): Feature[] =>
  features.map((f) => (f.id === id ? { ...f, parameters: { ...f.parameters, radius } } : f));

const withSuppressed = (features: Feature[], id: string): Feature[] =>
  features.map((f) => (f.id === id ? { ...f, suppressed: true } : f));

// ——————————————————————————————————————————————————————————————————————————————
// Mesh comparison — element-wise, so a byte difference anywhere in a resumed replay's
// geometry is a failure, not a rounding question.
// ——————————————————————————————————————————————————————————————————————————————

const numericArrayEqual = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

function expectIdenticalMesh(received: MeshData | null, expected: MeshData | null): void {
  if (!received || !expected) {
    expect(received).toBe(expected);
    return;
  }
  expect(numericArrayEqual(received.positions, expected.positions), "positions differ").toBe(true);
  expect(numericArrayEqual(received.normals, expected.normals), "normals differ").toBe(true);
  expect(numericArrayEqual(received.indices, expected.indices), "indices differ").toBe(true);
  expect(numericArrayEqual(received.edges, expected.edges), "edges differ").toBe(true);
  expect(received.rotation, "rotation differs").toEqual(expected.rotation);
  expect(received.faceGroups.map((g) => [g.start, g.count]), "face groups differ").toEqual(
    expected.faceGroups.map((g) => [g.start, g.count]),
  );
  expect(received.edgeGroups.map((g) => [g.start, g.count]), "edge groups differ").toEqual(
    expected.edgeGroups.map((g) => [g.start, g.count]),
  );
}

// ——————————————————————————————————————————————————————————————————————————————
// Pure logic
// ——————————————————————————————————————————————————————————————————————————————

describe("rebuildCache pure logic", () => {
  it("hashes content deterministically and sensitively", () => {
    expect(contentHash("hello")).toBe(contentHash("hello"));
    expect(contentHash("hello")).toHaveLength(16);
    expect(contentHash("hello")).not.toBe(contentHash("hellp"));
    expect(contentHash("hello")).not.toBe(contentHash("hello "));
  });

  it("computes identical keys for identical content and diverges exactly at an edited feature", () => {
    const { features, sketches } = deepHistory();
    const keys = prefixKeys(features, sketches);
    expect(keys).toHaveLength(EVALUATED_COUNT);
    expect(prefixKeys(features, sketches)).toEqual(keys);

    // A parameter edit on cut5 (evaluated index 7) diverges there and stays diverged.
    const edited = withRadius(features, "cut5", 99);
    const editedKeys = prefixKeys(edited, sketches);
    const prefix = longestReusablePrefix(keys, editedKeys);
    expect(prefix).toBe(7);
    for (let i = 7; i < EVALUATED_COUNT; i++) expect(editedKeys[i]).not.toBe(keys[i]);
  });

  it("diverges at the first feature referencing an edited sketch, and not for unrelated edits", () => {
    const { features, sketches } = deepHistory();
    const keys = prefixKeys(features, sketches);

    // Move a point of channel 5's sketch; cut5 (index 7) is the first — and only — reader.
    const movedSketches = { ...sketches, c5: { ...sketches.c5!, points: sketches.c5!.points.map((p) => ({ ...p, y: p.y + 1 })) } };
    const movedKeys = prefixKeys(features, movedSketches);
    expect(longestReusablePrefix(keys, movedKeys)).toBe(7);

    // Editing a sketch nothing reads (an orphan) changes no key.
    const orphan = { ...sketches, unused: squareSketch("unused", 0, 0, 5) };
    expect(prefixKeys(features, orphan)).toEqual(keys);
  });

  it("diverges when a feature is suppressed, at the suppressed feature's own index", () => {
    const { features, sketches } = deepHistory();
    const keys = prefixKeys(features, sketches);

    // Suppressing d1 (index 2) removes it from the evaluated list; everything after it
    // shifts one slot earlier, so key[1] still matches and key[2] (now cut1's prefix)
    // cannot.
    const suppressedKeys = prefixKeys(withSuppressed(features, "d1"), sketches);
    expect(longestReusablePrefix(keys, suppressedKeys)).toBe(2);
  });

  it("matches an empty chain or fully-identical history at the right depth", () => {
    expect(longestReusablePrefix([], ["a"])).toBe(0);
    expect(longestReusablePrefix(["a", "b"], ["a", "b", "c"])).toBe(2);
    expect(longestReusablePrefix(["a", "b", "c"], ["a", "b", "c"])).toBe(3);
    expect(longestReusablePrefix(["a", "x"], ["a", "b"])).toBe(1);
  });

  it("plans eviction: releases the replaced tail, keeps the reused prefix", () => {
    const prefixObject = { tag: "prefix" };
    const oldTail = { tag: "old-tail" };
    const oldFinal = { tag: "old-final" };
    const newTail = { tag: "new-tail" };

    const checkpoint = (key: string, current: unknown, solids: unknown[]): RebuildCheckpoint<unknown> => ({
      key,
      current: current as never,
      featureSolids: new Map(solids.map((solid) => ["f", { solid: solid as never, operation: "join" as const }])),
      rotation: [0, 0, 0],
    });

    // Old chain: [prefix, oldTail(oldFinal)] → new chain: [prefix(same object), newTail].
    const oldChain = [checkpoint("k0", prefixObject, [prefixObject]), checkpoint("k1", oldTail, [oldTail, oldFinal])];
    const newChain = [checkpoint("k0", prefixObject, [prefixObject]), checkpoint("k1", newTail, [newTail])];

    const doomed = planCheckpointEviction(oldChain, newChain, oldFinal, newTail);
    expect(doomed.has(prefixObject)).toBe(false); // reused prefix survives
    expect(doomed.has(newTail)).toBe(false); // new chain's own objects survive
    expect(doomed.has(oldTail)).toBe(true); // replaced tail dies
    expect(doomed.has(oldFinal)).toBe(true); // old final (in old chain) dies
    expect(doomed.size).toBe(2);
  });

  it("plans eviction: releases a final no checkpoint owns, and never the unchanged final", () => {
    const finalShape = { tag: "final" };

    // Healthy-then-error history: the chain stopped before the final, so the final is
    // owned by nobody but the previous rebuild's result — exactly the case the plan must
    // fold in so `rebuild.ts` no longer deletes it itself.
    const chain: RebuildCheckpoint<unknown>[] = [];
    const replaced = planCheckpointEviction(chain, chain, finalShape, { tag: "next" });
    expect(replaced.has(finalShape)).toBe(true);

    // A no-change rebuild: the final is reused as-is and must survive.
    const kept = planCheckpointEviction(chain, chain, finalShape, finalShape);
    expect(kept.has(finalShape)).toBe(false);
  });

  it("plans eviction: aliased objects are released once, never while any kept entry references them", () => {
    // A pass-through dress-up leaves the body untouched, so checkpoint 1's `current`
    // aliases checkpoint 0's; its feature-solid also aliases that same object.
    const shared = { tag: "shared" };
    const aliasingCheckpoint = (key: string): RebuildCheckpoint<unknown> => ({
      key,
      current: shared as never,
      featureSolids: new Map([["dressup", { solid: shared as never, operation: "join" as const }]]),
      rotation: [0, 0, 0],
    });

    // New chain keeps the pass-through (same content) → the shared object survives even
    // though the old chain referenced it from two entries and two roles.
    const kept = planCheckpointEviction(
      [aliasingCheckpoint("a"), aliasingCheckpoint("b")],
      [aliasingCheckpoint("a")],
      shared,
      shared,
    );
    expect(kept.size).toBe(0);

    // New chain drops it entirely → it dies exactly once despite every alias.
    const dropped = planCheckpointEviction([aliasingCheckpoint("a"), aliasingCheckpoint("b")], [], shared, { tag: "next" });
    expect([...dropped]).toEqual([shared]);
  });
});

// ——————————————————————————————————————————————————————————————————————————————
// Kernel-backed correctness
// ——————————————————————————————————————————————————————————————————————————————

describe("rebuild prefix cache (kernel)", () => {
  it(
    "produces a byte-identical mesh when resumed from a cached prefix",
    async () => {
      await initKernel();
      __clearRebuildCacheForTesting();
      const { features, sketches } = deepHistory();

      // Populate the cache, then make a real geometry change (cut9's blind depth) and
      // rebuild — this one must resume partway rather than replay from scratch.
      await rebuildDocument(features, sketches);
      const edited = features.map((f) =>
        f.id === "cut9" ? { ...f, parameters: { ...f.parameters, depth: 6.5 } } : f,
      );
      const resumed = await rebuildDocument(edited, sketches);
      const { replayedFrom } = __rebuildCacheDiagnosticsForTesting();
      expect(replayedFrom, "a cut9 edit should resume before cut9 (index 11)").toBe(11);
      expect(resumed.errors).toEqual({});

      // Same document replayed from scratch must agree byte for byte.
      __clearRebuildCacheForTesting();
      const full = await rebuildDocument(edited, sketches);
      expect(__rebuildCacheDiagnosticsForTesting().replayedFrom).toBe(0);
      expectIdenticalMesh(resumed.mesh, full.mesh);
      expect(resumed.errors).toEqual(full.errors);
    },
    120_000,
  );

  it(
    "reuses the whole history for an unchanged rebuild",
    async () => {
      await initKernel();
      __clearRebuildCacheForTesting();
      const { features, sketches } = deepHistory();

      const first = await rebuildDocument(features, sketches);
      const again = await rebuildDocument(features, sketches);

      expect(__rebuildCacheDiagnosticsForTesting().replayedFrom).toBe(EVALUATED_COUNT);
      expect(__rebuildCacheDiagnosticsForTesting().entries).toBe(EVALUATED_COUNT);
      expectIdenticalMesh(again.mesh, first.mesh);
    },
    120_000,
  );

  it(
    "diverges at the first feature reading an edited sketch",
    async () => {
      await initKernel();
      __clearRebuildCacheForTesting();
      const { features, sketches } = deepHistory();
      await rebuildDocument(features, sketches);

      // Move channel 5's sketch: cut5 is evaluated index 7, the first reader.
      const moved = { ...sketches, c5: { ...sketches.c5!, points: sketches.c5!.points.map((p) => ({ ...p, x: p.x + 0.5 })) } };
      const resumed = await rebuildDocument(features, moved);
      expect(__rebuildCacheDiagnosticsForTesting().replayedFrom).toBe(7);

      __clearRebuildCacheForTesting();
      const full = await rebuildDocument(features, moved);
      expectIdenticalMesh(resumed.mesh, full.mesh);
    },
    120_000,
  );

  it(
    "diverges when a feature is suppressed and matches the unsuppressed rebuild of the same state",
    async () => {
      await initKernel();
      __clearRebuildCacheForTesting();
      const { features, sketches } = deepHistory();
      await rebuildDocument(features, sketches);

      const suppressed = withSuppressed(features, "d1");
      const resumed = await rebuildDocument(suppressed, sketches);
      expect(__rebuildCacheDiagnosticsForTesting().replayedFrom).toBe(2);

      __clearRebuildCacheForTesting();
      const full = await rebuildDocument(suppressed, sketches);
      expectIdenticalMesh(resumed.mesh, full.mesh);
    },
    120_000,
  );

  it(
    "stops caching at an errored feature and recovers when the error is fixed",
    async () => {
      await initKernel();
      __clearRebuildCacheForTesting();
      const { features, sketches } = deepHistory();

      // A 30 mm box cannot take a 50 mm every-edge fillet: d1 (index 2) errors, and the
      // chain must stop there — an errored prefix is never to be trusted, since whatever
      // fixed it may live outside the document.
      const broken = withRadius(features, "d1", 50);
      const failed = await rebuildDocument(broken, sketches);
      expect(failed.errors.d1).toBeTruthy();
      expect(failed.mesh).not.toBeNull(); // the extrude still shows
      expect(__rebuildCacheDiagnosticsForTesting().entries).toBe(2); // s1 + f0 only

      // Fixing the fillet resumes from f0's checkpoint and caches the whole history again.
      const fixed = await rebuildDocument(features, sketches);
      expect(fixed.errors).toEqual({});
      expect(__rebuildCacheDiagnosticsForTesting().replayedFrom).toBe(2);
      expect(__rebuildCacheDiagnosticsForTesting().entries).toBe(EVALUATED_COUNT);

      // And the recovered rebuild still matches a from-scratch one.
      __clearRebuildCacheForTesting();
      const full = await rebuildDocument(features, sketches);
      expectIdenticalMesh(fixed.mesh, full.mesh);
    },
    120_000,
  );

  it(
    "never caches across an imported body, and stays correct when the registry swaps it",
    async () => {
      await initKernel();
      __clearRebuildCacheForTesting();
      const { features, sketches } = deepHistory();

      // NOTE on what can and cannot be asserted here: re-fusing a registry object that a
      // previous rebuild already fused is NOT bit-stable — OpenCASCADE booleans update
      // tolerances on the shared TShape data that even replicad's `clone()` keeps, so the
      // mesh measurably drifts between repeated replays (3432 → 1008 positions in a
      // probe). That is a pre-existing defect in the imported-body path, independent of
      // this cache (which is why the cache refuses to store anything across an import in
      // the first place). Byte-identity is therefore only asserted between replays that
      // are each a *first* use of a freshly built, content-identical import.
      const freshImport = () => drawCircle(10).sketchOnPlane("XY").extrude(5) as never;
      registerImportedShape("imp", freshImport());
      try {
        const withImport: Feature[] = [
          feature("imp", "imported", [], {}),
          ...features.filter((f) => f.id !== "s1"),
        ];

        const first = await rebuildDocument(withImport, sketches);
        expect(first.errors).toEqual({});
        expect(first.mesh).not.toBeNull();
        // The import poisons the chain from index 0: nothing may be cached.
        expect(__rebuildCacheDiagnosticsForTesting().entries).toBe(0);

        // An edit after the import still replays everything (no checkpoint spans the
        // import), and produces no errors.
        const edited = withImport.map((f) => (f.id === "cut9" ? { ...f, parameters: { ...f.parameters, depth: 6.5 } } : f));
        const resumed = await rebuildDocument(edited, sketches);
        expect(__rebuildCacheDiagnosticsForTesting().replayedFrom).toBe(0);
        expect(resumed.errors).toEqual({});
        expect(resumed.mesh).not.toBeNull();

        // Determinism of the replay path itself: two first-use replays of the same
        // content with freshly built, identical imports must agree byte for byte.
        registerImportedShape("imp", freshImport());
        __clearRebuildCacheForTesting();
        const fullFirstUse = await rebuildDocument(edited, sketches);
        registerImportedShape("imp", freshImport());
        __clearRebuildCacheForTesting();
        const fullFirstUseAgain = await rebuildDocument(edited, sketches);
        expectIdenticalMesh(fullFirstUse.mesh, fullFirstUseAgain.mesh);

        // The registry may release and re-register a different body while the cache
        // holds nothing across the import — this must neither dangle nor crash, and the
        // geometry must actually change to reflect the new body.
        releaseImportedShape("imp");
        registerImportedShape("imp", drawCircle(4).sketchOnPlane("XY").extrude(3) as never);
        const swapped = await rebuildDocument(edited, sketches);
        expect(swapped.errors).toEqual({});
        expect(swapped.mesh!.positions.length).not.toBe(fullFirstUse.mesh!.positions.length);
      } finally {
        releaseImportedShape("imp");
      }
    },
    120_000,
  );

  it(
    "survives thrashing between two documents without corrupting the kernel heap",
    async () => {
      await initKernel();
      __clearRebuildCacheForTesting();
      const { features, sketches } = deepHistory();
      const other = {
        features: [features[0]!, features[1]!, features[2]!],
        sketches: { s1: sketches.s1! },
      };

      // Alternating documents evict and rebuild whole chains; a mistake in the eviction
      // plan double-frees a WASM shape and corrupts the heap, which shows up as a crash
      // or nonsense geometry on a later rebuild — this canary alternates enough times to
      // catch either, and checks the final meshes against from-scratch replays.
      let lastA: MeshData | null = null;
      let lastB: MeshData | null = null;
      for (let round = 0; round < 4; round++) {
        lastA = (await rebuildDocument(features, sketches)).mesh;
        lastB = (await rebuildDocument(other.features, other.sketches)).mesh;
      }
      expect(lastA).not.toBeNull();
      expect(lastB).not.toBeNull();

      __clearRebuildCacheForTesting();
      const fullA = await rebuildDocument(features, sketches);
      const fullB = await rebuildDocument(other.features, other.sketches);
      expectIdenticalMesh(lastA, fullA.mesh);
      expectIdenticalMesh(lastB, fullB.mesh);
    },
    180_000,
  );
});
