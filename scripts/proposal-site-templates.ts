import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const proposalId = process.argv[2];
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: sites } = await sb
    .from("sites")
    .select("id, name, composition")
    .eq("proposal_id", proposalId)
    .order("created_at", { ascending: false });
  if (!sites || sites.length === 0) { console.log("no site for this proposal"); return; }
  const site = sites[0];
  console.log(`Site: ${site.name} (${site.id})`);
  const c = site.composition as { pages?: Array<{ sections?: Array<{ template_id: string }> }> } | null;
  if (!c?.pages) { console.log("composition empty"); return; }
  const used = new Set<string>();
  for (const p of c.pages) for (const s of p.sections || []) used.add(s.template_id);
  console.log("\nTemplates used:");
  for (const tid of used) {
    const { data: t } = await sb.from("section_templates").select("name, category, version").eq("id", tid).maybeSingle();
    console.log(`  ${t?.name ?? "?"} (${t?.category ?? "?"}) v${t?.version ?? "?"}`);
  }
}
main();
