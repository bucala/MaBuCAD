import type { Sketch } from "@/sketch/types";
import type { Feature } from "@/types/document";

/**
 * Content-addressed prefix cache for `kernel/rebuild.ts`'s parametric replay.
 *
 * `rebuildDocument` replays the whole feature history on every document change, which for
 * a deep history means re-running dozens of OpenCASCADE solids before the change the user
 * actually made. Since each feature only reads (a) the cumulative body so far, (b) the
 * per-feature solids of its potential pattern sources, (c) its own sketch, and (d) its own
 * parameters, a rebuild that changed feature *k* produces byte-identical prefix state to
 * the previous rebuild for every feature before *k* — so that state can simply be kept
 * and the replay resumed from *k*.
 *
 * This module holds the whole design as pure, kernel-free logic so it can be unit-tested
 * without booting the 11 MB WebAssembly kernel; `rebuild.ts` owns the actual kernel
 * shapes and calls in only for decisions. The pieces:
 *
 * - `prefixKeys` — a content hash for every evaluated-feature prefix. A key changes the
 *   moment any feature, or any sketch a feature reads, changes content anywhere in that
 *   prefix, so a matching key is a proof the cached state is still exactly what replaying
 *   that prefix would produce.
 * - `longestReusablePrefix` — how many leading keys two rebuilds share, i.e. how deep a
 *   cached checkpoint chain may be trusted before the histories diverge.
 * - `planCheckpointEviction` — which kernel objects die when one chain replaces another.
 *   The chain holds its shapes by strong reference, so replicad's own
 *   FinalizationRegistry (which deletes a shape's WASM memory once its wrapper drops out
 *   of reach) can never reclaim a checkpointed one — release has to be explicit, here,
 *   and this plan is the cache's whole memory-safety story; see its own doc comment for
 *   the aliasing rules.
 */

/** How a feature's solid combines with the cumulative body — mirrors the operation choice
 * in the property manager ("join"/"cut"/"intersect", with kind-specific defaults resolved
 * in `rebuild.ts` before it ever reaches a checkpoint). */
export type BooleanOperation = "join" | "cut" | "intersect";

/**
 * One cached replay state: everything the replay loop reads going forward, snapshotted
 * after one successfully evaluated feature. `featureSolids` is a *copy* of the map at that
 * point, so later features recording their own solids can never mutate an older
 * checkpoint.
 *
 * `current` may alias other checkpoints' objects (a dress-up whose edge pick is still
 * pending is a pure pass-through, leaving the body untouched), and a dress-up's
 * `featureSolids` entry always aliases that feature's own `current` — `planCheckpointEviction`
 * deals in object identity precisely because of this.
 */
export interface RebuildCheckpoint<TSolid = unknown> {
  /** `prefixKeys` value for the prefix this state follows — its content address. */
  key: string;
  /** The cumulative body after the prefix (`null` only if the prefix built nothing). */
  current: TSolid | null;
  /** Per-feature solids as of the end of the prefix, keyed by feature id. */
  featureSolids: ReadonlyMap<string, { solid: TSolid; operation: BooleanOperation }>;
  /** Display rotation the prefix's last sketch-based feature left in place. */
  rotation: [number, number, number];
}

/** Checkpoints kept per history — one per evaluated feature, so this caps both the
 * retained-solid count and the map copies at a number no real history approaches. */
export const MAX_CHECKPOINTS = 64;

/**
 * 64-bit FNV-1a as two independent 32-bit lanes concatenated to hex.
 *
 * A single 32-bit hash would collide often enough across a long editing session to make a
 * wrong-prefix reuse a real possibility, and a wrong prefix is silently wrong *geometry*
 * — the failure mode this whole module exists to make impossible. Two lanes with
 * different offset bases give a 64-bit effective digest with no collision ever observed
 * for adversarial input, at string-hashing speed and with no BigInt cost.
 */
