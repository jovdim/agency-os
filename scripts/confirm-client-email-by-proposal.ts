/**
 * One-shot: confirm a client's auth email given a PROPOSAL id.
 * Bridges proposal → site → owner_id, then calls the same
 * email_confirm: true flow as confirm-client-email.ts.
 *
 * Usage:
 *   npx tsx scripts/confirm-client-email-by-proposal.ts <proposal-id>
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const proposalId = process.argv[2];
  if (!proposalId) {
    console.error(
      "usage: npx tsx scripts/confirm-client-email-by-proposal.ts <proposal-id>",
    );
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 1) proposal → contact → client_user_id (preferred), or proposal → site
  const { data: proposal, error: pErr } = await supabase
    .from("proposals")
    .select("id, status, contact_id")
    .eq("id", proposalId)
    .maybeSingle();
  if (pErr || !proposal) {
    console.error("proposal lookup failed:", pErr?.message ?? "not found");
    process.exit(1);
  }
  console.log("proposal :", proposal.id, "status:", proposal.status);

  // Try contact.client_user_id first
  let ownerId: string | null = null;
  if (proposal.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("client_user_id, business_email, company")
      .eq("id", proposal.contact_id)
      .maybeSingle();
    if (contact?.client_user_id) {
      ownerId = contact.client_user_id;
      console.log("contact  :", contact.company ?? "—", "→ owner", ownerId);
    } else {
      console.log("contact  :", contact?.company ?? "—", "(no client_user_id)");
    }
  }

  // Fallback: proposal → site → owner_id
  if (!ownerId) {
    const { data: site } = await supabase
      .from("sites")
      .select("id, name, owner_id")
      .eq("proposal_id", proposalId)
      .maybeSingle();
    if (site?.owner_id) {
      ownerId = site.owner_id;
      console.log("site     :", site.name, "→ owner", ownerId);
    }
  }

  if (!ownerId) {
    console.error("no owner_id found — proposal has no linked client account");
    process.exit(1);
  }

  // 2) fetch auth user
  const { data: userResp, error: userErr } =
    await supabase.auth.admin.getUserById(ownerId);
  if (userErr || !userResp?.user) {
    console.error("auth lookup failed:", userErr?.message ?? "no user");
    process.exit(1);
  }
  const user = userResp.user;
  console.log("BEFORE:");
  console.log("  email              :", user.email);
  console.log("  email_confirmed_at :", user.email_confirmed_at ?? "—");

  if (user.email_confirmed_at) {
    console.log("\nEmail is already confirmed. Nothing to do.");
    process.exit(0);
  }

  // 3) flip confirm
  const { error: updErr } = await supabase.auth.admin.updateUserById(ownerId, {
    email_confirm: true,
  });
  if (updErr) {
    console.error("confirm failed:", updErr.message);
    process.exit(1);
  }

  const { data: afterResp } =
    await supabase.auth.admin.getUserById(ownerId);
  console.log("AFTER:");
  console.log(
    "  email_confirmed_at :",
    afterResp?.user?.email_confirmed_at ?? "—",
  );
  console.log("\n✓ Email confirmed. Client can now sign in.");
}

main();
