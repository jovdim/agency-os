// @ts-check
/**
 * One-shot migration: rewrite English section anchor ids + default
 * link hrefs in every template HTML to Slovak slugs.
 *
 * Run once with `node scripts/slovakize-anchors.mjs`. After it succeeds
 * the modified templates still need to be pushed to Supabase Storage
 * via `npx tsx scripts/push-template.ts <name>` for each (or the bulk
 * loop in the same shell session). The script is idempotent — re-running
 * is a no-op once everything is Slovak.
 *
 * What it changes per file:
 *   1. The section root id attribute. The mapping is global for the
 *      common cases (contact, gallery, services, hero, about, faq,
 *      reviews, testimonials, cta, map, footer) and per-file for the
 *      two oddballs that historically carried a non-category id
 *      (services-06 with `id="how-it-works"`, services-07 with
 *      `id="equipment"` — both should match their services category).
 *   2. Every default `href="#<english>"` in the file — covers hero
 *      CTAs, footer link lists, nav menus, in-section "kontaktujte
 *      nás" anchors. Slug-by-slug substitution using the same map as
 *      legacy-nav-overrides.ts so the autocomplete + the saved
 *      compositions converge on identical strings.
 *
 * What it does NOT touch:
 *   - Inner-element ids (e.g. `id="footer__cta"`) that aren't anchor
 *     targets. Those don't appear in nav hrefs.
 *   - Per-item rendered ids — those are derived from item titles at
 *     render time, already Slovak when the title is Slovak.
 *   - CSS class names. The class "services-01" stays English; it's
 *     internal styling, never user-facing.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(HERE, "..", "public", "sample-templates");

// Global English → Slovak map for ids + hrefs. Matches
// src/lib/composer/slovak-anchor-map.ts exactly — keep them in lockstep.
const GLOBAL_ID_MAP = {
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
  "how-it-works": "postup",
};

// Per-file overrides — when a template's section root id wasn't already
// in the global map (because the template author used a context-specific
// label). These rewrite the section root id ONLY; href substitutions
// still go through GLOBAL_ID_MAP (the saved navs reference the slug
// users actually see in the URL, not the variant-specific original).
const PER_FILE_ROOT_ID = {
  "services-06.html": { from: "how-it-works", to: "sluzby" },
  "services-07.html": { from: "equipment", to: "sluzby" },
};

async function main() {
  const files = (await readdir(TEMPLATES_DIR)).filter((f) => f.endsWith(".html"));
  let touched = 0;
  for (const file of files) {
    const path = join(TEMPLATES_DIR, file);
    const original = await readFile(path, "utf8");
    let next = original;

    // ── 1. Section root id ──
    // First handle per-file overrides; they only run when the file's
    // id matches the override's `from`. Otherwise the global map's
    // `<section id="services"…>` → `<section id="sluzby"…>` style
    // substitution kicks in. Both use a strict attribute regex so we
    // never touch `id="something-services"` in the middle of a word.
    const perFile = PER_FILE_ROOT_ID[file];
    if (perFile) {
      next = next.replace(
        new RegExp(`(<[^>]+\\bid=")${escapeRegex(perFile.from)}(")`, "g"),
        `$1${perFile.to}$2`,
      );
    }

    for (const [en, sk] of Object.entries(GLOBAL_ID_MAP)) {
      // Skip ids the per-file override already retargeted (we don't
      // want to rewrite an id we just wrote).
      if (perFile && perFile.to === en) continue;
      next = next.replace(
        new RegExp(`(<[^>]+\\bid=")${escapeRegex(en)}(")`, "g"),
        `$1${sk}$2`,
      );
    }

    // ── 2. Default link hrefs ──
    // `href="#en"` → `href="#sk"`. Closed by `"` so we don't accidentally
    // touch `href="#englishthing"` where the slug is a prefix of a longer
    // word (e.g. `#services-grid`).
    for (const [en, sk] of Object.entries(GLOBAL_ID_MAP)) {
      next = next.replace(
        new RegExp(`href="#${escapeRegex(en)}"`, "g"),
        `href="#${sk}"`,
      );
    }

    if (next !== original) {
      await writeFile(path, next, "utf8");
      console.log(`✓ ${file}`);
      touched++;
    }
  }
  console.log(`\nDone. ${touched} file${touched === 1 ? "" : "s"} touched.`);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
