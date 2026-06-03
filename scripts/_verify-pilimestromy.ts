import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local" });
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: sites } = await s.from("sites").select("id, name, composition").eq("domain", "pilimestromy.sk").order("created_at", { ascending: false }).limit(1);
  const site = sites?.[0];
  if (!site) { console.log("NO pilimestromy site found"); return; }
  const comp = site.composition as any;

  const { data: tpls } = await s.from("section_templates").select("id, name, placeholder_schema");
  const byId: Record<string, any> = {};
  for (const t of tpls ?? []) byId[t.id] = t;

  let problems = 0;
  function checkSection(label: string, tplId: string | undefined, overrides: Record<string, any>) {
    if (!tplId) { console.log(`  [${label}] NO template_id`); problems++; return; }
    const t = byId[tplId];
    if (!t) { console.log(`  [${label}] template_id ${tplId} not found`); problems++; return; }
    const schema = (t.placeholder_schema ?? {}) as Record<string, any>;
    const schemaKeys = new Set(Object.keys(schema));
    const unknown: string[] = [];
    for (const k of Object.keys(overrides ?? {})) {
      if (!schemaKeys.has(k)) unknown.push(k);
      else if (schema[k]?.type === "repeater" && Array.isArray(overrides[k])) {
        // check repeater item sub-keys against item_schema
        const itemSchema = schema[k].item_schema ?? schema[k].fields ?? {};
        const itemKeys = new Set(Object.keys(itemSchema));
        if (itemKeys.size) {
          const badSub = new Set<string>();
          for (const item of overrides[k]) for (const sk of Object.keys(item ?? {})) if (!itemKeys.has(sk)) badSub.add(sk);
          if (badSub.size) { console.log(`  [${label}] ${t.name}.${k} repeater unknown sub-keys: ${[...badSub].join(", ")} (item schema: ${[...itemKeys].join(", ")})`); problems++; }
        }
      }
    }
    if (unknown.length) { console.log(`  [${label}] ${t.name} unknown override keys: ${unknown.join(", ")}  |  schema has: ${[...schemaKeys].join(", ")}`); problems++; }
  }

  console.log(`site: ${site.name}  pages=${comp.pages?.length}`);
  console.log("shared nav:");  checkSection("nav", comp.shared?.nav_template_id, comp.shared?.nav_overrides ?? {});
  console.log("shared footer:"); checkSection("footer", comp.shared?.footer_template_id, comp.shared?.footer_overrides ?? {});
  for (const p of comp.pages ?? []) {
    console.log(`page ${p.path} (${p.sections.length} sections):`);
    p.sections.forEach((sec: any, i: number) => checkSection(`${p.path}#${i}`, sec.template_id, sec.content_overrides));
  }
  console.log(`\n${problems === 0 ? "✓ NO field-key problems" : `✗ ${problems} field-key problems found`}`);
}
main();
