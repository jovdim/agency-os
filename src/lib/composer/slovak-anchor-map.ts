/**
 * Canonical English → Slovak rewrites for section anchor ids.
 *
 * Slovak clients see anchor ids in the URL bar after clicking nav/footer
 * links (`mojweb.sk/#contact`). Templates used to ship with English
 * defaults, which looked unprofessional on Slovak sites. This map is the
 * single source of truth for the rewrite — consumed by:
 *
 *   • the template-migration script (`scripts/slovakize-anchors.mjs`)
 *     that rewrote each template's section root id + default hrefs.
 *   • the composer migration shim (`legacy-nav-overrides.ts`) that
 *     rewrites already-saved nav/footer dropdown hrefs at load time so
 *     existing customer sites don't break.
 *
 * Adding new mappings here is safe — both consumers re-read it on next
 * load. Removing one without coordinating is NOT — any site whose saved
 * nav still references the old English id would silently break.
 */
export const ENGLISH_TO_SLOVAK_ANCHOR: Record<string, string> = {
  contact: "kontakt",
  gallery: "galeria",
  services: "sluzby",
  hero: "domov",
  home: "domov",
  about: "o-nas",
  faq: "otazky",
  reviews: "recenzie",
  testimonials: "referencie",
  cta: "vyzva",
  map: "mapa",
  footer: "paticka",
  // `how-it-works` collapses to `postup` (the process-page template
  // owns this slug). Two services-category variants (services-06,
  // services-07) historically shipped with `id="how-it-works"` and
  // `id="equipment"` respectively — those are fixed in the templates
  // themselves to `id="sluzby"` so they match their category. After
  // the template migration, only `how-it-works-01` keeps emitting
  // `#how-it-works` if any existing site still has it saved.
  "how-it-works": "postup",
};

/** Convenience map keyed with leading `#` for href-rewriting passes. */
export const ENGLISH_TO_SLOVAK_HREF: Record<string, string> = Object.fromEntries(
  Object.entries(ENGLISH_TO_SLOVAK_ANCHOR).map(([en, sk]) => [`#${en}`, `#${sk}`]),
);
