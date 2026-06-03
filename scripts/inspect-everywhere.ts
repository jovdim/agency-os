import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const id = process.argv[2];
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  // Try ANY field this UUID could be in
  for (const [table, col] of [
    ["proposals", "id"],
    ["proposals", "site_id"],
    ["proposals", "contact_id"],
    ["sites", "id"],
    ["sites", "owner_id"],
    ["contacts", "id"],
  ]) {
    const { data } = await sb.from(table).select("id").eq(col, id).limit(1);
    if (data && data.length > 0) console.log(`MATCH: ${table}.${col}`);
  }
}
main();
