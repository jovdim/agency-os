/**
 * For each non-paid recent proposal, show its DB show_banner value
 * AND whether a publish for it would actually inject the banner script.
 * Helps differentiate "old proposal that has the old TRUE default"
 * from "code bug that injects banner regardless of the flag."
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
    .select(
      "id, company_name, status, show_banner, created_at, discount_price, base_price",
    )
    .order("created_at", { ascending: false })
    .limit(20);
  console.log(
    "Recent proposals — what publish-time `sb === true` check would yield:\n",
  );
  console.log(
    "  created_at                       | DB show_banner | publish ships banner? | company",
  );
  for (const r of rows ?? []) {
    const willShip = r.show_banner === true;
    console.log(
      `  ${r.created_at}  ${String(r.show_banner).padEnd(14)}  ${(willShip ? "YES" : "no").padEnd(20)}  ${r.company_name}`,
    );
  }
}
main();
