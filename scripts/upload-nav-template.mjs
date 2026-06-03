// One-shot: parse the sample nav-01 template and upload it to Supabase
// (storage + section_templates row). Uses the same logic as the parser.
//
// Usage: node scripts/upload-nav-template.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  const placeholderSchema = {};
  const fieldOrder = [];

  $("[data-field]").each((_i, el) => {
    const $el = $(el);
    const key = $el.attr("data-field");
    if (!key || placeholderSchema[key]) return;
    const tag = (el.type === "tag" ? el.tagName : "").toLowerCase();
    const explicitType = ($el.attr("data-type") || "").toLowerCase();
    fieldOrder.push(key);

    if (explicitType === "link" && tag === "a") {
      placeholderSchema[key] = {
        type: "link",
        default: $el.text().trim(),
        default_href: $el.attr("href") || "",
      };
      return;
    }

    if (tag === "img") {
      placeholderSchema[key] = {
        type: "image",
        default_src: $el.attr("src") || undefined,
      };
      return;
    }

    const style = $el.attr("style") || "";
    const bgMatch = style.match(BG_IMAGE_RE);
    if (bgMatch) {
      placeholderSchema[key] = { type: "image", default_src: bgMatch[1] };
      return;
    }

    const text = $el.text().trim();
    const innerHtml = $el.html() || "";
    const isLong = text.length > 100 || /<br\s*\/?>/.test(innerHtml);
    placeholderSchema[key] = {
      type: isLong ? "longtext" : "text",
      default: text,
    };
  });

  return { category, html: sectionHtml, css, placeholderSchema, fieldOrder };
}

// ── Run ──
const file = path.join(
  __dirname,
  "..",
  "public",
  "sample-templates",
  "nav-01.html",
);
const fullHtml = await fs.readFile(file, "utf8");
const parsed = parseTemplateHtml(fullHtml);

console.log("Category:", parsed.category);
console.log("Fields:", parsed.fieldOrder.length);
for (const k of parsed.fieldOrder) {
  const f = parsed.placeholderSchema[k];
  console.log(
    `  - ${k}: ${f.type}` +
      (f.default ? ` "${f.default}"` : "") +
      (f.default_href ? ` → ${f.default_href}` : "") +
      (f.default_src ? ` ← ${f.default_src}` : ""),
  );
}

const category = parsed.category || "nav";
const name = "nav-01";
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

// Upsert (delete + insert by category+name to bump version)
const { data: existing } = await admin
  .from("section_templates")
  .select("id, version, preview_image")
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
  tags: ["dropdown", "phone-cta", "sticky"],
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
