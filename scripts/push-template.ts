/**
 * Push a section template from disk to live Supabase storage + DB row.
 *
 * Handles BOTH new and existing templates:
 *   - New: inserts a row in section_templates (no thumbnail — operator
 *          can upload one later via the regular admin UI if they want
 *          a visual in the section picker).
 *   - Existing: updates HTML+CSS in storage, refreshes placeholder_schema,
 *               bumps version. Doesn't touch preview_image.
 *
 * Uses parseTemplateHtml directly so the resulting placeholder_schema is
 * bit-identical to what /api/section-templates POST produces — no schema
 * drift between push paths.
 *
 * Run: npx tsx scripts/push-template.ts <name>
 *      e.g. npx tsx scripts/push-template.ts nav-02
 *
 * Lives in scripts/ as a dev tool (not part of the production app). Used
 * after I edit a template's HTML/CSS to push the change to live. No UI
 * surface — just a CLI tool.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseTemplateHtml } from "../src/lib/templates/parser";

const name = process.argv[2];
if (!name) {
  console.error("Usage: npx tsx scripts/push-template.ts <name>");
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});

async function main(): Promise<void> {

// ── Env ──
const env: Record<string, string> = {};
for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split(
  "\n",
)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Parse ──
const filePath = join(process.cwd(), "public", "sample-templates", `${name}.html`);
let raw: string;
try {
  raw = readFileSync(filePath, "utf8");
} catch (err) {
  console.error(
    `Couldn't read ${filePath}: ${err instanceof Error ? err.message : err}`,
  );
  process.exit(1);
}

const parsed = parseTemplateHtml(raw);
if (!parsed.category) {
  console.error(
    `No category — make sure the file has <!-- SECTION:<cat>:start --> markers.`,
  );
  process.exit(1);
}
const category = parsed.category;

const htmlPath = `${category}/${name}.html`;
const cssPath = parsed.css.trim() ? `${category}/${name}.css` : null;

// ── Storage uploads ──
const { error: htmlErr } = await admin.storage
  .from("section-templates")
  .upload(htmlPath, parsed.html, {
    contentType: "text/html",
    upsert: true,
    cacheControl: "0",
  });
if (htmlErr) {
  console.error(`HTML upload failed: ${htmlErr.message}`);
  process.exit(1);
}
console.log(`✓ HTML  → ${htmlPath} (${parsed.html.length} bytes)`);

if (cssPath) {
  const { error: cssErr } = await admin.storage
    .from("section-templates")
    .upload(cssPath, parsed.css, {
      contentType: "text/css",
      upsert: true,
      cacheControl: "0",
    });
  if (cssErr) {
    console.error(`CSS upload failed: ${cssErr.message}`);
    process.exit(1);
  }
  console.log(`✓ CSS   → ${cssPath} (${parsed.css.length} bytes)`);
}

// ── DB upsert ──
const { data: existing, error: lookupErr } = await admin
  .from("section_templates")
  .select("id, version")
  .eq("category", category)
  .eq("name", name)
  .maybeSingle();

if (lookupErr) {
  console.error(`DB lookup failed: ${lookupErr.message}`);
  process.exit(1);
}

if (existing) {
  // Update existing — bump version + refresh schema.
  const { error: updErr } = await admin
    .from("section_templates")
    .update({
      placeholder_schema: parsed.placeholderSchema,
      css_path: cssPath,
      html_path: htmlPath,
      version: existing.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
  if (updErr) {
    console.error(`DB update failed: ${updErr.message}`);
    process.exit(1);
  }
  console.log(
    `✓ DB    → updated existing row (id=${existing.id}, v${existing.version} → v${existing.version + 1})`,
  );
} else {
  // Insert new — no preview_image, operator can upload thumbnail later
  // via /tech/section-templates if they want a visual in the picker.
  const { data: inserted, error: insErr } = await admin
    .from("section_templates")
    .insert({
      category,
      name,
      html_path: htmlPath,
      css_path: cssPath,
      preview_image: null,
      placeholder_schema: parsed.placeholderSchema,
      tags: [],
      industry_hints: [],
      is_published: true,
      version: 1,
    })
    .select("id")
    .single();
  if (insErr) {
    console.error(`DB insert failed: ${insErr.message}`);
    process.exit(1);
  }
  console.log(`✓ DB    → inserted new row (id=${inserted.id})`);
  console.log(
    `\nNo thumbnail set. Upload one later at /tech/section-templates if you want a visual preview in the section picker.`,
  );
}

// ── Schema preview ──
const schemaKeys = Object.keys(parsed.placeholderSchema);
console.log(`\nSchema (${schemaKeys.length} fields):`);
for (const k of schemaKeys) {
  const f = parsed.placeholderSchema[k];
  if (f.type === "repeater") {
    const items = (f as { default_items?: unknown[] }).default_items?.length ?? 0;
    console.log(`  ${k} — repeater (${items} default items)`);
  } else {
    console.log(`  ${k} — ${f.type}`);
  }
}

} // end main
