/**
 * Canonical Slovak → English rewrites for section anchor ids.
 *
 * History: templates used to ship English anchor ids; a 2026-05 migration
 * rewrote everything to Slovak (`#contact` → `#kontakt`) for Slovak-only
 * clients. The product is now white-label / locale-agnostic, so the
 * templates were reverted to English ids (`id="home"`, `id="services"`,
 * …) and this map runs the OPPOSITE direction: it heals any saved site
 * whose nav/footer/CTA hrefs still carry the old Slovak slugs, converting
 * them back to the English id the template's section actually emits.
 *
 * Single source of truth for the rewrite — consumed by
 * `legacy-nav-overrides.ts`, which rewrites already-saved nav/footer/CTA
 * hrefs at composition-load time so existing customer sites converge on
 * English anchors (and the next autosave + publish persists them).
 *
 * The English targets MUST match the real section root ids in the
 * templates (see public/sample-templates/*.html): hero → `home`,
 * services → `services`, how-it-works → `process`, etc. Mapping a Slovak
 * slug to an id no template emits would leave a dangling nav link.
 */
export const SLOVAK_TO_ENGLISH_ANCHOR: Record<string, string> = {
  domov: "home",
  "o-nas": "about",
  sluzby: "services",
  galeria: "gallery",
  kontakt: "contact",
  otazky: "faq",
  recenzie: "reviews",
  referencie: "testimonials",
  vyzva: "cta",
  mapa: "map",
  paticka: "footer",
  postup: "process",
};

/** Convenience map keyed with leading `#` for href-rewriting passes. */
export const SLOVAK_TO_ENGLISH_HREF: Record<string, string> = Object.fromEntries(
  Object.entries(SLOVAK_TO_ENGLISH_ANCHOR).map(([sk, en]) => [`#${sk}`, `#${en}`]),
);
