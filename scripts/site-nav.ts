import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const id = process.argv[2];
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: site } = await sb.from("sites").select("composition").eq("id", id).single();
  const c = site?.composition as { shared?: { nav_template_id?: string; footer_template_id?: string } } | null;
  if (!c?.shared) { console.log("no shared"); return; }
  const navId = c.shared.nav_template_id;
  if (navId) {
    const { data: t } = await sb.from("section_templates").select("name, version").eq("id", navId).maybeSingle();
    console.log(`Nav: ${t?.name ?? "?"} v${t?.version ?? "?"}`);
  } else console.log("no nav");
  const footerId = c.shared.footer_template_id;
  if (footerId) {
    const { data: t } = await sb.from("section_templates").select("name, version").eq("id", footerId).maybeSingle();
    console.log(`Footer: ${t?.name ?? "?"} v${t?.version ?? "?"}`);
  }
}
main();
