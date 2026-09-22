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
