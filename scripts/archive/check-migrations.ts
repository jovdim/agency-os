/**
 * One-off: lists which migration files in supabase/migrations/ have been
 * applied vs not, by querying supabase_migrations.schema_migrations.
 *
 * Run: npx tsx scripts/check-migrations.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

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
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Local files
  const dir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  // Try the standard supabase migrations table location
  const { data, error } = await admin.schema("supabase_migrations").from("schema_migrations").select("version, name");
  if (error) {
    console.error("Could not read supabase_migrations.schema_migrations:", error.message);
    console.error("(That's OK if you push migrations via the Studio SQL editor — Supabase only tracks them when applied via `supabase db push`.)");
    console.error("\nLocal files:");
    for (const f of files) console.error(`  ${f}`);
    process.exit(0);
  }

  const appliedVersions = new Set((data ?? []).map((r) => r.version));
  console.log(`\nApplied versions in DB (${appliedVersions.size}):`);
  const sortedApplied = [...appliedVersions].sort();
  for (const v of sortedApplied) console.log(`  ${v}`);

  console.log(`\nLocal migration files (${files.length}):`);
  for (const f of files) {
    // Files start with NNNNN_... — supabase tracks them by timestamp version usually
    // but if you used numbered prefixes like 00001_, the "version" tracked may be that prefix.
    const prefix = f.split("_")[0];
    const isApplied = appliedVersions.has(prefix);
    console.log(`  ${isApplied ? "✓" : "✗"} ${f}`);
  }
}
