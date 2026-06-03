import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const PROPOSAL_ID = "89a78c96-5e5d-4ae6-b664-95eb182d63b1";
const CONTACT_ID  = "5a8f6dd9-fd22-4b72-859b-9963bd78d779";
const USER_ID     = "5c20397b-36aa-4e0a-b609-b2f94ccf7d48";
const SITE_ID     = "79240759-fd2d-4e11-a9f0-01b33c0f6aee";
const PAYMENT_ID  = "75cfcf64-ac79-49cd-953d-fea9f3f498b9";

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 1) Delete contact — cascades proposal (00018: contact_id CASCADE) → which
  //    cascades proposal_messages/reminders/deployments/email_logs/tags
  console.log("→ Step 1: delete contact (cascades proposal) …");
  const { error: e1, count: c1 } = await sb
    .from("contacts")
    .delete({ count: "exact" })
    .eq("id", CONTACT_ID);
  if (e1) throw new Error(`Step 1 failed: ${e1.message}`);
  console.log(`   deleted ${c1 ?? 0} contact(s)`);

  // 2) Delete auth user — cascades profile → sites → sections / change_requests /
  //    credit_balances / credit_transactions / payments (profile_id CASCADE) /
  //    invoices / services / contact_form_submissions
  console.log("→ Step 2: delete auth user (cascades site + profile + payment) …");
  const { error: e2 } = await sb.auth.admin.deleteUser(USER_ID);
  if (e2 && !/not found|does not exist|no rows/i.test(e2.message))
    throw new Error(`Step 2 failed: ${e2.message}`);
  console.log("   deleted auth user");

  // 3) Verification
  console.log("\n→ Verification …");
  const [prop, contact, site, pay, prof] = await Promise.all([
    sb.from("proposals").select("id", { count: "exact", head: true }).eq("id", PROPOSAL_ID),
    sb.from("contacts") .select("id", { count: "exact", head: true }).eq("id", CONTACT_ID),
    sb.from("sites")    .select("id", { count: "exact", head: true }).eq("id", SITE_ID),
    sb.from("payments") .select("id", { count: "exact", head: true }).eq("id", PAYMENT_ID),
    sb.from("profiles") .select("id", { count: "exact", head: true }).eq("id", USER_ID),
  ]);
  const { data: u } = await sb.auth.admin.getUserById(USER_ID);
  console.table([{
    proposal: prop.count ?? "?",
    contact:  contact.count ?? "?",
    site:     site.count ?? "?",
    payment:  pay.count ?? "?",
    profile:  prof.count ?? "?",
    auth_user: u?.user ? 1 : 0,
  }]);

  const allZero =
    (prop.count ?? 0) + (contact.count ?? 0) + (site.count ?? 0) +
    (pay.count ?? 0) + (prof.count ?? 0) === 0 && !u?.user;
  console.log(allZero ? "\nDone — Joseph test cluster removed.\n" : "\nWARN: leftovers above\n");
  if (!allZero) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
