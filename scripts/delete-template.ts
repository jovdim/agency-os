/**
 * Delete a section template completely:
 *   - Verify zero live sites reference it (HARD STOP if any do).
 *   - Delete DB row from section_templates.
 *   - Delete HTML + CSS bytes from storage.
 *   - Delete local file in public/sample-templates/.
 *
 * Run: npx tsx scripts/delete-template.ts <name>
 *      e.g. npx tsx scripts/delete-template.ts hero-04
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const name = process.argv[2];
if (!name) {
  console.error("Usage: npx tsx scripts/delete-template.ts <name>");
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});

async function main(): Promise<void> {
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

  // ── 1. Look up the row ──
  const { data: row, error: lookupErr } = await admin
    .from("section_templates")
    .select("id, name, category, html_path, css_path")
    .eq("name", name)
    .maybeSingle();
  if (lookupErr) {
    console.error(`DB lookup failed: ${lookupErr.message}`);
    process.exit(1);
  }
  if (!row) {
    console.error(`No template named "${name}" in section_templates.`);
    process.exit(1);
  }
  console.log(`Found ${row.category}/${row.name} (id=${row.id})`);

  // ── 2. Defensive: refuse if any live site uses it ──
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
    const sections = comp.sections ?? [];
    if (sections.some((s) => s.template_id === row.id)) {
      usingSites.push(`${site.name} (${site.id})`);
    }
  }
  if (usingSites.length > 0) {
    console.error(
      `\n✗ ABORTING — ${usingSites.length} live site(s) reference this template:\n  ${usingSites.join("\n  ")}\n\nMigrate those sites to a different template first, or this delete will leave dead references.`,
    );
    process.exit(1);
  }
  console.log(`✓ usage check: 0 live sites reference this template`);

  // ── 3. Delete DB row ──
  const { error: delRowErr } = await admin
    .from("section_templates")
    .delete()
    .eq("id", row.id);
  if (delRowErr) {
    console.error(`✗ DB delete failed: ${delRowErr.message}`);
    process.exit(1);
  }
  console.log(`✓ DB row deleted`);

  // ── 4. Delete storage files ──
  const pathsToRemove = [row.html_path, row.css_path].filter(
    (p): p is string => Boolean(p),
  );
  if (pathsToRemove.length > 0) {
    const { error: storageErr } = await admin.storage
      .from("section-templates")
      .remove(pathsToRemove);
    if (storageErr) {
      console.error(`✗ storage delete failed: ${storageErr.message}`);
      console.error(`  (DB row was deleted; you'll need to clean up storage manually)`);
      process.exit(1);
    }
    for (const p of pathsToRemove) console.log(`✓ storage removed: ${p}`);
  }

  // ── 5. Delete local file ──
  const localPath = join(process.cwd(), "public", "sample-templates", `${name}.html`);
  if (existsSync(localPath)) {
    unlinkSync(localPath);
    console.log(`✓ local file deleted: ${localPath}`);
  } else {
    console.log(`· local file already absent: ${localPath}`);
  }

  console.log(`\nDone. ${name} fully removed.`);
}
