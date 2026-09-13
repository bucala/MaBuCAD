import { describe, expect, it } from "vitest";

import { RIBBON_TABS } from "@/commands/ribbonConfig";
import { FEATURE_CATALOG } from "@/state/featureCatalog";

import { sk } from "./translations";

/**
 * The Slovak dictionary is the only fully-translated language, so it doubles as the
 * completeness contract for the surfaces the translation work committed to covering:
 * every ribbon tab, group, command label *and hover tooltip*, and every feature-catalog
 * description the property panel shows. A new command that forgets its dictionary
 * entries fails here rather than silently degrading to English for Slovak users — the
 * runtime itself is designed to degrade gracefully, so the gap would otherwise never
 * surface anywhere but in the UI.
 */
describe("Slovak translation coverage", () => {
  it("covers every ribbon tab, group, command label and hover tooltip", () => {
    const missing: string[] = [];
    for (const tab of RIBBON_TABS) {
      if (!(tab.id in sk)) missing.push(`tab label "${tab.id}"`);
      for (const group of tab.groups) {
        if (!(group.id in sk)) missing.push(`group label "${group.id}"`);
        for (const item of group.items) {
          if (!(item.id in sk)) missing.push(`command label "${item.id}"`);
          if (item.description && !(`${item.id}.description` in sk)) {
            missing.push(`command tooltip "${item.id}.description"`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("covers every feature-catalog description the property panel shows", () => {
    const missing = Object.keys(FEATURE_CATALOG)
      .filter((kind) => !(`featureCatalog.${kind}` in sk))
      .map((kind) => `featureCatalog.${kind}`);
    expect(missing).toEqual([]);
  });

  it("keeps every {{placeholder}} balanced — fillTemplate cannot repair a broken token", () => {
    // A dictionary value is a static string; the render sites fill {{tokens}} via
    // `fillTemplate`, and an unknown token passes through untouched — so a value with an
    // unclosed "{{" would render with raw braces in the UI instead of a number or name.
    for (const [key, value] of Object.entries(sk)) {
      const opens = value.split("{{").length - 1;
      const closes = value.split("}}").length - 1;
      if (opens !== closes) expect.fail(`key "${key}" has unbalanced {{ }} placeholders`);
    }
  });
});
