/**
 * Dump recent proposals' show_banner values so we can see whether the
 * default-FALSE migration (00065) actually applied to new inserts.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data: rows } = await supabase
    .from("proposals")
    .select("id, company_name, status, show_banner, created_at")
    .order("created_at", { ascending: false })
    .limit(15);
  console.log("Recent proposals (newest first):");
  for (const r of rows ?? []) {
    console.log(
      `  ${r.created_at}  status:${r.status.padEnd(10)}  show_banner=${r.show_banner}  ${r.company_name}`,
    );
  }
}
main();
