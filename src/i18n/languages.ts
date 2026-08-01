/**
 * Every language the switcher offers. Only `en` (the app's native strings, used
 * directly wherever a component calls `t(key, englishText)`) and `sk` have a real
 * dictionary behind them yet — see `sk.ts`'s own doc comment. The other seven are listed
 * up front, per the product decision to ship the switcher for all nine now and fill in
 * translations later one language at a time; picking one of them falls back to English
 * rather than showing a blank string or an error.
 */
export type Language = "en" | "sk" | "cs" | "de" | "fr" | "it" | "es" | "ru" | "zh";

export const DEFAULT_LANGUAGE: Language = "en";

/** Languages with a real translation dictionary (`translations.ts`) behind them. */
export const TRANSLATED_LANGUAGES: ReadonlySet<Language> = new Set(["sk"]);

export interface LanguageOption {
  id: Language;
  /** Name in the language's own script, as a native speaker would write it. */
  nativeName: string;
  /** English name, shown as a subtitle so a user who doesn't yet read the native
   * script can still find their language. */
  englishName: string;
}

export const LANGUAGES: LanguageOption[] = [
  { id: "en", nativeName: "English", englishName: "English" },
  { id: "sk", nativeName: "Slovenčina", englishName: "Slovak" },
  { id: "cs", nativeName: "Čeština", englishName: "Czech" },
  { id: "de", nativeName: "Deutsch", englishName: "German" },
  { id: "fr", nativeName: "Français", englishName: "French" },
  { id: "it", nativeName: "Italiano", englishName: "Italian" },
  { id: "es", nativeName: "Español", englishName: "Spanish" },
  { id: "ru", nativeName: "Русский", englishName: "Russian" },
  { id: "zh", nativeName: "中文", englishName: "Chinese" },
];
