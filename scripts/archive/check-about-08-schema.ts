/**
 * Dump the latest placeholder_schema for about-08 from the DB to confirm
 * the bullet field is registered as editable per-item text.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data: tpl } = await supabase
    .from("section_templates")
    .select("id, name, category, version, html_path, placeholder_schema, updated_at")
    .eq("name", "about-08")
    .single();
  if (!tpl) {
    console.log("about-08 not found");
    return;
  }
  console.log("template:", tpl.name, "v" + tpl.version);
  console.log("updated_at:", tpl.updated_at);
  console.log("html_path:", tpl.html_path);
  console.log("\nplaceholder_schema:");
  console.log(JSON.stringify(tpl.placeholder_schema, null, 2));
}
main();
