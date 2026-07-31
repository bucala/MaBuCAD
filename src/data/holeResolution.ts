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
