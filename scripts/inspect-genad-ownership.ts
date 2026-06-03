import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 1) Which sites does each user own?
  for (const uid of [
    "dc93bd06-238e-40ca-86cb-cae57cb05907",
    "002ff280-4271-4659-9ed8-09478d0f0769",
  ]) {
    console.log(`\n=== user ${uid} ===`);
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, role, company_name, is_active")
      .eq("id", uid)
      .maybeSingle();
    console.log("profile:", profile);
    const { data: sites } = await supabase
      .from("sites")
      .select("id, name, owner_id, proposal_id, is_paid, last_published_at")
      .eq("owner_id", uid);
    console.log(`sites (${sites?.length ?? 0}):`);
    for (const s of sites ?? []) console.log("  ", s);
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, company_name, email, client_user_id")
      .eq("client_user_id", uid);
    console.log(`contacts (${contacts?.length ?? 0}):`);
    for (const c of contacts ?? []) console.log("  ", c);
  }

  // 2) Cross-check: contact behind the GENAD proposal
  const { data: proposal } = await supabase
    .from("proposals")
    .select("id, contact_id")
    .eq("id", "c4734a15-44e4-492a-9126-fe7e135dc0fd")
    .maybeSingle();
  if (proposal?.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select(
        "id, company_name, email, business_email, client_user_id",
      )
      .eq("id", proposal.contact_id)
      .maybeSingle();
    console.log("\n=== proposal contact ===");
    console.log(contact);
  }
}
main();
