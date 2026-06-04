import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SLUGS = ["o-nas", "o_nas", "domov", "sluzby", "sluzba", "galeria", "kontakt", "referencie", "recenzie", "cennik"];

async function main() {
  const { data, error } = await admin
    .from("sites")
    .select("id, slug, name, last_published_at, composition")
    .ilike("slug", "%harbor%");
  if (error) throw error;
  if (!data?.length) { console.log("no harbor site found"); return; }

  for (const s of data) {
    const json = JSON.stringify(s.composition ?? {});
    const found = {};
    for (const sl of SLUGS) {
      const c = json.split(sl).length - 1;
      if (c) found[sl] = c;
    }
    console.log(`\nsite: ${s.slug} | id ${s.id} | last_published_at: ${s.last_published_at}`);
    console.log("  Slovak slugs stored in composition:", JSON.stringify(found));
    const comp = s.composition ?? {};
    console.log("  page paths:", (comp.pages || []).map((p) => p.path).join(", ") || "(none)");
    console.log("  total proposals/sites matched:", data.length);
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
