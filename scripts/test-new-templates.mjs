/**
 * Smoke test for the new template variants:
 *   - testimonials-01 (NEW category)
 *   - testimonials-02 (NEW — slider variant)
 *   - contact-02
 *   - footer-02
 *   - cta-02       (editorial split band)
 *   - faq-02       (editorial split, sticky head + accordion repeater)
 *   - map-02       (editorial split, address card + contained map)
 *
 * Mirrors the publish-flow parser (SECTION marker + repeater pre-pass +
 * data-field walker). Prints the final field schema for each template.
 *
 * Run: node scripts/test-new-templates.mjs
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

function parseFieldsInScope($, $scope) {
  const schema = {};
  const order = [];
  $scope.find("[data-field]").each((_i, el) => {
    const $el = $(el);
    const key = $el.attr("data-field");
    if (!key || schema[key]) return;
    const tag = (el.type === "tag" ? el.tagName : "").toLowerCase();
    const explicitType = ($el.attr("data-type") || "").toLowerCase();
    order.push(key);

    if (explicitType === "link" && tag === "a") {
      schema[key] = { type: "link", default: $el.text().trim(), default_href: $el.attr("href") || "" };
      return;
    }
    // Map iframe: stores a plain address string; renderer rebuilds embed URL.
    if (explicitType === "map" && tag === "iframe") {
      let defaultAddress = "";
      try {
        defaultAddress = new URL($el.attr("src") || "", "https://maps.google.com")
          .searchParams.get("q") || "";
      } catch { defaultAddress = ""; }
      schema[key] = { type: "text", default: defaultAddress };
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
    const innerHtml = $el.html() || "";
    const isLong = text.length > 100 || /<br\s*\/?>/.test(innerHtml);
    schema[key] = { type: isLong ? "longtext" : "text", default: text };
  });
  return { schema, order };
}

function parseTemplate(input) {
  const m = input.match(SECTION_MARKER_RE);
  if (!m) return { error: "Missing SECTION marker" };
  const category = m[1].toLowerCase();
  const sectionHtml = m[2].trim();
  const $ = load(sectionHtml, { xmlMode: false });

  const schema = {};
  const order = [];
  const consumed = new Set();

  // Repeater pre-pass.
  $("[data-repeat]").each((_i, container) => {
    const $container = $(container);
    const key = $container.attr("data-repeat");
    if (!key || schema[key]) return;
    const children = $container.children().toArray();
    if (children.length === 0) return;

    $container.find("[data-field]").each((_j, descendant) => {
      consumed.add(descendant);
    });

    const itemSchema = parseFieldsInScope($, $(children[0])).schema;
    const min = parseInt($container.attr("data-min") || "1", 10);
    const max = parseInt($container.attr("data-max") || "10", 10);

    schema[key] = {
      type: "repeater",
      min,
      max,
      item_count: children.length,
      item_schema: itemSchema,
    };
    order.push(key);
  });

  // Flat walk for everything outside repeaters.
  $("[data-field]").each((_i, el) => {
    if (consumed.has(el)) return;
    const $el = $(el);
    const key = $el.attr("data-field");
    if (!key || schema[key]) return;
    const tag = (el.type === "tag" ? el.tagName : "").toLowerCase();
    const explicitType = ($el.attr("data-type") || "").toLowerCase();
    order.push(key);

    if (explicitType === "link" && tag === "a") {
      schema[key] = { type: "link", default: $el.text().trim(), default_href: $el.attr("href") || "" };
      return;
    }
    if (explicitType === "map" && tag === "iframe") {
      let defaultAddress = "";
      try {
        defaultAddress = new URL($el.attr("src") || "", "https://maps.google.com")
          .searchParams.get("q") || "";
      } catch { defaultAddress = ""; }
      schema[key] = { type: "text", default: defaultAddress };
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
    const innerHtml = $el.html() || "";
    const isLong = text.length > 100 || /<br\s*\/?>/.test(innerHtml);
    schema[key] = { type: isLong ? "longtext" : "text", default: text };
  });

  return { category, schema, order };
}

const templates = [
  {
    name: "testimonials-01",
    expectedCategory: "testimonials",
    expected: {
      testimonials_eyebrow: "text",
      testimonials_heading: "text",
      testimonials_subheadline: ["text", "longtext"],
      testimonials: "repeater",
    },
    repeaterItemFields: ["quote", "author_name", "author_role"],
    expectedRepeaterDefaults: 3,
  },
  {
    name: "contact-02",
    expectedCategory: "contact",
    expected: {
      contact_eyebrow: "text",
      contact_headline: "text",
      contact_intro: ["text", "longtext"],
      contact_phone: "link",
      contact_email: "link",
      contact_address_street: "text",
      contact_address_city: "text",
      contact_hours: "text",
      contact_form_submit: "text",
    },
  },
  {
    name: "footer-02",
    expectedCategory: "footer",
    expected: {
      footer_copyright: "text",
      footer_links: "repeater",
    },
    repeaterItemFields: ["link"],
    expectedRepeaterDefaults: 3,
  },
  {
    name: "testimonials-02",
    expectedCategory: "testimonials",
    expected: {
      ts2_eyebrow: "text",
      ts2_heading: "text",
      testimonials: "repeater",
    },
    repeaterItemFields: ["quote", "author_name", "author_role"],
    expectedRepeaterDefaults: 3,
  },
  {
    name: "cta-02",
    expectedCategory: "cta",
    expected: {
      cta2_eyebrow: "text",
      cta2_headline: "text",
      cta2_sub: ["text", "longtext"],
      cta2_button: "link",
    },
  },
  {
    name: "faq-02",
    expectedCategory: "faq",
    expected: {
      faq2_eyebrow: "text",
      faq2_headline: "text",
      faq2_intro: ["text", "longtext"],
      faq2_contact_link: "link",
      faq_items: "repeater",
    },
    repeaterItemFields: ["question", "answer"],
    expectedRepeaterDefaults: 5,
  },
  {
    name: "map-02",
    expectedCategory: "map",
    expected: {
      map2_eyebrow: "text",
      map2_heading: "text",
      map2_address_street: "text",
      map2_address_city: "text",
      map2_hours: "text",
      map2_directions_link: "link",
      map2_address: "text", // iframe with data-type="map" → text per parser
    },
  },
];

let failed = 0;
for (const tpl of templates) {
  const file = path.join(__dirname, "..", "public", "sample-templates", `${tpl.name}.html`);
  const html = await fs.readFile(file, "utf8");
  const parsed = parseTemplate(html);

  console.log(`\n── ${tpl.name} ──`);
  if (parsed.error) {
    console.error(`  ✗ ${parsed.error}`);
    failed++;
    continue;
  }
  if (parsed.category !== tpl.expectedCategory) {
    console.error(`  ✗ Category should be "${tpl.expectedCategory}", got "${parsed.category}"`);
    failed++;
    continue;
  }
  console.log(`  Category: ${parsed.category}  ✓`);
  console.log(`  Top-level fields: ${parsed.order.length}`);

  let allMatch = true;
  for (const [field, expected] of Object.entries(tpl.expected)) {
    const got = parsed.schema[field]?.type;
    const expectedTypes = Array.isArray(expected) ? expected : [expected];
    const ok = got && expectedTypes.includes(got);
    const marker = ok ? "✓" : "✗";
    console.log(`    ${marker} ${field}: ${got ?? "MISSING"} (expected: ${expectedTypes.join("|")})`);
    if (!ok) allMatch = false;
  }

  if (tpl.repeaterItemFields) {
    const repKey = Object.entries(tpl.expected).find(([, v]) => v === "repeater")?.[0];
    const rep = parsed.schema[repKey];
    if (rep?.type === "repeater") {
      console.log(`    Repeater "${repKey}": min=${rep.min} max=${rep.max} default_count=${rep.item_count}`);
      if (rep.item_count !== tpl.expectedRepeaterDefaults) {
        console.error(`      ✗ Expected ${tpl.expectedRepeaterDefaults} default items, got ${rep.item_count}`);
        allMatch = false;
      }
      for (const k of tpl.repeaterItemFields) {
        const itemType = rep.item_schema[k]?.type;
        if (!itemType) {
          console.error(`      ✗ item missing field "${k}"`);
          allMatch = false;
        } else {
          console.log(`      ✓ item.${k}: ${itemType}`);
        }
      }
    }
  }

  if (!allMatch) failed++;
}

console.log(`\n${failed === 0 ? "✓ All new templates parsed correctly." : `✗ ${failed} template(s) failed validation.`}`);
process.exit(failed === 0 ? 0 : 1);
