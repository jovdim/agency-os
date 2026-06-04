import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SALES_EMAIL = "sales@demo.com";
const SALES_PASSWORD = "Sales1234!";

const COMPANIES = [
  { company: "Acme Plumbing", person: "John Carter", phone: "+1 (555) 010-2001", email: "john@acmeplumbing.com", industry: "Plumbing", town: "Springfield", status: "submitted" },
  { company: "BrightSmile Dental", person: "Sarah Lee", phone: "+1 (555) 010-2002", email: "sarah@brightsmile.com", industry: "Dental", town: "Riverside", status: "submitted" },
  { company: "GreenLeaf Landscaping", person: "Mike Brown", phone: "+1 (555) 010-2003", email: "mike@greenleaf.com", industry: "Landscaping", town: "Fairview", status: "building" },
  { company: "Apex Roofing", person: "David Wilson", phone: "+1 (555) 010-2004", email: "david@apexroofing.com", industry: "Roofing", town: "Madison", status: "submitted" },
  { company: "Riverside Cafe", person: "Emma Davis", phone: "+1 (555) 010-2005", email: "emma@riversidecafe.com", industry: "Hospitality", town: "Brookline", status: "review" },
  { company: "Summit Fitness", person: "Chris Taylor", phone: "+1 (555) 010-2006", email: "chris@summitfitness.com", industry: "Fitness", town: "Clayton", status: "submitted" },
  { company: "Bluebird Bakery", person: "Olivia Martin", phone: "+1 (555) 010-2007", email: "olivia@bluebirdbakery.com", industry: "Bakery", town: "Ashford", status: "building" },
  { company: "Ironclad Security", person: "James Moore", phone: "+1 (555) 010-2008", email: "james@ironcladsecurity.com", industry: "Security", town: "Greenville", status: "submitted" },
  { company: "Sunrise Yoga Studio", person: "Sophia Clark", phone: "+1 (555) 010-2009", email: "sophia@sunriseyoga.com", industry: "Wellness", town: "Oakdale", status: "revision" },
  { company: "Harbor Auto Repair", person: "Daniel White", phone: "+1 (555) 010-2010", email: "daniel@harborauto.com", industry: "Automotive", town: "Bristol", status: "submitted" },
];

async function main() {
  // 1. Demo salesperson (idempotent)
  let salesId;
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: SALES_EMAIL,
    password: SALES_PASSWORD,
    email_confirm: true,
    app_metadata: { role: "sales" },
  });
  if (cErr) {
    if (/already|exist|registered/i.test(cErr.message)) {
      const { data: list } = await admin.auth.admin.listUsers();
      const u = list.users.find((x) => (x.email || "").toLowerCase() === SALES_EMAIL);
      if (!u) throw cErr;
      salesId = u.id;
      await admin.auth.admin.updateUserById(salesId, { app_metadata: { role: "sales" } });
      console.log("salesperson existed, reusing:", salesId);
    } else throw cErr;
  } else {
    salesId = created.user.id;
    console.log("salesperson created:", salesId);
  }
  const { error: pfErr } = await admin
    .from("profiles")
    .upsert({ id: salesId, role: "sales", full_name: "Demo Salesperson", is_active: true }, { onConflict: "id" });
  if (pfErr) throw new Error("profile upsert: " + pfErr.message);

  // 2. 10 contacts + 10 proposal requests
  let n = 0;
  for (const c of COMPANIES) {
    const { data: contact, error: ctErr } = await admin
      .from("contacts")
      .insert({
        company_name: c.company,
        contact_person: c.person,
        phone: c.phone,
        email: c.email,
        assigned_to: salesId,
        status: "new",
      })
      .select("id")
      .single();
    if (ctErr) throw new Error(`contact insert (${c.company}): ${ctErr.message}`);

    const baseSlug = c.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const slug = `${baseSlug}-${crypto.randomBytes(2).toString("hex")}`;
    const { error: prErr } = await admin.from("proposals").insert({
      slug,
      contact_id: contact.id,
      sales_person_id: salesId,
      built_by: null,
      template_id: null,
      company_name: c.company,
      industry: c.industry,
      town: c.town,
      services: [],
      content_overrides: { sections: [] },
      status: c.status,
      base_price: 299,
    });
    if (prErr) throw new Error(`proposal insert (${c.company}): ${prErr.message}`);
    n++;
    console.log(`  + ${c.company} (${c.status})`);
  }

  console.log(`\nSeeded ${n} proposal requests under "Demo Salesperson".`);
  console.log(`Sales login: ${SALES_EMAIL} / ${SALES_PASSWORD}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
