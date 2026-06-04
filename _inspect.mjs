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

async function main() {
  // all sites (there may be several demo/test ones)
  const { data: sites } = await admin
    .from("sites")
    .select("id, slug, name, last_published_at, composition");
  console.log(`total sites: ${sites?.length ?? 0}`);
  const SK = ["postup", "otazky", "vyzva", "mapa", "uvod", "stroje", "cena", "paticka", "vybava", "vyhody", "domov", "o-nas", "sluzby", "galeria", "kontakt"];

  for (const s of sites ?? []) {
    const json = JSON.stringify(s.composition ?? {});
    const hits = SK.filter((sk) => json.includes(sk));
    console.log(`\n== ${s.slug} | published:${!!s.last_published_at} | slovak-slugs-in-composition: [${hits.join(", ")}]`);
    const comp = s.composition ?? {};
    const page = (comp.pages || [])[0];
    if (page && page.sections && page.sections[0]) {
      console.log("  section[0] keys:", Object.keys(page.sections[0]).join(", "));
    }
    // show context around the first slovak slug
    if (hits.length) {
      const idx = json.indexOf(hits[0]);
      console.log(`  context for "${hits[0]}":`, json.slice(Math.max(0, idx - 60), idx + 30).replace(/\s+/g, " "));
    }
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
