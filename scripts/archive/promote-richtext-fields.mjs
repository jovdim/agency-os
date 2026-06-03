/**
 * Promote long-paragraph fields to data-type="richtext" across templates.
 *
 * Scope (2026-05-12): description / subtitle / intro / answer / body fields
 * that hold prose-style content where bold/italic/underline formatting adds
 * value. Skips titles, eyebrows, labels, phones, addresses (data-type stays
 * implicit text).
 *
 * Strategy: regex-replace by data-field key. Idempotent — won't double-add
 * data-type if already present. Keeps element type (<p> stays <p>, <div>
 * stays <div>) per "minimal HTML change" decision.
 *
 * Usage: node scripts/promote-richtext-fields.mjs
 * Then push each touched template via: npx tsx scripts/push-template.ts <name>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "public", "sample-templates");

// per-template: list of data-field keys to promote
const PLAN = {
  "services-01": ["services_subheadline", "description"],
  "services-02": ["services_subheadline", "description"],
  "services-03": ["services_body", "description"],
  "services-04": ["services_body", "description"],
  "services-05": ["services_body", "description"],
  "hero-01":     ["hero_subheadline"],
  "hero-02":     ["hero_subheadline"],
  "hero-03":     ["hero_subheadline"],
  "hero-04":     ["hero_subheadline"],
  "faq-01":      ["faq_1_answer", "faq_2_answer", "faq_3_answer", "faq_4_answer", "faq_5_answer"],
  "faq-02":      ["faq2_intro", "answer"],
  "faq-03":      ["answer"],
  "faq-04":      ["answer"],
  "faq-05":      ["answer"],
  "cta-01":      ["cta_text"],
  "cta-02":      ["cta2_sub"],
  "cta-04":      ["cta_text"],
  "cta-05":      ["cta_text"],
  "contact-01":  ["contact_text"],
  "contact-02":  ["contact_intro"],
  "contact-03":  ["contact_intro"],
  "contact-04":  ["contact_intro"],
  "contact-05":  ["contact_intro"],
  "reviews-01":  ["reviews_1_text", "reviews_2_text", "reviews_3_text"],
  "reviews-02":  ["text"],
  "reviews-03":  ["text"],
  "reviews-04":  ["text"],
  "reviews-05":  ["text"],
  "testimonials-01": ["testimonials_subheadline", "quote"],
  "testimonials-02": ["quote"],
  "about-04":    ["about_body", "description"],
  "about-05":    ["about_body", "description"],
};

let touched = 0;

for (const [name, fields] of Object.entries(PLAN)) {
  const path = join(ROOT, `${name}.html`);
  let html = readFileSync(path, "utf8");
  let changed = 0;
  for (const fieldKey of fields) {
    // Match any tag with data-field="<fieldKey>" that does NOT already have
    // data-type="richtext". Inject data-type immediately after the data-field
    // attribute. Negative lookahead skips already-promoted elements.
    const re = new RegExp(
      `(<[a-z][a-z0-9-]*\\b[^>]*?data-field="${escapeRegex(fieldKey)}")` +
      `(?![^>]*\\bdata-type="richtext")` +
      `([^>]*>)`,
      "g",
    );
    const before = html;
    html = html.replace(re, (match, lead, tail) => {
      // If the element already has any data-type, skip (don't override).
      if (/\bdata-type="[^"]*"/.test(match)) return match;
      return `${lead} data-type="richtext"${tail}`;
    });
    if (html !== before) {
      const matches = before.match(re);
      if (matches) changed += matches.length;
    }
  }
  if (changed > 0) {
    writeFileSync(path, html, "utf8");
    console.log(`✓ ${name}.html — promoted ${changed} field(s)`);
    touched++;
  } else {
    console.log(`· ${name}.html — already up to date`);
  }
}

console.log(`\nDone. ${touched} template(s) modified.`);
console.log(`\nNext: push each touched template:`);
for (const name of Object.keys(PLAN)) {
  console.log(`  npx tsx scripts/push-template.ts ${name}`);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
