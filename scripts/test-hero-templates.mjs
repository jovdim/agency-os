/**
 * Smoke test for hero templates. Parses each hero-XX.html through the
 * same SECTION-marker + data-field walker the publish flow uses, then
 * asserts the schema has the expected fields with correct types.
 *
 * Run: node scripts/test-hero-templates.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SECTION_MARKER_RE =
  /<!--\s*SECTION:([a-zA-Z0-9_-]+):start\s*-->([\s\S]*?)<!--\s*SECTION:\1:end\s*-->/i;
const BG_IMAGE_RE = /background-image:\s*url\(\s*['"]?([^'")]+?)['"]?\s*\)/i;

function parseTemplate(input) {
  const m = input.match(SECTION_MARKER_RE);
  if (!m) return { error: "Missing SECTION marker" };
  const category = m[1].toLowerCase();
  const sectionHtml = m[2].trim();
  const $ = load(sectionHtml, { xmlMode: false });

  const schema = {};
  const order = [];
  $("[data-field]").each((_i, el) => {
    const $el = $(el);
    const key = $el.attr("data-field");
    if (!key || schema[key]) return;
    const tag = (el.type === "tag" ? el.tagName : "").toLowerCase();
    const explicitType = ($el.attr("data-type") || "").toLowerCase();
    order.push(key);

    if (explicitType === "link" && tag === "a") {
      schema[key] = {
        type: "link",
        default: $el.text().trim(),
        default_href: $el.attr("href") || "",
      };
      return;
    }
    if (tag === "img" || tag === "iframe") {
      schema[key] = { type: "image", default_src: $el.attr("src") || undefined };
      return;
    }
    const style = $el.attr("style") || "";
    const bg = style.match(BG_IMAGE_RE);
    if (bg) {
      schema[key] = { type: "image", default_src: bg[1] };
      return;
    }
    const text = $el.text().trim();
    const isLong = text.length > 100;
    schema[key] = { type: isLong ? "longtext" : "text", default: text };
  });

  return { category, schema, order, sectionHtml };
}

const heroes = [
  // hero-01: centered hero with full-bleed background image (was hero-02
  // before the 2026-05-09 renumber).
  {
    name: "hero-01",
    expected: {
      hero_bg: "image",
      hero_headline: "text",
      hero_subheadline: ["text", "longtext"],
      hero_cta_primary: "link",
      hero_cta_secondary: "link",
    },
  },
  // hero-02: editorial split — text left (with 2 CTA buttons),
  // asymmetric 3-photo collage right. (Single image → collage AND
  // single text-link CTA → 2 buttons, both shipped 2026-05-09.)
  {
    name: "hero-02",
    expected: {
      hero_eyebrow: "text",
      hero_headline: "text",
      hero_subheadline: ["text", "longtext"],
      hero_cta_primary: "link",
      hero_cta_secondary: "link",
      hero_image_main: "image",
      hero_image_top: "image",
      hero_image_bottom: "image",
    },
  },
  // hero-03: cinematic full-bleed with bottom-left text + 2 CTA buttons.
  // (Was hero-06 before the 2026-05-09 renumber; switched from single
  // text-link CTA to two buttons in the same session.)
  {
    name: "hero-03",
    expected: {
      hero_bg: "image",
      hero_eyebrow: "text",
      hero_headline: "text",
      hero_subheadline: ["text", "longtext"],
      hero_cta_primary: "link",
      hero_cta_secondary: "link",
    },
  },
  // hero-04: centered cinematic + thin info strip below CTAs (3 short
  // text fields separated by · dividers — caption-style, not stats).
  // min-height: 100vh on both desktop and mobile to match hero-01.
  // (Originally shipped as hero-05 on 2026-05-11; renamed to hero-04
  // and the vh fix applied later the same day after Peter flagged the
  // hero looked SHORT — hero-06 was deleted in the same cleanup.)
  {
    name: "hero-04",
    expected: {
      hero_bg: "image",
      hero_eyebrow: "text",
      hero_headline: "text",
      hero_subheadline: ["text", "longtext"],
      hero_cta_primary: "link",
      hero_cta_secondary: "link",
      hero_strip_1: "text",
      hero_strip_2: "text",
      hero_strip_3: "text",
    },
  },
];

let failed = 0;
for (const tpl of heroes) {
  const file = path.join(
    __dirname,
    "..",
    "public",
    "sample-templates",
    `${tpl.name}.html`,
  );
  const html = await fs.readFile(file, "utf8");
  const parsed = parseTemplate(html);

  console.log(`\n── ${tpl.name} ──`);
  if (parsed.error) {
    console.error(`  ✗ ${parsed.error}`);
    failed++;
    continue;
  }
  if (parsed.category !== "hero") {
    console.error(`  ✗ Category should be "hero", got "${parsed.category}"`);
    failed++;
    continue;
  }
  console.log(`  Category: ${parsed.category}  ✓`);
  console.log(`  Fields:   ${parsed.order.length}`);

  let allMatch = true;
  for (const [field, expected] of Object.entries(tpl.expected)) {
    const got = parsed.schema[field]?.type;
    const expectedTypes = Array.isArray(expected) ? expected : [expected];
    const ok = got && expectedTypes.includes(got);
    const marker = ok ? "✓" : "✗";
    console.log(
      `    ${marker} ${field}: ${got ?? "MISSING"} (expected: ${expectedTypes.join("|")})`,
    );
    if (!ok) allMatch = false;
  }

  // Catch the most common authoring slip: <a> without data-type="link"
  // ending up as a "text" field that strips the href.
  const linkLeaks = parsed.order.filter((k) => {
    const s = parsed.schema[k];
    return (
      (k.includes("cta") || k.includes("link")) &&
      s.type !== "link"
    );
  });
  if (linkLeaks.length > 0) {
    console.error(
      `  ✗ Suspected link fields parsed as ${linkLeaks
        .map((k) => `${k}:${parsed.schema[k].type}`)
        .join(", ")} — missing data-type="link"?`,
    );
    allMatch = false;
  }

  if (!allMatch) failed++;
}

console.log(
  `\n${failed === 0 ? "✓ All hero templates parsed correctly." : `✗ ${failed} template(s) failed validation.`}`,
);
process.exit(failed === 0 ? 0 : 1);
