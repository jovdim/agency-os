/**
 * Read the actual DB column default for proposals.show_banner.
 * Used to verify migration 00065 applied.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Insert a minimal proposal then read back to see what show_banner became.
  // We use a dummy salesperson_id that should exist (the system needs at
  // least one profile in the tenant). Then we DELETE it right after.
  const { data: anyProfile } = await supabase
    .from("profiles")
    .select("id")
    .limit(1)
    .maybeSingle();
  if (!anyProfile) {
    console.log("No profile to use as sales_person_id");
    return;
  }

  const { data: inserted, error } = await supabase
    .from("proposals")
    .insert({
      slug: `__default-check-${Date.now()}`,
      sales_person_id: anyProfile.id,
      company_name: "__DEFAULT-CHECK",
      services: [],
      status: "submitted",
    })
    .select("id, show_banner")
    .single();

  if (error) {
    console.log("Insert failed:", error.message);
    return;
  }

  console.log(`\nNew proposal inserted with ONLY required fields:`);
  console.log(`  id: ${inserted.id}`);
  console.log(`  show_banner = ${inserted.show_banner}`);
  console.log(
    `\n→ DB default is currently: ${inserted.show_banner ? "TRUE (migration 00065 NOT applied)" : "FALSE (migration 00065 applied)"}\n`,
  );

  // Cleanup
  await supabase.from("proposals").delete().eq("id", inserted.id);
  console.log("(test row cleaned up)");
}
main();
