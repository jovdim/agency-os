/**
 * Comprehensive render test for the services templates.
 * Same shape as test-about-render.mjs — fetches uploaded HTML from
 * Supabase, runs applyContentOverrides through three scenarios:
 *   1. NO overrides         → defaults (incl. default_items)
 *   2. SOME flat overrides  → eyebrow + headline edits
 *   3. REPEATER edits       → empty array, single custom item, max+1 items
 *
 * Run: node scripts/test-services-render.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { load } from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, "..", ".env.local");
const envText = await fs.readFile(envPath, "utf8");
const env = Object.fromEntries(
  envText.split("\n").filter((l) => l && !l.startsWith("#"))
    .map((l) => { const eq = l.indexOf("="); return [l.slice(0, eq), l.slice(eq + 1).replace(/^"|"$/g, "")]; }),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function escapeAttrValue(s) { return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

function applyContentOverrides(html, overrides, schema) {
  const $ = load(html, { xmlMode: false });
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
  for (const [key, value] of Object.entries(overrides)) {
    const field = schema[key];
    if (!field || field.type === "repeater") continue;
    const $el = $(`[data-field="${escapeAttrValue(key)}"]`).first();
    if ($el.length === 0) continue;
    const el = $el[0];
    const tag = el.type === "tag" ? el.tagName.toLowerCase() : "";
    switch (field.type) {
      case "image":
        if (typeof value === "string" && value && (tag === "img" || tag === "iframe")) $el.attr("src", value);
        break;
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

const TEMPLATES = ["services-02", "services-03", "services-04", "services-05", "services-06", "services-07", "services-08"];

const { data: rows, error } = await admin
  .from("section_templates")
  .select("name, html_path, placeholder_schema")
  .eq("category", "services")
  .in("name", TEMPLATES);

if (error) { console.error("DB error:", error); process.exit(1); }
const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
let failures = 0;

for (const name of TEMPLATES) {
  const row = byName[name];
  if (!row) { console.log(`✗ ${name}: not in DB`); failures++; continue; }
  const { data: blob } = await admin.storage.from("section-templates").download(row.html_path);
  if (!blob) { console.log(`✗ ${name}: storage download failed`); failures++; continue; }
  const html = await blob.text();
  const schema = row.placeholder_schema;
  const tests = [];

  // Scenario 1: defaults
  try {
    const h = applyContentOverrides(html, {}, schema);
    if (!h || h.length < 100) throw new Error("output too short");
    if (h.includes("undefined")) throw new Error("found 'undefined' in HTML");
    tests.push("✓ defaults render");
  } catch (e) { tests.push(`✗ defaults: ${e.message}`); failures++; }

  // Scenario 2: flat overrides
  try {
    const flat = {};
    if (schema.services_eyebrow) flat.services_eyebrow = "TEST EYEBROW";
    if (schema.services_headline) flat.services_headline = "TEST HEADLINE";
    const h = applyContentOverrides(html, flat, schema);
    if (schema.services_eyebrow && !h.includes("TEST EYEBROW")) throw new Error("eyebrow override missing");
    if (schema.services_headline && !h.includes("TEST HEADLINE")) throw new Error("headline override missing");
    tests.push("✓ flat overrides applied");
  } catch (e) { tests.push(`✗ flat: ${e.message}`); failures++; }

  // Scenario 3: repeater edits
  const repKey = Object.entries(schema).find(([_, v]) => v.type === "repeater")?.[0];
  if (repKey) {
    try {
      const repSchema = schema[repKey];
      const min = repSchema.min ?? 1;
      const itemKeys = Object.keys(repSchema.item_schema);
      const fieldKey = itemKeys[0];
      const fieldType = repSchema.item_schema[fieldKey].type;

      // 3a: empty array (skip if min > 0; instead use min items)
      const emptyTarget = Math.max(0, 0); // try literal empty
      if (min === 0) {
        const hEmpty = applyContentOverrides(html, { [repKey]: [] }, schema);
        const $e = load(hEmpty, { xmlMode: false });
        const c = $e(`[data-repeat="${repKey}"]`).children().length;
        if (c !== 0) throw new Error(`empty → ${c} children`);
      }

      // 3b: single custom item
      const customItem = {};
      if (fieldType === "link") customItem[fieldKey] = { label: "CUSTOM_LABEL", href: "#custom" };
      else if (fieldType === "image") customItem[fieldKey] = "https://example.com/x.png";
      else customItem[fieldKey] = "CUSTOM_VALUE";

      const items1 = min <= 1 ? [customItem] : Array(min).fill(customItem);
      const h1 = applyContentOverrides(html, { [repKey]: items1 }, schema);
      const $1 = load(h1, { xmlMode: false });
      const c1 = $1(`[data-repeat="${repKey}"]`).children().length;
      if (c1 !== items1.length) throw new Error(`${items1.length}-item → ${c1} children`);
      if (fieldType === "link" && !h1.includes("CUSTOM_LABEL")) throw new Error("link label missing");
      if (fieldType === "image" && !h1.includes("x.png")) throw new Error("image src missing");
      if (fieldType !== "link" && fieldType !== "image" && !h1.includes("CUSTOM_VALUE")) throw new Error("text missing");

      // 3c: max + 1 items
      const manyCount = repSchema.max + 1;
      const many = Array.from({ length: manyCount }, (_, i) => {
        const it = {};
        for (const k of itemKeys) {
          const t = repSchema.item_schema[k].type;
          if (t === "link") it[k] = { label: `Item ${i + 1}`, href: `#x${i + 1}` };
          else if (t === "image") it[k] = `https://example.com/img${i + 1}.png`;
          else it[k] = `Item ${i + 1}`;
        }
        return it;
      });
      const hMany = applyContentOverrides(html, { [repKey]: many }, schema);
      const $m = load(hMany, { xmlMode: false });
      const cMany = $m(`[data-repeat="${repKey}"]`).children().length;
      if (cMany !== manyCount) throw new Error(`${manyCount} → ${cMany} children`);

      tests.push(`✓ repeater "${repKey}" edits (${min === 0 ? "empty/" : ""}single/${manyCount})`);
    } catch (e) { tests.push(`✗ repeater "${repKey}": ${e.message}`); failures++; }
  }

  console.log(`${name}:`);
  for (const t of tests) console.log(`  ${t}`);
}

console.log(failures === 0 ? "\nALL TESTS PASSED ✓" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