function fnv1a32(text: string, offsetBasis: number): number {
  let hash = offsetBasis;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function contentHash(text: string): string {
  return (
    fnv1a32(text, 0x811c9dc5).toString(16).padStart(8, "0") +
    fnv1a32(text, 0x050c5d1f).toString(16).padStart(8, "0")
  );
}

/**
 * Hash of everything one evaluated feature reads during replay: the feature itself
 * (id, kind, parents, parameters) plus the full content of every parent that names a
 * sketch, since the sketch's geometry is what actually gets extruded/revolved/swept.
 * Sketches a feature does not reference do not enter its segment — editing an unrelated
 * sketch must not invalidate this feature's prefix.
 */
export function segmentHash(feature: Feature, sketches: Record<string, Sketch>): string {
  let segment = JSON.stringify(feature);
  for (const parent of feature.parents) {
    const sketch = sketches[parent];
    if (sketch) segment += `|${JSON.stringify(sketch)}`;
  }
  return contentHash(segment);
}

/**
 * Content address for every prefix of an evaluated feature list: `keys[i]` covers
 * features `0..i`. Built incrementally (each key chains the previous one) so hashing a
 * whole history stays linear, not quadratic, in feature count.
 */
export function prefixKeys(evaluated: readonly Feature[], sketches: Record<string, Sketch>): string[] {
  const keys: string[] = [];
  let chained = "";
  for (const feature of evaluated) {
    chained = contentHash(`${chained}|${segmentHash(feature, sketches)}`);
    keys.push(chained);
  }
  return keys;
}

/** How many leading checkpoints of a chain built for `oldKeys` still apply to `newKeys` —
 * the index the new replay can resume from is exactly this count. */
export function longestReusablePrefix(oldKeys: readonly string[], newKeys: readonly string[]): number {
  let shared = 0;
  while (shared < oldKeys.length && shared < newKeys.length && oldKeys[shared] === newKeys[shared]) {
    shared += 1;
  }
  return shared;
}

const collectCheckpointObjects = <TSolid>(
  chain: readonly RebuildCheckpoint<TSolid>[],
  into: Set<TSolid>,
): void => {
  for (const checkpoint of chain) {
    if (checkpoint.current !== null) into.add(checkpoint.current);
    for (const entry of checkpoint.featureSolids.values()) into.add(entry.solid);
  }
};

/**
 * Which kernel objects must be deleted when one checkpoint chain replaces another.
 *
 * Deletion rule, in one sentence: everything the old chain (or the replaced final solid)
 * referenced is released, except anything the new chain still references or the new final
 * still is. The subtraction-by-identity handles every aliasing case that makes this
 * non-obvious:
 *
 * - A dress-up's `featureSolids` entry aliases its own `current`, and a pass-through
 *   dress-up aliases the *previous* checkpoint's `current` too — the same object simply
 *   appears in both chains' collected sets and survives or dies once, not twice.
 * - On a partial reuse, the new chain's kept prefix references exactly the old chain's
 *   prefix objects, so they are excluded from deletion and stay alive for the next
 *   replay.
 * - `previousFinal` is folded into the old set: if the old chain stored it (healthy
 *   history) its fate is already decided above; if the chain stopped early (an error
 *   feature broke it) nothing else owns it, and it is released here rather than by
 *   `rebuild.ts`'s final-shape handling — which is why that handling no longer deletes
 *   anything itself.
 *
 * What is deliberately *not* here: shapes the replay allocated but never recorded (a
 * pattern's fused copies, a solid built by a feature that then errored). Those are left
 * to replicad's FinalizationRegistry, which reclaims exactly the wrappers nothing
 * references anymore — the pre-existing behaviour for every non-checkpointed
 * intermediate, unchanged by caching.
 */
export function planCheckpointEviction<TSolid>(
  oldChain: readonly RebuildCheckpoint<TSolid>[],
  newChain: readonly RebuildCheckpoint<TSolid>[],
  previousFinal: TSolid | null,
  nextFinal: TSolid | null,
): Set<TSolid> {
  const stillAlive = new Set<TSolid>();
  collectCheckpointObjects(newChain, stillAlive);
  if (nextFinal !== null) stillAlive.add(nextFinal);

  const doomed = new Set<TSolid>();
  collectCheckpointObjects(oldChain, doomed);
  if (previousFinal !== null) doomed.add(previousFinal);

  for (const shape of stillAlive) doomed.delete(shape);
  return doomed;
}
