import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const PID = "89a78c96-5e5d-4ae6-b664-95eb182d63b1";

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: p, error } = await sb
    .from("proposals")
    .select("*")
    .eq("id", PID)
    .single();
  if (error) {
    console.log("proposal lookup error:", error.message);
    return;
  }
  console.log("=== PROPOSAL ===");
  console.log({
    id: p.id,
    slug: p.slug,
    company_name: p.company_name,
    status: p.status,
    price: p.price,
    contact_id: p.contact_id,
    sales_person_id: p.sales_person_id,
    created_at: p.created_at,
  });

  // Sites linked to this proposal
  const { data: sites } = await sb
    .from("sites")
    .select("id, name, slug, site_url, domain, status, owner_id, last_published_at")
    .eq("proposal_id", PID);
  console.log("\n=== LINKED SITES ===");
  console.log(sites);

  // The contact
  if (p.contact_id) {
    const { data: contact } = await sb
      .from("contacts")
      .select("id, company_name, contact_person, email, phone, status")
      .eq("id", p.contact_id)
      .single();
    console.log("\n=== CONTACT ===");
    console.log(contact);
  }

  // The client account, if any site has an owner
  const ownerIds = [...new Set((sites || []).map((s) => s.owner_id))];
  for (const oid of ownerIds) {
    const { data: prof } = await sb
      .from("profiles")
      .select("id, full_name, company_name, role, is_active")
      .eq("id", oid)
      .single();
    const { data: userRes } = await sb.auth.admin.getUserById(oid);
    const { data: ownerSites } = await sb
      .from("sites")
      .select("id, name, proposal_id")
      .eq("owner_id", oid);
    console.log(`\n=== OWNER ${oid} ===`);
    console.log({ profile: prof, email: userRes?.user?.email, total_sites: ownerSites?.length, sites: ownerSites });
  }

  // Payments tied to this proposal
  const { data: payments } = await sb
    .from("payments")
    .select("id, amount, status, proposal_id, profile_id")
    .eq("proposal_id", PID);
  console.log("\n=== PAYMENTS ===");
  console.log(payments);
}
main().catch(console.error);
