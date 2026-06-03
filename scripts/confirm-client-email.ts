/**
 * One-shot: mark a site owner's auth-email as confirmed so they can sign
 * into the client zone. Some legacy / migrated client accounts were
 * created before the `email_confirm: true` flag was wired into the
 * create-client flow, so they show "email not confirmed" on login even
 * though the operator already vouched for the address.
 *
 * Usage:
 *   npx tsx scripts/confirm-client-email.ts <site-id>
 *
 * Safe to re-run — `email_confirm: true` is idempotent in Supabase Auth.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const siteId = process.argv[2];
  if (!siteId) {
    console.error("usage: npx tsx scripts/confirm-client-email.ts <site-id>");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 1) Look up the site → owner_id
  const { data: site, error: siteErr } = await supabase
    .from("sites")
    .select("id, name, owner_id")
    .eq("id", siteId)
    .maybeSingle();

  if (siteErr) {
    console.error("site read failed:", siteErr.message);
    process.exit(1);
  }
  if (!site) {
    console.error("site not found:", siteId);
    process.exit(1);
  }
  if (!site.owner_id) {
    console.error("site has no owner_id — no client account linked");
    process.exit(1);
  }

  // 2) Look up the auth user
  const { data: userResp, error: userErr } =
    await supabase.auth.admin.getUserById(site.owner_id);
  if (userErr || !userResp?.user) {
    console.error(
      "auth user lookup failed:",
      userErr?.message ?? "user not returned",
    );
    process.exit(1);
  }
  const user = userResp.user;

  console.log("BEFORE:");
  console.log("  site               :", site.name, `(${site.id})`);
  console.log("  owner_id           :", site.owner_id);
  console.log("  email              :", user.email ?? "—");
  console.log("  email_confirmed_at :", user.email_confirmed_at ?? "—");

  if (user.email_confirmed_at) {
    console.log("\nEmail is already confirmed. Nothing to do.");
    process.exit(0);
  }

  // 3) Flip email_confirm
  const { error: updErr } = await supabase.auth.admin.updateUserById(
    site.owner_id,
    { email_confirm: true },
  );

  if (updErr) {
    console.error("confirm failed:", updErr.message);
    process.exit(1);
  }

  // 4) Re-read to confirm
  const { data: afterResp } = await supabase.auth.admin.getUserById(
    site.owner_id,
  );

  console.log("\nAFTER:");
  console.log(
    "  email_confirmed_at :",
    afterResp?.user?.email_confirmed_at ?? "—",
  );
  console.log("\n✓ Email confirmed. Client can now sign in.");
}

main();
