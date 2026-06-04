import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

// Load .env.local into process.env BEFORE dynamically importing publish.ts
// (which builds the admin client + reads cwd for template-base.css).
const ROOT = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

async function main() {
  const { publishSite } = await import("./src/lib/templates/publish.ts");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: su } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "super_admin")
    .limit(1)
    .maybeSingle();
  const userId = su?.id;
  if (!userId) { console.error("no super_admin profile found"); process.exit(1); }

  const { data: sites } = await admin
    .from("sites")
    .select("id, slug")
    .not("last_published_at", "is", null)
    .order("slug");

  console.log(`re-publishing ${sites?.length ?? 0} live sites...`);
  let ok = 0, fail = 0;
  for (const s of sites ?? []) {
    try {
      await publishSite(s.id, userId, "tech_publish");
      console.log(`  ok:   ${s.slug}`);
      ok++;
    } catch (e) {
      console.error(`  FAIL: ${s.slug} — ${e instanceof Error ? e.message : e}`);
      fail++;
    }
  }
  console.log(`done — ${ok} republished, ${fail} failed`);
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
