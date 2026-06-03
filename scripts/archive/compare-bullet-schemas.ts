/**
 * Compare about-02 (working) vs about-08 (Peter says broken) bullet schemas.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  for (const name of ["about-02", "about-08"]) {
    const { data: tpl } = await supabase
      .from("section_templates")
      .select("name, version, placeholder_schema")
      .eq("name", name)
      .single();
    if (!tpl) continue;
    console.log(`\n${name} v${tpl.version}`);
    const schema = tpl.placeholder_schema as Record<string, unknown>;
    // print only the repeater fields
    for (const [k, v] of Object.entries(schema)) {
      const f = v as Record<string, unknown>;
      if (f?.type === "repeater") {
        console.log(`  ${k} (repeater):`, JSON.stringify(f.item_schema));
      }
    }
  }
}
main();
