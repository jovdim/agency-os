import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const id = process.argv[2];
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: prop, error } = await sb.from("proposals").select("*").eq("id", id).single();
  if (error) { console.error(error); return; }
  console.log("Proposal:", prop.company_name);
  console.log("Has site_id:", !!prop.site_id);
  console.log("Composition stored on proposal:", !!prop.composition);

  let composition: { pages?: Array<{ sections?: Array<{ template_id: string }> }> } | null = prop.composition ?? null;
  if (!composition && prop.site_id) {
    const { data: site } = await sb.from("sites").select("composition").eq("id", prop.site_id).maybeSingle();
    composition = (site?.composition as { pages?: Array<{ sections?: Array<{ template_id: string }> }> } | null) ?? null;
    console.log("Pulled composition from linked site");
  }
  if (!composition?.pages) { console.log("No composition"); return; }

  const used = new Set<string>();
  for (const p of composition.pages) for (const s of p.sections || []) used.add(s.template_id);
  console.log("\nTemplate IDs used:");
  for (const tid of used) {
    const { data: t } = await sb.from("section_templates").select("name, category, version").eq("id", tid).maybeSingle();
    console.log(`  ${t?.name ?? "?"} (${t?.category ?? "?"}) v${t?.version ?? "?"}`);
  }
}
main();
