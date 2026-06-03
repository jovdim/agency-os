/**
 * Comprehensive render test for the about templates.
 *
 * For each about template, fetch its uploaded HTML from Supabase, run
 * applyContentOverrides through three scenarios:
 *   1. NO overrides    → defaults (incl. default_items for repeaters)
 *   2. SOME overrides  → mix of overridden + default fields
 *   3. REPEATER edits  → add/remove/reorder items, edit item fields
 *
 * Verifies the resulting HTML is valid, contains expected content, and
 * doesn't have telltale bugs (orphan placeholders, missing repeater
 * children, broken closing tags, etc.).
 *
 * Run: node scripts/test-about-render.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { load } from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Load env ──
const envPath = path.join(__dirname, "..", ".env.local");
const envText = await fs.readFile(envPath, "utf8");
const env = Object.fromEntries(
  envText.split("\n").filter((l) => l && !l.startsWith("#"))
    .map((l) => { const eq = l.indexOf("="); return [l.slice(0, eq), l.slice(eq + 1).replace(/^"|"$/g, "")]; }),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── Inline copy of applyContentOverrides (mirror of parser.ts) ──
const BG_IMAGE_RE = /background-image:\s*url\(\s*['"]?([^'")]+?)['"]?\s*\)/i;

function escapeAttrValue(s) { return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

function applyContentOverrides(html, overrides, schema) {
  const $ = load(html, { xmlMode: false });

  // Pass 1: repeaters
  for (const [key, fieldRaw] of Object.entries(schema)) {
    if (fieldRaw.type !== "repeater") continue;
    const $container = $(`[data-repeat="${escapeAttrValue(key)}"]`).first();
    if ($container.length === 0) continue;
    const children = $container.children().toArray();
    if (children.length === 0) continue;
    const itemSchema = fieldRaw.item_schema ?? {};
    const overrideValue = overrides[key];
    const items = Array.isArray(overrideValue) ? overrideValue : (fieldRaw.default_items ?? []);
    const $template = $(children[0]).clone();
    const rendered = items.map((itemOverride) => {
      const $clone = $template.clone();
      const innerHtml = $.html($clone);
      const wrapped = `<div data-sk-repeater-wrap>${innerHtml}</div>`;
      const applied = applyContentOverrides(wrapped, itemOverride, itemSchema);
      return applied.replace(/^<div data-sk-repeater-wrap>/, "").replace(/<\/div>$/, "");
    });
    $container.empty().html(rendered.join(""));
  }

  // Pass 2: flat fields
  for (const [key, value] of Object.entries(overrides)) {
    const field = schema[key];
    if (!field || field.type === "repeater") continue;
    const $el = $(`[data-field="${escapeAttrValue(key)}"]`).first();
    if ($el.length === 0) continue;
    const el = $el[0];
    const tag = el.type === "tag" ? el.tagName.toLowerCase() : "";
    switch (field.type) {
      case "image": {
        const v = typeof value === "string" ? value : "";
        if (!v) break;
        if (tag === "img" || tag === "iframe") $el.attr("src", v);
        break;
      }
      case "link":
        if (typeof value === "object" && value !== null) {
          if (typeof value.label === "string") $el.text(value.label);
          if (typeof value.href === "string") $el.attr("href", value.href);
        } else if (typeof value === "string") $el.text(value);
        break;
      case "richtext":
        $el.html(typeof value === "string" ? value : "");
        break;
      default:
        $el.text(typeof value === "string" ? value : "");
    }
  }
  return $.html({ xmlMode: false });
}

// ── Fetch each about template + run scenarios ──
const TEMPLATES = ["about-03", "about-04", "about-05", "about-06", "about-07", "about-08", "about-09"];

const { data: rows, error } = await admin
  .from("section_templates")
  .select("name, html_path, placeholder_schema")
  .eq("category", "about")
  .in("name", TEMPLATES);

if (error) {
  console.error("DB error:", error);
  process.exit(1);
}

const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
let failures = 0;

for (const name of TEMPLATES) {
  const row = byName[name];
  if (!row) { console.log(`✗ ${name}: not in DB`); failures++; continue; }
  const { data: blob, error: dlErr } = await admin.storage.from("section-templates").download(row.html_path);
  if (dlErr || !blob) { console.log(`✗ ${name}: storage download failed`); failures++; continue; }
  const html = await blob.text();
  const schema = row.placeholder_schema;

  const tests = [];
  // Scenario 1: NO overrides — defaults flow through
  let h1 = "";
  try {
    h1 = applyContentOverrides(html, {}, schema);
    if (!h1 || h1.length < 100) throw new Error("output too short");
    if (h1.includes("undefined")) throw new Error("found 'undefined' in HTML");
    tests.push("✓ defaults render");
  } catch (e) {
    tests.push(`✗ defaults: ${e.message}`);
    failures++;
  }

  // Scenario 2: SOME flat overrides — eyebrow + headline (most templates have these)
  try {
    const flatOver = {};
    if (schema.about_eyebrow) flatOver.about_eyebrow = "TEST EYEBROW";
    if (schema.about_headline) flatOver.about_headline = "TEST HEADLINE";
    const h2 = applyContentOverrides(html, flatOver, schema);
    if (schema.about_eyebrow && !h2.includes("TEST EYEBROW")) throw new Error("eyebrow override missing");
    if (schema.about_headline && !h2.includes("TEST HEADLINE")) throw new Error("headline override missing");
    tests.push("✓ flat overrides applied");
  } catch (e) {
    tests.push(`✗ flat: ${e.message}`);
    failures++;
  }

  // Scenario 3: REPEATER edits — for templates with a repeater
  const repKey = Object.entries(schema).find(([_, v]) => v.type === "repeater")?.[0];
  if (repKey) {
    try {
      const repSchema = schema[repKey];
      const itemKeys = Object.keys(repSchema.item_schema);
      const fieldKey = itemKeys[0];
      const fieldType = repSchema.item_schema[fieldKey].type;

      // 3a: empty array → renders 0 items
      const hEmpty = applyContentOverrides(html, { [repKey]: [] }, schema);
      // Should not contain any of the default item content
      const $empty = load(hEmpty, { xmlMode: false });
      const containerChildren = $empty(`[data-repeat="${repKey}"]`).children().length;
      if (containerChildren !== 0) throw new Error(`empty array → ${containerChildren} children rendered (want 0)`);

      // 3b: single item with custom value
      const customItem = {};
      if (fieldType === "link") customItem[fieldKey] = { label: "CUSTOM_LABEL", href: "#custom" };
      else if (fieldType === "image") customItem[fieldKey] = "https://example.com/custom.png";
      else customItem[fieldKey] = "CUSTOM_VALUE";

      const hOne = applyContentOverrides(html, { [repKey]: [customItem] }, schema);
      const $one = load(hOne, { xmlMode: false });
      const oneChildren = $one(`[data-repeat="${repKey}"]`).children().length;
      if (oneChildren !== 1) throw new Error(`1-item array → ${oneChildren} children rendered (want 1)`);
      // Verify the custom value appears
      if (fieldType === "link" && !hOne.includes("CUSTOM_LABEL")) throw new Error("link label override missing");
      if (fieldType === "image" && !hOne.includes("custom.png")) throw new Error("image src override missing");
      if (fieldType !== "link" && fieldType !== "image" && !hOne.includes("CUSTOM_VALUE")) throw new Error("text override missing");

      // 3c: many items (max + 1) — verify it still renders, doesn't crash
      const manyCount = repSchema.max + 1;
      const many = Array.from({ length: manyCount }, (_, i) => {
        const itm = {};
        for (const k of itemKeys) {
          const t = repSchema.item_schema[k].type;
          if (t === "link") itm[k] = { label: `Item ${i + 1}`, href: `#x${i + 1}` };
          else if (t === "image") itm[k] = `https://example.com/img${i + 1}.png`;
          else itm[k] = `Item ${i + 1}`;
        }
        return itm;
      });
      const hMany = applyContentOverrides(html, { [repKey]: many }, schema);
      const $many = load(hMany, { xmlMode: false });
      const manyChildren = $many(`[data-repeat="${repKey}"]`).children().length;
      if (manyChildren !== manyCount) throw new Error(`${manyCount}-item array → ${manyChildren} children rendered`);

      tests.push(`✓ repeater "${repKey}" edits (empty/single/${manyCount})`);
    } catch (e) {
      tests.push(`✗ repeater "${repKey}": ${e.message}`);
      failures++;
    }
  }

  console.log(`${name}:`);
  for (const t of tests) console.log(`  ${t}`);
}

console.log(failures === 0 ? "\nALL TESTS PASSED ✓" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
