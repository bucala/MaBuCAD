import type { DrawingSourceStamp } from "@/types/document";

/**
 * Answers "are this drawing's views still current?" from the two stamps that can answer
 * it: the stamp captured when the views were last projected (`projectedAt`,
 * `DrawingSheetData.sourceStamp`) and a fresh stat of the referenced part file
 * (`onDiskNow` — null when it couldn't be stat'd, e.g. an unblessed path or the browser
 * build). Anything unverifiable — a drawing saved before stamps existed, a path the
 * session can't stat — reads as *not stale*: the Update Views indicator must never cry
 * wolf, only ever point at a change it can actually prove.
 */
export function viewsAreStale(
  projectedAt: DrawingSourceStamp | undefined,
  onDiskNow: DrawingSourceStamp | null,
): boolean {
  if (!projectedAt || !onDiskNow) return false;
  return projectedAt.modifiedMs !== onDiskNow.modifiedMs || projectedAt.size !== onDiskNow.size;
}

/**
 * Whether the cached views were projected from exactly the bytes now on disk — i.e. whether
 * re-projecting would be provably wasted work.
 *
 * Where `viewsAreStale` guesses cheaply from a stat (so the indicator can run on every
 * window focus), this decides exactly, from the content hash of the file Update Views has
 * already read. Equal hashes mean the same part document, so the same rebuild and the same
 * projection: the existing cache *is* the answer, and the rebuild can be skipped.
 *
 * A missing stored hash (a drawing saved before the hash existed) is never treated as a
 * match — an unknown provenance re-projects, because the only safe default is to do the
 * work rather than to claim views are current without evidence.
 */
export function viewsMatchSource(projectedFromHash: string | undefined, onDiskHash: string): boolean {
  return projectedFromHash !== undefined && projectedFromHash === onDiskHash;
}
