/**
 * Generalized version of hero-compat-check.ts — audits any category.
 *
 * Run: npx tsx scripts/category-audit.ts <category>
 *      e.g. npx tsx scripts/category-audit.ts about
 *
 * Prints:
 *   - DB rows (id, version, paths, updated_at)
 *   - Local-vs-DB schema parity per template
 *   - Live usage on sites per template
 *   - Cross-template field matrix + shared/orphan summary
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseTemplateHtml } from "../src/lib/templates/parser";

const category = process.argv[2];
if (!category) {
  console.error("Usage: npx tsx scripts/category-audit.ts <category>");
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

  const { data: rows, error: rowErr } = await admin
    .from("section_templates")
    .select("id, name, version, html_path, placeholder_schema, updated_at")
    .eq("category", category)
    .order("name");
  if (rowErr) {
    console.error("DB error:", rowErr.message);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log(`No templates in category "${category}".`);
    return;
  }

  console.log(`\n── DB rows (${rows.length}) ──`);
  for (const r of rows) {
    console.log(`  ${r.name} — id=${r.id.slice(0, 8)} v${r.version}  updated=${r.updated_at}`);
  }

  console.log(`\n── Local vs DB schema parity ──`);
  for (const r of rows) {
    const file = join(process.cwd(), "public", "sample-templates", `${r.name}.html`);
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      console.log(`  ${r.name}: ✗ no local file`);
      continue;
    }
    const parsed = parseTemplateHtml(raw);
    const localKeys = Object.keys(parsed.placeholderSchema).sort();
    const dbKeys = Object.keys((r.placeholder_schema as Record<string, unknown>) ?? {}).sort();
    if (JSON.stringify(localKeys) === JSON.stringify(dbKeys)) {
      console.log(`  ${r.name}: ✓ schemas match (${localKeys.length} fields)`);
    } else {
      console.log(`  ${r.name}: ✗ DRIFT`);
      console.log(`              local: ${JSON.stringify(localKeys)}`);
      console.log(`              DB   : ${JSON.stringify(dbKeys)}`);
    }
  }

  // Live usage
  console.log(`\n── Live usage (sites referencing each template) ──`);
  const { data: allSites, error: sitesErr } = await admin
    .from("sites")
    .select("id, name, composition");
  if (sitesErr) {
    console.error("Could not load sites:", sitesErr.message);
  } else {
    const usageByTemplateId = new Map<string, string[]>();
    for (const site of allSites ?? []) {
      const comp = (site.composition ?? {}) as { sections?: Array<{ template_id?: string; category?: string }> };
      for (const s of comp.sections ?? []) {
        if (s.category === category && s.template_id) {
          const list = usageByTemplateId.get(s.template_id) ?? [];
          list.push(`${site.name} (${site.id.slice(0, 8)})`);
          usageByTemplateId.set(s.template_id, list);
        }
      }
    }
    for (const r of rows) {
      const users = usageByTemplateId.get(r.id) ?? [];
      console.log(`  ${r.name} (id=${r.id.slice(0, 8)}): ${users.length} site(s)`);
      for (const u of users.slice(0, 3)) console.log(`              · ${u}`);
      if (users.length > 3) console.log(`              · …and ${users.length - 3} more`);
    }
  }

  // Field matrix
  console.log(`\n── Field matrix ──`);
  const allFields = new Set<string>();
  const perTemplateFields = new Map<string, Set<string>>();
  for (const r of rows) {
    const dbSchema = (r.placeholder_schema as Record<string, { type?: string }>) ?? {};
    const set = new Set(Object.keys(dbSchema));
    perTemplateFields.set(r.name, set);
    for (const k of set) allFields.add(k);
  }
  const sortedFields = [...allFields].sort();
  const sortedNames = rows.map((r) => r.name);
  console.log(
    `  ${"field".padEnd(28)} ${sortedNames.map((n) => n.padEnd(11)).join(" ")}`,
  );
  console.log(
    `  ${"".padEnd(28, "─")} ${sortedNames.map(() => "─".padEnd(11, "─")).join(" ")}`,
  );
  for (const f of sortedFields) {
    const cells = sortedNames.map((n) =>
      perTemplateFields.get(n)?.has(f) ? "✓".padEnd(11) : "".padEnd(11),
    );
    console.log(`  ${f.padEnd(28)} ${cells.join(" ")}`);
  }

  const sharedFields = sortedFields.filter((f) =>
    sortedNames.every((n) => perTemplateFields.get(n)?.has(f)),
  );
  console.log(`\n  Shared (loss-free swap): ${sharedFields.length} fields`);
  for (const f of sharedFields) console.log(`              ✓ ${f}`);
}
