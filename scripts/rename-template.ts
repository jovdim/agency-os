/**
 * Rename a section template completely:
 *   1. Read local <old>.html, replace every "<old>" with "<new>" in
 *      the content (title, preview banner, SECTION comment, CSS class
 *      names like .services-05 → .services-04), write to <new>.html.
 *   2. Push <new> via push-template logic (creates new DB row + uploads
 *      to storage at the new path).
 *   3. Delete <old> via delete-template logic (removes old DB row +
 *      storage + the original local file).
 *
 * Defensive checks:
 *   - Local <old>.html must exist
 *   - Local <new>.html must NOT already exist
 *   - DB row for <old> must exist
 *   - DB row for <new> must NOT already exist (prevents collision)
 *   - Zero live sites referencing <old> (delete-template's hard stop)
 *
 * Run: npx tsx scripts/rename-template.ts <oldname> <newname>
 *      e.g. npx tsx scripts/rename-template.ts services-04 services-03
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseTemplateHtml } from "../src/lib/templates/parser";

const oldName = process.argv[2];
const newName = process.argv[3];
if (!oldName || !newName) {
  console.error("Usage: npx tsx scripts/rename-template.ts <oldname> <newname>");
  process.exit(1);
}
if (oldName === newName) {
  console.error("old and new names are identical — nothing to do");
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});

async function main(): Promise<void> {
  // ── Env ──
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Missing env");
    process.exit(1);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Defensive: verify state ──
  const oldLocal = join(process.cwd(), "public", "sample-templates", `${oldName}.html`);
  const newLocal = join(process.cwd(), "public", "sample-templates", `${newName}.html`);
  if (!existsSync(oldLocal)) {
    console.error(`✗ no local file at ${oldLocal}`);
    process.exit(1);
  }
  if (existsSync(newLocal)) {
    console.error(`✗ target local file already exists: ${newLocal}`);
    process.exit(1);
  }

  const { data: oldRow, error: oldErr } = await admin
    .from("section_templates")
    .select("id, name, category, html_path, css_path")
    .eq("name", oldName)
    .maybeSingle();
  if (oldErr) {
    console.error(`DB lookup of ${oldName} failed: ${oldErr.message}`);
    process.exit(1);
  }
  if (!oldRow) {
    console.error(`✗ no DB row for "${oldName}"`);
    process.exit(1);
  }

  const { data: newRow, error: newErr } = await admin
    .from("section_templates")
    .select("id")
    .eq("name", newName)
    .maybeSingle();
  if (newErr) {
    console.error(`DB lookup of ${newName} failed: ${newErr.message}`);
    process.exit(1);
  }
  if (newRow) {
    console.error(`✗ target DB row already exists for "${newName}" — aborting to prevent collision`);
    process.exit(1);
  }

  // ── Live usage refusal (mirrors delete-template's hard stop) ──
  const { data: allSites, error: sitesErr } = await admin
    .from("sites")
    .select("id, name, composition");
  if (sitesErr) {
    console.error(`Could not load sites for usage check: ${sitesErr.message}`);
    process.exit(1);
  }
  const usingSites: string[] = [];
  for (const site of allSites ?? []) {
    const comp = (site.composition ?? {}) as { sections?: Array<{ template_id?: string }> };
    if ((comp.sections ?? []).some((s) => s.template_id === oldRow.id)) {
      usingSites.push(`${site.name} (${site.id})`);
    }
  }
  if (usingSites.length > 0) {
    console.error(
      `\n✗ ABORTING — ${usingSites.length} live site(s) reference ${oldName}:\n  ${usingSites.join("\n  ")}\n\nA rename would orphan those references (template_id moves with the new ID). Migrate those sites first or use a migration script that updates composition rows.`,
    );
    process.exit(1);
  }
  console.log(`✓ usage check: 0 live sites reference ${oldName}`);

  // ── 1. Local rename + content replace ──
  const original = readFileSync(oldLocal, "utf8");
  // Use split/join so all occurrences are replaced (no regex special chars).
  // Both the prefix-bare form (services-05) AND the dot-class form (.services-05)
  // get replaced because the bare string match catches both.
  const renamed = original.split(oldName).join(newName);
  writeFileSync(newLocal, renamed);
  console.log(`✓ local: ${oldName}.html → ${newName}.html (${renamed.length} bytes, ${countOccurrences(original, oldName)} replacements)`);

  // ── 2. Push <new> ──
  // Inline the push-template logic so we keep this as a single script.
  const parsed = parseTemplateHtml(renamed);
  if (!parsed.category) {
    console.error(`✗ parser saw no category in ${newName}.html — aborting`);
    process.exit(1);
  }
  const category = parsed.category;
  const newHtmlPath = `${category}/${newName}.html`;
  const newCssPath = parsed.css.trim() ? `${category}/${newName}.css` : null;

  const { error: htmlErr } = await admin.storage
    .from("section-templates")
    .upload(newHtmlPath, parsed.html, {
      contentType: "text/html",
      upsert: true,
      cacheControl: "0",
    });
  if (htmlErr) {
    console.error(`✗ HTML upload failed: ${htmlErr.message}`);
    process.exit(1);
  }
  console.log(`✓ storage HTML → ${newHtmlPath} (${parsed.html.length} bytes)`);

  if (newCssPath) {
    const { error: cssErr } = await admin.storage
      .from("section-templates")
      .upload(newCssPath, parsed.css, {
        contentType: "text/css",
        upsert: true,
        cacheControl: "0",
      });
    if (cssErr) {
      console.error(`✗ CSS upload failed: ${cssErr.message}`);
      process.exit(1);
    }
    console.log(`✓ storage CSS  → ${newCssPath} (${parsed.css.length} bytes)`);
  }

  const { data: inserted, error: insErr } = await admin
    .from("section_templates")
    .insert({
      category,
      name: newName,
      html_path: newHtmlPath,
      css_path: newCssPath,
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
    console.error(`✗ DB insert of ${newName} failed: ${insErr.message}`);
    process.exit(1);
  }
  console.log(`✓ DB inserted ${newName} (id=${inserted.id})`);

  // ── 3. Delete <old> ──
  const { error: delRowErr } = await admin
    .from("section_templates")
    .delete()
    .eq("id", oldRow.id);
  if (delRowErr) {
    console.error(`✗ DB delete of ${oldName} failed: ${delRowErr.message}`);
    process.exit(1);
  }
  console.log(`✓ DB deleted ${oldName}`);

  const oldStoragePaths = [oldRow.html_path, oldRow.css_path].filter(
    (p): p is string => Boolean(p),
  );
  if (oldStoragePaths.length > 0) {
    const { error: storageErr } = await admin.storage
      .from("section-templates")
      .remove(oldStoragePaths);
    if (storageErr) {
      console.error(`✗ storage delete failed: ${storageErr.message}`);
      console.error(`  (DB rename done; clean up old storage manually)`);
      process.exit(1);
    }
    for (const p of oldStoragePaths) console.log(`✓ storage removed: ${p}`);
  }

  unlinkSync(oldLocal);
  console.log(`✓ local removed: ${oldLocal}`);

  console.log(`\nDone. ${oldName} → ${newName} fully migrated.`);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}
