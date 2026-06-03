/**
 * One-off backup script — pulls the CURRENT live state of nav-02 through
 * nav-06 from Supabase Storage + the section_templates DB row, and writes
 * them to `tmp/template-backup-2026-05-11/` so we have a known-good rollback
 * point before pushing CSS-selector-scoping fixes.
 *
 * Backup layout:
 *   tmp/template-backup-2026-05-11/nav/nav-02.html        ← storage HTML body
 *   tmp/template-backup-2026-05-11/nav/nav-02.css         ← storage CSS body (if present)
 *   tmp/template-backup-2026-05-11/nav/nav-02.row.json    ← DB row snapshot (id, version, schema, paths, etc.)
 *
 * To revert, see scripts/restore-nav-templates.ts (written only if needed).
 *
 * Run: npx tsx scripts/backup-nav-templates.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const NAMES = ["nav-02", "nav-03", "nav-04", "nav-05", "nav-06"];
const CATEGORY = "nav";
const BACKUP_DIR = join(process.cwd(), "tmp", "template-backup-2026-05-11", CATEGORY);

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
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  mkdirSync(BACKUP_DIR, { recursive: true });
  console.log(`Backing up to ${BACKUP_DIR}\n`);

  for (const name of NAMES) {
    console.log(`── ${name} ──`);

    // DB row
    const { data: row, error: rowErr } = await admin
      .from("section_templates")
      .select("*")
      .eq("category", CATEGORY)
      .eq("name", name)
      .maybeSingle();
    if (rowErr) {
      console.error(`  ✗ DB lookup failed: ${rowErr.message}`);
      continue;
    }
    if (!row) {
      console.error(`  ✗ No row found for ${CATEGORY}/${name} — nothing to back up`);
      continue;
    }
    writeFileSync(join(BACKUP_DIR, `${name}.row.json`), JSON.stringify(row, null, 2));
    console.log(`  ✓ row.json (id=${row.id}, v${row.version})`);

    // HTML body
    if (row.html_path) {
      const { data: htmlBlob, error: htmlErr } = await admin.storage
        .from("section-templates")
        .download(row.html_path);
      if (htmlErr) {
        console.error(`  ✗ HTML download failed (${row.html_path}): ${htmlErr.message}`);
      } else if (htmlBlob) {
        const html = await htmlBlob.text();
        writeFileSync(join(BACKUP_DIR, `${name}.html`), html);
        console.log(`  ✓ HTML  (${html.length} bytes)`);
      }
    }

    // CSS body (optional)
    if (row.css_path) {
      const { data: cssBlob, error: cssErr } = await admin.storage
        .from("section-templates")
        .download(row.css_path);
      if (cssErr) {
        console.error(`  ✗ CSS download failed (${row.css_path}): ${cssErr.message}`);
      } else if (cssBlob) {
        const css = await cssBlob.text();
        writeFileSync(join(BACKUP_DIR, `${name}.css`), css);
        console.log(`  ✓ CSS   (${css.length} bytes)`);
      }
    } else {
      console.log(`  · no CSS path on row`);
    }
  }

  console.log(`\nDone. Backup at ${BACKUP_DIR}`);
}
