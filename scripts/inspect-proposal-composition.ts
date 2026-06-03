import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: npx tsx scripts/inspect-proposal-composition.ts <proposal-id>");
    process.exit(1);
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: prop } = await sb
    .from("proposals")
    .select("id, company_name, site_id, composition")
    .eq("id", id)
    .maybeSingle();
  if (!prop) {
    console.error("proposal not found:", id);
    process.exit(1);
  }

  console.log("Proposal:", prop.company_name, `(${prop.id})`);
  console.log("Site ID:", prop.site_id ?? "—");

  // composition can live on the proposal directly OR on the linked site
  let composition = prop.composition as { pages?: Array<{ sections?: Array<{ template_id: string }> }> } | null;
  if (!composition && prop.site_id) {
    const { data: site } = await sb
      .from("sites")
      .select("composition")
      .eq("id", prop.site_id)
      .maybeSingle();
    composition = site?.composition ?? null;
    console.log("(composition pulled from linked site)");
  }

  if (!composition || !composition.pages) {
    console.log("No composition.");
    return;
  }

  // collect all template IDs used
  const used = new Set<string>();
  for (const page of composition.pages) {
    for (const sec of page.sections || []) {
      used.add(sec.template_id);
    }
  }

  console.log("\nTemplate IDs used on this proposal's pages:");
  for (const tplId of used) {
    const { data: tpl } = await sb
      .from("section_templates")
      .select("name, category, version")
      .eq("id", tplId)
      .maybeSingle();
    console.log(`  ${tpl?.name ?? "(unknown)"} — category: ${tpl?.category ?? "?"} — v${tpl?.version ?? "?"} — id: ${tplId}`);
  }
}

main();
