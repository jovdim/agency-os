/**
 * Re-parse every section_template row's HTML and overwrite its
 * `placeholder_schema` column with the freshly-derived schema.
 *
 * WHY: parseTemplateHtml() runs at upload time and stores its output in
 * the DB. Improvements to the parser (e.g. promoting map iframes from
 * `type: "text"` to `type: "map"` so the composer's MapField with the
 * Address/Coordinates/Embed tabs picks them up) only take effect for
 * NEWLY-uploaded templates — anything already in the DB keeps its
 * stale schema, and the composer renders the old single-input UI.
 *
 * This script is the one-shot migration: download each template's
 * html_path from Supabase Storage, re-run the parser, and PATCH the
 * row. Idempotent — safe to re-run any time the parser changes.
 *
 * Usage:
 *   node scripts/reparse-schemas.mjs              # all templates
 *   node scripts/reparse-schemas.mjs --dry        # show diffs, no writes
 *   node scripts/reparse-schemas.mjs --only=map   # filter by category
 *   node scripts/reparse-schemas.mjs --name=map-01  # one template by name
 *
 * The parser logic below is a copy of the canonical version in
 * src/lib/templates/parser.ts — keep them in sync. Tests in
 * __tests__/lib/template-parser.test.ts pin the expected output of
 * the canonical parser; if those pass and this script's output
 * matches, the two are in agreement.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── CLI args ──
const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? true];
    }),
);
const DRY_RUN = !!flags.dry;
const FILTER_CATEGORY = typeof flags.only === "string" ? flags.only : null;
const FILTER_NAME = typeof flags.name === "string" ? flags.name : null;

// ── Read .env.local for Supabase creds ──
const envPath = path.join(__dirname, "..", ".env.local");
const envText = await fs.readFile(envPath, "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const eq = l.indexOf("=");
      return [l.slice(0, eq), l.slice(eq + 1).replace(/^"|"$/g, "")];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("Missing SUPABASE creds in .env.local");
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Inlined parser — mirror of src/lib/templates/parser.ts
//  (cheerio version — same as the server uses; the in-browser DOMParser
//   variant in render-browser.ts only handles override application, not
//   schema parsing.)
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_MARKER_RE =
  /<!--\s*SECTION:([a-zA-Z0-9_-]+):start\s*-->([\s\S]*?)<!--\s*SECTION:\1:end\s*-->/i;
const STYLE_BLOCK_RE = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const BG_IMAGE_RE = /background-image:\s*url\(\s*['"]?([^'")]+?)['"]?\s*\)/i;

function parseTemplateHtml(input) {
  const sectionMatch = input.match(SECTION_MARKER_RE);
  const category = sectionMatch ? sectionMatch[1].toLowerCase() : null;
  const sectionHtml = sectionMatch ? sectionMatch[2].trim() : input;

  const styleMatches = input.match(STYLE_BLOCK_RE) || [];
  const css = styleMatches
    .map((b) => b.replace(/<\/?style[^>]*>/gi, "").trim())
    .filter(Boolean)
    .join("\n\n");

  const $ = load(sectionHtml, { xmlMode: false });
  const tempSchema = {};
  const domOrder = [];
  const consumed = new Set();

  // Repeaters first — collect [data-repeat] containers and mark every
  // nested data-field as consumed so the flat walker skips them.
  $("[data-repeat]").each((_i, container) => {
    const $container = $(container);
    const key = $container.attr("data-repeat");
    if (!key || tempSchema[key]) return;
    const children = $container.children().toArray();
    if (children.length === 0) return;

    $container.find("[data-field]").each((_j, descendant) => {
      consumed.add(descendant);
    });

    const itemSchema = parseFieldsInScope($, $(children[0]));
    const defaultItems = children.map((child) =>
      extractItemValues($, $(child), itemSchema),
    );
    const min = parseIntAttr($container.attr("data-min"), 1);
    const max = parseIntAttr($container.attr("data-max"), 10);

    tempSchema[key] = {
      type: "repeater",
      min,
      max,
      item_schema: itemSchema,
      default_items: defaultItems,
    };
    domOrder.push(key);
  });

  $("[data-field]").each((_i, el) => {
    if (consumed.has(el)) return;
    const $el = $(el);
    const key = $el.attr("data-field");
    if (!key || tempSchema[key]) return;
    const tag = (el.type === "tag" ? el.tagName : "").toLowerCase();
    const explicitType = ($el.attr("data-type") || "").toLowerCase();
    domOrder.push(key);

    if (explicitType === "link" && tag === "a") {
      tempSchema[key] = {
        type: "link",
        default: $el.text().trim(),
        default_href: $el.attr("href") || "",
      };
      return;
    }

    if (explicitType === "richtext") {
      tempSchema[key] = {
        type: "richtext",
        default: ($el.html() || "").trim(),
      };
      return;
    }

    // Map iframe — emits type:"map" so the composer's MapField (with
    // the Address/Coordinates/Embed tabs) picks it up. Default value
    // prefers the q= param (simple address) and falls back to the full
    // src for templates authored with a custom embed URL.
    if (explicitType === "map" && tag === "iframe") {
      const src = $el.attr("src") || "";
      let defaultValue = "";
      try {
        const u = new URL(src, "https://maps.google.com");
        const q = u.searchParams.get("q");
        if (q) defaultValue = q;
        else if (src) defaultValue = src;
      } catch {
        defaultValue = "";
      }
      tempSchema[key] = { type: "map", default: defaultValue };
      return;
    }

    if (tag === "img" || tag === "iframe") {
      tempSchema[key] = {
        type: "image",
        default_src: $el.attr("src") || undefined,
      };
      return;
    }

    const style = $el.attr("style") || "";
    const bgMatch = style.match(BG_IMAGE_RE);
    if (bgMatch) {
      tempSchema[key] = { type: "image", default_src: bgMatch[1] };
      return;
    }

    const text = $el.text().trim();
    const innerHtml = $el.html() || "";
    const isLong = text.length > 100 || /<br\s*\/?>/.test(innerHtml);
    tempSchema[key] = {
      type: isLong ? "longtext" : "text",
      default: text,
    };
  });

  // Honor `data-field-order` if present; otherwise use DOM order.
  const orderAttr = $("[data-field-order]").first().attr("data-field-order");
  let fieldOrder = domOrder;
  if (orderAttr) {
    const requested = orderAttr.split(",").map((s) => s.trim()).filter(Boolean);
    const seen = new Set();
    const ordered = [];
    for (const k of requested) {
      if (tempSchema[k] && !seen.has(k)) {
        ordered.push(k);
        seen.add(k);
      }
    }
    for (const k of domOrder) {
      if (!seen.has(k)) ordered.push(k);
    }
    fieldOrder = ordered;
  }

  // Stamp explicit `order` on each entry — Postgres JSONB reorders keys.
  const placeholderSchema = {};
  for (let i = 0; i < fieldOrder.length; i++) {
    const k = fieldOrder[i];
    placeholderSchema[k] = { ...tempSchema[k], order: i };
  }

  return { category, html: sectionHtml, css, placeholderSchema, fieldOrder };
}

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
      schema[key] = {
        type: "link",
        default: $el.text().trim(),
        default_href: $el.attr("href") || "",
      };
      return;
    }
    if (explicitType === "richtext") {
      schema[key] = { type: "richtext", default: ($el.html() || "").trim() };
      return;
    }
    if (explicitType === "map" && tag === "iframe") {
      const src = $el.attr("src") || "";
      let defaultValue = "";
      try {
        const u = new URL(src, "https://maps.google.com");
        const q = u.searchParams.get("q");
        if (q) defaultValue = q;
        else if (src) defaultValue = src;
      } catch {
        defaultValue = "";
      }
      schema[key] = { type: "map", default: defaultValue };
      return;
    }
    if (tag === "img" || tag === "iframe") {
      schema[key] = { type: "image", default_src: $el.attr("src") || undefined };
      return;
    }
    const style = $el.attr("style") || "";
    const bgMatch = style.match(BG_IMAGE_RE);
    if (bgMatch) {
      schema[key] = { type: "image", default_src: bgMatch[1] };
      return;
    }
    const text = $el.text().trim();
    const innerHtml = $el.html() || "";
    const isLong = text.length > 100 || /<br\s*\/?>/.test(innerHtml);
    schema[key] = { type: isLong ? "longtext" : "text", default: text };
  });
  return schema;
}

function extractItemValues($, $scope, itemSchema) {
  const values = {};
  for (const [key, field] of Object.entries(itemSchema)) {
    const $el = $scope.find(`[data-field="${key}"]`).first();
    if ($el.length === 0) continue;
    if (field.type === "image") {
      const tag = ($el[0].type === "tag" ? $el[0].tagName : "").toLowerCase();
      if (tag === "img" || tag === "iframe") values[key] = $el.attr("src") || "";
      else {
        const style = $el.attr("style") || "";
        const bg = style.match(BG_IMAGE_RE);
        if (bg) values[key] = bg[1];
      }
    } else if (field.type === "link") {
      values[key] = {
        label: $el.text().trim(),
        href: $el.attr("href") || "",
      };
    } else if (field.type === "richtext") {
      values[key] = ($el.html() || "").trim();
    } else {
      values[key] = $el.text().trim();
    }
  }
  return values;
}

function parseIntAttr(v, fallback) {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Migration
// ─────────────────────────────────────────────────────────────────────────────

console.log(
  `══ RE-PARSE SCHEMAS ══${DRY_RUN ? " (DRY RUN — no DB writes)" : ""}\n`,
);

let query = admin
  .from("section_templates")
  .select("id, name, category, html_path, placeholder_schema");
if (FILTER_CATEGORY) query = query.eq("category", FILTER_CATEGORY);
if (FILTER_NAME) query = query.eq("name", FILTER_NAME);

const { data: rows, error: listErr } = await query.order("name");
if (listErr) {
  console.error("Failed to list templates:", listErr.message);
  process.exit(1);
}

if (!rows || rows.length === 0) {
  console.log("No templates matched the filter. Nothing to do.");
  process.exit(0);
}

console.log(`Found ${rows.length} template(s) to re-parse.\n`);

let changed = 0;
let unchanged = 0;
let failed = 0;

for (const row of rows) {
  const label = `${row.category}/${row.name}`;
  try {
    // Download the source HTML from storage. The same file that was
    // uploaded originally — we don't have to look anywhere else.
    const { data: htmlBlob, error: dlErr } = await admin.storage
      .from("section-templates")
      .download(row.html_path);
    if (dlErr || !htmlBlob) {
      console.log(`  ✗ ${label}  (download failed: ${dlErr?.message ?? "no blob"})`);
      failed += 1;
      continue;
    }
    const html = await htmlBlob.text();
    // The stored HTML body is just the section body (between the
    // SECTION markers stripped at upload time). Wrap it back with a
    // synthetic marker so the parser's category-stripping path runs
    // identically to the original upload — keeps DOM-order field
    // detection 100% identical.
    const wrapped = `<!-- SECTION:${row.category}:start -->\n${html}\n<!-- SECTION:${row.category}:end -->`;
    const parsed = parseTemplateHtml(wrapped);

    // Compare normalized JSON for the diff check. Sorting keys would
    // be more robust against insertion-order noise, but Postgres JSONB
    // reorders anyway — the renderer reads with explicit `order`
    // numbers, not key insertion order. So a string comparison is OK.
    const before = JSON.stringify(row.placeholder_schema ?? {});
    const after = JSON.stringify(parsed.placeholderSchema);
    if (before === after) {
      console.log(`  · ${label}  (already up-to-date)`);
      unchanged += 1;
      continue;
    }

    // Show the field types that changed — concise diff for visibility.
    const oldTypes = Object.fromEntries(
      Object.entries(row.placeholder_schema ?? {}).map(([k, v]) => [
        k,
        v?.type ?? "?",
      ]),
    );
    const newTypes = Object.fromEntries(
      Object.entries(parsed.placeholderSchema).map(([k, v]) => [k, v.type]),
    );
    const allKeys = new Set([
      ...Object.keys(oldTypes),
      ...Object.keys(newTypes),
    ]);
    const diffs = [];
    for (const k of allKeys) {
      const a = oldTypes[k];
      const b = newTypes[k];
      if (a !== b) diffs.push(`${k}: ${a ?? "(none)"} → ${b ?? "(removed)"}`);
    }

    if (diffs.length > 0) {
      console.log(`  ✓ ${label}`);
      for (const d of diffs) console.log(`      • ${d}`);
    } else {
      console.log(`  ✓ ${label}  (defaults / order changed)`);
    }

    if (!DRY_RUN) {
      const { error: updErr } = await admin
        .from("section_templates")
        .update({ placeholder_schema: parsed.placeholderSchema })
        .eq("id", row.id);
      if (updErr) {
        console.log(`      ! update failed: ${updErr.message}`);
        failed += 1;
        continue;
      }
    }
    changed += 1;
  } catch (err) {
    console.log(`  ✗ ${label}  (exception: ${err?.message ?? err})`);
    failed += 1;
  }
}

console.log(
  `\nDone. ${changed} updated · ${unchanged} unchanged · ${failed} failed${
    DRY_RUN ? " (no writes — dry run)" : ""
  }`,
);
