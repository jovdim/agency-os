/**
 * Hero compatibility audit.
 *
 * 1. List all hero rows in section_templates (DB version + last update + paths).
 * 2. For each, compare local file's parsed schema vs DB's stored
 *    placeholder_schema. Flag drift.
 * 3. Survey usage: search the `compositions` JSON on `sites` for each
 *    hero variant — tells us how many live sites depend on each.
 * 4. Print a cross-template field matrix so we can see swap-loss exposure.
 *
 * Run: npx tsx scripts/hero-compat-check.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseTemplateHtml } from "../src/lib/templates/parser";

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

  // ── 1. DB rows ──
  const { data: rows, error: rowErr } = await admin
    .from("section_templates")
    .select("id, name, version, html_path, placeholder_schema, updated_at")
    .eq("category", "hero")
    .order("name");
  if (rowErr) {
    console.error("DB error:", rowErr.message);
    process.exit(1);
  }

  console.log(`\n── DB rows ──`);
  for (const r of rows ?? []) {
    console.log(`  ${r.name} — id=${r.id.slice(0, 8)} v${r.version}  updated=${r.updated_at}`);
  }

  // ── 2. Local vs DB schema parity ──
  console.log(`\n── Local vs DB schema parity ──`);
  for (const r of rows ?? []) {
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
    const localStr = JSON.stringify(localKeys);
    const dbStr = JSON.stringify(dbKeys);
    if (localStr === dbStr) {
      console.log(`  ${r.name}: ✓ schemas match (${localKeys.length} fields)`);
    } else {
      console.log(`  ${r.name}: ✗ DRIFT`);
      console.log(`              local: ${localStr}`);
      console.log(`              DB   : ${dbStr}`);
    }
  }

  // ── 3. Usage on sites ──
  // Sites store their composition as JSON containing template_id references.
  // Count distinct sites per hero template_id.
  console.log(`\n── Live usage (sites referencing each hero) ──`);
  const { data: allSites, error: sitesErr } = await admin
    .from("sites")
    .select("id, name, composition");
  if (sitesErr) {
    console.error("Could not load sites:", sitesErr.message);
  } else {
    const usageByTemplateId = new Map<string, string[]>();
    for (const site of allSites ?? []) {
      const comp = (site.composition ?? {}) as { sections?: Array<{ template_id?: string; category?: string }> };
      const sections = comp.sections ?? [];
      for (const s of sections) {
        if (s.category === "hero" && s.template_id) {
          const list = usageByTemplateId.get(s.template_id) ?? [];
          list.push(`${site.name} (${site.id.slice(0, 8)})`);
          usageByTemplateId.set(s.template_id, list);
        }
      }
    }
    for (const r of rows ?? []) {
      const users = usageByTemplateId.get(r.id) ?? [];
      console.log(`  ${r.name} (id=${r.id.slice(0, 8)}): ${users.length} site(s)`);
      for (const u of users.slice(0, 3)) console.log(`              · ${u}`);
      if (users.length > 3) console.log(`              · …and ${users.length - 3} more`);
    }
  }

  // ── 4. Cross-template field matrix ──
  console.log(`\n── Field matrix (✓ = present, blank = missing) ──`);
  const allFields = new Set<string>();
  const perTemplateFields = new Map<string, Set<string>>();
  for (const r of rows ?? []) {
    const dbSchema = (r.placeholder_schema as Record<string, { type?: string }>) ?? {};
    const set = new Set(Object.keys(dbSchema));
    perTemplateFields.set(r.name, set);
    for (const k of set) allFields.add(k);
  }
  const sortedFields = [...allFields].sort();
  const sortedNames = (rows ?? []).map((r) => r.name);
  const headerRow = ["field".padEnd(28), ...sortedNames.map((n) => n.padEnd(10))].join(" ");
  console.log(`  ${headerRow}`);
  console.log(`  ${"".padEnd(28, "─")} ${sortedNames.map(() => "─".padEnd(10, "─")).join(" ")}`);
  for (const f of sortedFields) {
    const cells = sortedNames.map((n) => (perTemplateFields.get(n)?.has(f) ? "✓".padEnd(10) : "".padEnd(10)));
    console.log(`  ${f.padEnd(28)} ${cells.join(" ")}`);
  }

  // Compatibility verdict — fields present in ALL heroes are loss-free across swaps.
  const sharedFields = sortedFields.filter((f) =>
    sortedNames.every((n) => perTemplateFields.get(n)?.has(f)),
  );
  const orphanFields = sortedFields.filter((f) => !sharedFields.includes(f));
  console.log(`\n  Shared (loss-free swap): ${sharedFields.length} fields`);
  for (const f of sharedFields) console.log(`              ✓ ${f}`);
  console.log(`  Orphan-prone (lost on some swaps): ${orphanFields.length} fields`);
  for (const f of orphanFields) {
    const presentIn = sortedNames.filter((n) => perTemplateFields.get(n)?.has(f));
    console.log(`              · ${f} — only in ${presentIn.join(", ")}`);
  }
}
