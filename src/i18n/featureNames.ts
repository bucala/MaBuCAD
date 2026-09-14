import { FEATURE_CATALOG } from "@/state/featureCatalog";
import type { Feature } from "@/types/document";

/**
 * Display names for the Feature Manager tree, translated at *render* time.
 *
 * A feature's `name` is persisted in the `.mabucad` file ("Front Plane", "Boss-Extrude1"),
 * and other code compares against those exact strings — `drawingCommands.ts` recognises an
 * unset material by `name !== "Material <not specified>"`, and `nextFeatureName` numbers a
 * new feature by scanning existing names. So the stored name has to stay English; only what
 * the user *sees* is localised, which is also what keeps a file created in Slovak openable
 * in English with identical semantics.
 *
 * Two cases are translatable:
 *
 * - **Default reference geometry** (`isDefault`): keyed by the feature's own stable id
 *   (`plane-front`, `origin`, …). These can never be renamed (the tree's F2/double-click
 *   and the property panel's name field are both disabled for them), so a plain id → key
 *   mapping is lossless.
 * - **Auto-generated names** of user features: `nextFeatureName` always produces exactly
 *   `${namePrefix}${counter}`, so a name that still matches that shape is generated rather
 *   than chosen, and its prefix can be swapped for the localised one ("Boss-Extrude1" →
 *   "Vytiahnutie1"). Anything else is a name the user typed and is shown verbatim — the one
 *   case that must never be touched.
 */

/** Default-feature id → translation key. Ids, not names: an id is what the document format
 * guarantees stable across versions (`createDefaultFeatures` in `documentStore.ts`). */
const DEFAULT_FEATURE_KEYS: Record<string, string> = {
  annotations: "featureName.annotations",
  material: "featureName.material",
  "plane-front": "featureName.plane-front",
  "plane-top": "featureName.plane-top",
  "plane-right": "featureName.plane-right",
  origin: "featureName.origin",
};

/** Splits an auto-generated `${prefix}${counter}` name. Returns `null` for a name the user
 * typed themselves (no trailing number, or a prefix that isn't this kind's own). */
function splitGeneratedName(feature: Feature): { prefix: string; counter: string } | null {
  const match = /^(.*?)(\d+)$/.exec(feature.name);
  if (!match) return null;
  const [, prefix, counter] = match;
  return prefix === FEATURE_CATALOG[feature.kind].namePrefix ? { prefix, counter } : null;
}

/**
 * The name to show for `feature` in the active language. `t` is `useTranslation()`'s own
 * translator, so English (and any language without a dictionary entry) returns the stored
 * name byte for byte.
 */
export function featureDisplayName(t: (key: string, englishText: string) => string, feature: Feature): string {
  if (feature.isDefault) {
    const key = DEFAULT_FEATURE_KEYS[feature.id];
    return key ? t(key, feature.name) : feature.name;
  }

  const generated = splitGeneratedName(feature);
  if (!generated) return feature.name;

  return `${t(`featurePrefix.${feature.kind}`, generated.prefix)}${generated.counter}`;
}
