import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await s.from("sites").select("id, name, composition").not("composition", "is", null).not("last_published_at", "is", null).limit(1);
  const site = data?.[0];
  if (!site) { console.log("no sites with composition"); return; }
  console.log("site:", site.name);
  console.log(JSON.stringify(site.composition, null, 2).slice(0, 3000));
}
main();
