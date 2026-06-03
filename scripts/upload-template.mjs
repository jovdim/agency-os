// Generic template uploader.
// Reads public/sample-templates/<name>.html, parses it the same way the server
// parser does, and uploads (HTML body + CSS) to Supabase Storage + the
// section_templates row.
//
// Usage:
//   node scripts/upload-template.mjs <name>
//   node scripts/upload-template.mjs <name> --tags=tag1,tag2
//
// Examples:
//   node scripts/upload-template.mjs nav-01
//   node scripts/upload-template.mjs hero-02 --tags=centered,full-bleed,dark-overlay

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── CLI args ──
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? true];
    }),
);

const name = positional[0];
if (!name) {
  console.error("Usage: node scripts/upload-template.mjs <name> [--tags=a,b]");
  process.exit(1);
}

const tags =
  typeof flags.tags === "string"
    ? flags.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

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

// ── Mirror the server parser ──
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

  // Pre-pass: harvest [data-repeat] containers (item schema + defaults).
  // Mark every nested data-field as consumed so the flat walker skips them.
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

    // Map iframe: stores a plain address; renderer builds the embed URL.
    if (explicitType === "map" && tag === "iframe") {
      const src = $el.attr("src") || "";
      let defaultAddress = "";
      try {
        const u = new URL(src, "https://maps.google.com");
        defaultAddress = u.searchParams.get("q") || "";
      } catch {
        defaultAddress = "";
      }
      tempSchema[key] = {
        type: "text",
        default: defaultAddress,
      };
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

  // Stamp explicit `order` on each entry — Postgres JSONB will reorder keys.
  const placeholderSchema = {};
  for (let i = 0; i < fieldOrder.length; i++) {
    const k = fieldOrder[i];
    placeholderSchema[k] = { ...tempSchema[k], order: i };
  }

  return { category, html: sectionHtml, css, placeholderSchema, fieldOrder };
}

// ── Repeater helpers (mirror of parser.ts) ──

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
      let defaultAddress = "";
      try {
        defaultAddress =
          new URL(src, "https://maps.google.com").searchParams.get("q") || "";
      } catch {
        defaultAddress = "";
      }
      schema[key] = { type: "text", default: defaultAddress };
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
  for (let i = 0; i < order.length; i++) {
    schema[order[i]] = { ...schema[order[i]], order: i };
  }
  return schema;
}

function extractItemValues($, $child, itemSchema) {
  const values = {};
  for (const [key, s] of Object.entries(itemSchema)) {
    const $el = $child.find(`[data-field="${key.replace(/"/g, '\\"')}"]`).first();
    if ($el.length === 0) continue;
    const el = $el[0];
    const tag = (el.type === "tag" ? el.tagName : "").toLowerCase();

    switch (s.type) {
      case "link":
        values[key] = { label: $el.text().trim(), href: $el.attr("href") || "" };
        break;
      case "image":
        if (tag === "img" || tag === "iframe") {
          values[key] = $el.attr("src") || "";
        } else {
          const m = ($el.attr("style") || "").match(BG_IMAGE_RE);
          values[key] = m ? m[1] : "";
        }
        break;
      case "richtext":
        values[key] = ($el.html() || "").trim();
        break;
      case "text":
      case "longtext":
        values[key] = $el.text().trim();
        break;
    }
  }
  return values;
}

function parseIntAttr(raw, fallback) {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ── Run ──
const file = path.join(__dirname, "..", "public", "sample-templates", `${name}.html`);
let fullHtml;
try {
  fullHtml = await fs.readFile(file, "utf8");
} catch {
  console.error(`Template file not found: ${file}`);
  process.exit(1);
}

const parsed = parseTemplateHtml(fullHtml);

if (!parsed.category) {
  console.error(`No <!-- SECTION:<category>:start --> marker found in ${name}.html`);
  process.exit(1);
}

console.log(`Template:  ${name}`);
console.log(`Category:  ${parsed.category}`);
console.log(`Fields:    ${parsed.fieldOrder.length}`);
for (const k of parsed.fieldOrder) {
  const f = parsed.placeholderSchema[k];
  console.log(
    `  - ${k}: ${f.type}` +
      (f.default ? ` "${f.default}"` : "") +
      (f.default_href ? ` → ${f.default_href}` : "") +
      (f.default_src ? ` ← ${f.default_src.slice(0, 80)}…` : ""),
  );
}

const category = parsed.category;
const htmlPath = `${category}/${name}.html`;
const cssPath = parsed.css.trim() ? `${category}/${name}.css` : null;

console.log(`\nUploading HTML to section-templates/${htmlPath}…`);
const { error: htmlErr } = await admin.storage
  .from("section-templates")
  .upload(htmlPath, parsed.html, { contentType: "text/html", upsert: true });
if (htmlErr) throw new Error("HTML upload: " + htmlErr.message);

if (cssPath) {
  console.log(`Uploading CSS to section-templates/${cssPath}…`);
  const { error: cssErr } = await admin.storage
    .from("section-templates")
    .upload(cssPath, parsed.css, { contentType: "text/css", upsert: true });
  if (cssErr) throw new Error("CSS upload: " + cssErr.message);
}

const { data: existing } = await admin
  .from("section_templates")
  .select("id, version, preview_image, tags")
  .eq("category", category)
  .eq("name", name)
  .maybeSingle();

const row = {
  category,
  name,
  html_path: htmlPath,
  css_path: cssPath,
  preview_image: existing?.preview_image ?? null,
  placeholder_schema: parsed.placeholderSchema,
  tags: tags.length > 0 ? tags : (existing?.tags ?? []),
  industry_hints: [],
  is_published: true,
  version: existing ? existing.version + 1 : 1,
};

if (existing) {
  console.log(`\nReplacing existing template (v${existing.version} → v${row.version})…`);
  const { data, error } = await admin
    .from("section_templates")
    .update(row)
    .eq("id", existing.id)
    .select("id, name, version")
    .single();
  if (error) throw new Error("Update: " + error.message);
  console.log("Updated:", data);
} else {
  console.log(`\nInserting new template…`);
  const { data, error } = await admin
    .from("section_templates")
    .insert(row)
    .select("id, name, version")
    .single();
  if (error) throw new Error("Insert: " + error.message);
  console.log("Inserted:", data);
}

console.log("\n✓ Done. Open /tech/section-templates to see it.");
