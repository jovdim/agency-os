import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const id = process.argv[2];
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: site } = await sb.from("sites").select("id, name, composition").eq("id", id).maybeSingle();
  if (site) {
    console.log("FOUND in SITES:", site.name, `(${site.id})`);
    const c = site.composition as { pages?: Array<{ sections?: Array<{ template_id: string }> }> } | null;
    if (c?.pages) {
      const used = new Set<string>();
      for (const p of c.pages) for (const s of p.sections || []) used.add(s.template_id);
      console.log("\nTemplates used:");
      for (const tid of used) {
        const { data: t } = await sb.from("section_templates").select("name, category, version").eq("id", tid).maybeSingle();
        console.log(`  ${t?.name ?? "?"} (${t?.category ?? "?"}) v${t?.version ?? "?"} — ${tid}`);
      }
    }
    return;
  }
  const { data: prop } = await sb.from("proposals").select("id, company_name, site_id").eq("id", id).maybeSingle();
  if (prop) {
    console.log("FOUND in PROPOSALS:", prop.company_name, "site_id:", prop.site_id);
    if (prop.site_id) {
      console.log("Re-running with site ID...");
      process.argv[2] = prop.site_id;
      await main();
    }
    return;
  }
  console.log("not found anywhere:", id);
}
main();
