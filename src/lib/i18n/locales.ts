/**
 * Locale constants + i18n types — a leaf module with ZERO node/server
 * dependencies, so it's safe to import from client components (the
 * Languages panel, composer-client) as well as the server renderer.
 *
 * These used to live in render.ts, but render.ts imports `fs` (reads
 * template-base.css), which breaks the moment a client component imports
 * a runtime VALUE from it (LOCALE_LABELS etc.). render.ts now re-exports
 * everything here for backwards-compat, so server-side importers are
 * unaffected.
 */

/** Content locales the platform supports. The site's DEFAULT locale is
 *  whichever language its original content was built in — NOT hardcoded to
 *  any one of these. Stored per-site in `SiteI18n.default_locale`. */
export type SiteLocale = "en" | "cs" | "pl" | "de" | "sk";

export const SUPPORTED_LOCALES: readonly SiteLocale[] = [
  "en",
  "cs",
  "pl",
  "de",
  "sk",
];

/** Full language name for menus / settings — each in its OWN language
 *  (endonym), matching how language pickers conventionally read. */
export const LOCALE_LABELS: Record<SiteLocale, string> = {
  en: "English",
  cs: "Čeština",
  pl: "Polski",
  de: "Deutsch",
  sk: "Slovenčina",
};

/** Short code for the navbar language switcher chip. */
export const LOCALE_SHORT: Record<SiteLocale, string> = {
  en: "EN",
  cs: "CS",
  pl: "PL",
  de: "DE",
  sk: "SK",
};

/** `<html lang="…">` value per locale. */
export const LOCALE_HTML_LANG: Record<SiteLocale, string> = {
  en: "en",
  cs: "cs",
  pl: "pl",
  de: "de",
  sk: "sk",
};

/** One translated field value. Structurally identical to the composer's
 *  `RoundtripValue` (json-roundtrip.ts) — defined here rather than imported
 *  to avoid a circular dependency. TypeScript's structural typing makes a
 *  `RoundtripSnapshot` assignable to `LocaleTranslationSnapshot` and
 *  vice-versa, so a validated import snapshot drops straight into
 *  `i18n.translations[locale]`. */
export type LocaleValue =
  | string
  | { label?: string }
  | Array<Record<string, string | { label?: string }>>;

/** A full translation snapshot for one locale: sectionId → fieldKey → value.
 *  Same shape `buildExportSnapshot` emits, including the virtual sections
 *  `__seo`, `__nav`, `__footer`. */
export type LocaleTranslationSnapshot = Record<
  string,
  Record<string, LocaleValue>
>;

export interface SiteI18n {
  /** The site's main language — whichever the original content is written
   *  in. Its content lives in the base composition and renders at the site
   *  root ("/"). */
  default_locale: SiteLocale;
  /** Every locale the site serves, INCLUDING the default. The default
   *  renders at "/", every other locale under "/<locale>/". Order is the
   *  display order in the navbar switcher. */
  enabled_locales: SiteLocale[];
  /** Per-locale translation snapshots, keyed by locale code. The default
   *  locale has NO entry (its content IS the base composition). A
   *  non-default locale only appears here once its translation has been
   *  imported — until then it must not be published (no-fallback rule). */
  translations?: Partial<Record<SiteLocale, LocaleTranslationSnapshot>>;
}
