import { useSettingsStore } from "@/state/settingsStore";

import type { Language } from "./languages";
import { sk } from "./translations";

const DICTIONARIES: Partial<Record<Language, Record<string, string>>> = { sk };

/**
 * `t(key, englishText)` returns the active language's string for `key`, or `englishText`
 * itself when there is no dictionary for the active language (English, or one of the
 * seven not translated yet) or the dictionary has no entry for that particular key —
 * so a partially-translated language degrades to English piece by piece rather than
 * showing a blank string or a raw key.
 */
export function useTranslation() {
  const language = useSettingsStore((state) => state.language);
  const dictionary = DICTIONARIES[language];

  const t = (key: string, englishText: string): string => dictionary?.[key] ?? englishText;

  return { t, language };
}

/** Fills `{{placeholder}}` tokens in a translated string. A dictionary value is a static
 * string, so the few dynamic sentences (counts, names, dimensions) carry placeholders the
 * render site fills — same convention the document tabs' close tooltip already used.
 * Unknown tokens pass through untouched, so a missing value shows as `{{count}}` in the
 * UI — loud and debuggable — rather than silently swallowing part of a sentence. */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}
