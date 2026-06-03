import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await s.from("section_templates").select("id, category, name, placeholder_schema").eq("category", "contact");
  for (const t of data ?? []) {
    const ps = t.placeholder_schema as any;
    console.log(`${t.id}  ${t.category}/${t.name}`);
    console.log("  form_recipient_email:", JSON.stringify(ps?.form_recipient_email));
    console.log("  form_enabled        :", JSON.stringify(ps?.form_enabled));
  }
}
main();
