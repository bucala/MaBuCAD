import {
  CLEARANCE_STANDARDS,
  TAPPED_STANDARDS,
  type ClearanceFit,
  type ClearanceStandardId,
  type TappedSizeEntry,
  type TappedStandardId,
} from "./holeStandards";

/** One selectable row in the Hole Wizard's Size dropdown for a tapped hole. */
export interface TappedSizeGroup {
  sizeLabel: string;
  nominalSize: number;
  /** Every pitch/thread-class variant sharing this nominal size, sorted finest-first. */
  variants: TappedSizeEntry[];
}

/**
 * Groups a tapped-thread standard's flat entry list by nominal size, for a two-step
 * Size → Designation picker instead of one dropdown with 80-270 entries — the same shape
 * Inventor's own Hole Wizard uses, and the only way that many rows stays usable.
 */
export function groupTappedBySize(standardId: TappedStandardId): TappedSizeGroup[] {
  const standard = TAPPED_STANDARDS[standardId];
  const groups = new Map<string, TappedSizeGroup>();

  for (const entry of standard.entries) {
    const existing = groups.get(entry.sizeLabel);
    if (existing) {
      existing.variants.push(entry);
    } else {
      groups.set(entry.sizeLabel, { sizeLabel: entry.sizeLabel, nominalSize: entry.nominalSize, variants: [entry] });
    }
  }

  return [...groups.values()].sort((a, b) => a.nominalSize - b.nominalSize);
}

/**
 * The designation the Hole Wizard lands on when a hole first becomes tapped (or the
 * standard is switched), rather than the smallest row in the standard's table — which is
 * what "first entry" used to pick: an M1x0.25 watch-instrument thread for ISO metric, a
 * 1/16-27 NPT for pipe threads. M6 coarse is the everyday size most parts actually use
 * (and what Inventor's own Hole Wizard opens on); standards without an M6 row (ANSI
 * Unified, NPT) fall back to the middle of their range, the closest stand-in for "the
 * size a typical part uses" a thread table can offer.
 *
 * Each size group's first variant is the coarse pitch — the everyday thread — with the
 * finer pitches behind it in the dropdown for when the user deliberately wants one.
 */
export function defaultTappedDesignation(standardId: TappedStandardId): string {
  const groups = groupTappedBySize(standardId);
  const preferred = groups.find((group) => group.sizeLabel === "M6") ?? groups[Math.floor((groups.length - 1) / 2)];
  return preferred.variants[0].designation;
}

/** The tap drill diameter (mm) for one exact thread designation, or `undefined` if unknown. */
export function resolveTapDrill(standardId: TappedStandardId, designation: string): TappedSizeEntry | undefined {
  return TAPPED_STANDARDS[standardId].entries.find((entry) => entry.designation === designation);
}

/** The clearance-hole diameter (mm) for a nominal size and fit, or `undefined` if unknown. */
export function resolveClearanceDiameter(
  standardId: ClearanceStandardId,
  size: string,
  fit: ClearanceFit,
): number | undefined {
  return CLEARANCE_STANDARDS[standardId].sizes.find((entry) => entry.size === size)?.[fit];
}
