// Quick: figure out what kind of id 6a381bd3-... is
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const id = process.argv[2];
if (!id) {
  console.error("Usage: node scripts/find-id.mjs <id>");
  process.exit(1);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

console.log(`\nLooking up ${id}\n`);

// Sites
const { data: site } = await admin
  .from("sites")
  .select("id, name, slug, is_legacy, proposal_id, owner_id")
  .eq("id", id)
  .maybeSingle();
if (site) {
  console.log(`✓ Found in sites: name="${site.name}", slug="${site.slug}", is_legacy=${site.is_legacy}`);
  process.exit(0);
}

// Proposals
const { data: proposal } = await admin
  .from("proposals")
  .select("id, status, slug, contact_id, salesperson_id, requirements")
  .eq("id", id)
  .maybeSingle();
if (proposal) {
  console.log(`✓ Found in proposals: status="${proposal.status}", slug="${proposal.slug}"`);
  // find associated site
  const { data: linkedSite } = await admin
    .from("sites")
    .select("id, name, slug, is_legacy, last_published_at")
    .eq("proposal_id", id)
    .maybeSingle();
  if (linkedSite) {
    console.log(`  → Associated site: id=${linkedSite.id}, name="${linkedSite.name}", slug="${linkedSite.slug}", is_legacy=${linkedSite.is_legacy}`);
  } else {
    console.log(`  · No site linked to this proposal yet (composer hasn't been opened, or site not created)`);
  }
  process.exit(0);
}

// Contacts
const { data: contact } = await admin
  .from("contacts")
  .select("id, company_name, status")
  .eq("id", id)
  .maybeSingle();
if (contact) {
  console.log(`Found in contacts: company="${contact.company_name}", status="${contact.status}"`);
  process.exit(0);
}

console.log(`Not found in sites, proposals, or contacts. Maybe a different table or wrong id?`);

// List a few recent sites and proposals so user can pick
console.log("\nMost recent 5 sites:");
const { data: recentSites } = await admin
  .from("sites")
  .select("id, name, slug, is_legacy, last_published_at, created_at")
  .order("created_at", { ascending: false })
  .limit(5);
for (const s of recentSites ?? []) {
  console.log(`  ${s.id}  "${s.name}"  slug=${s.slug}  legacy=${s.is_legacy}  pub=${s.last_published_at ?? "never"}`);
}

console.log("\nMost recent 5 proposals (status=building or review or submitted):");
const { data: recentProps } = await admin
  .from("proposals")
  .select("id, status, slug, created_at")
  .in("status", ["submitted", "building", "review"])
  .order("created_at", { ascending: false })
  .limit(5);
for (const p of recentProps ?? []) {
  console.log(`  ${p.id}  status=${p.status}  slug=${p.slug ?? "-"}`);
}
