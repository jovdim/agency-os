/**
 * Reset a site's domain + email-prefix state back to fresh (step 1 of the
 * /client/domain pipeline), without touching the verified custom domain
 * column or anything else. Useful when prepping a demo where the boss
 * should see the empty state, not "Required domain: foo.sk, sent 3h ago".
 *
 * Usage:
 *   npx tsx scripts/reset-site-domain.ts <site-id>                    # dry-run
 *   npx tsx scripts/reset-site-domain.ts <site-id> --confirm          # apply
 *
 * Or look up by client email if you don't know the site_id:
 *   npx tsx scripts/reset-site-domain.ts email@example.com            # dry-run
 *   npx tsx scripts/reset-site-domain.ts email@example.com --confirm
 *
 * Fields cleared on the sites row:
 *   domain_status               → 'none'
 *   requested_domain            → null
 *   domain_auth_code            → null
 *   domain_notes                → null
 *   domain_decided_at           → null
 *   requested_email_prefix      → null
 *   domain_setup_status         → null
 *   domain_setup_started_at     → null
 *   domain_setup_error          → null
 *   domain_nameservers          → null
 *
 * NOT touched (preserves real config):
 *   - domain (the verified custom domain)
 *   - subdomain
 *   - site_url
 *   - last_published_at
 *   - is_paid
 *   - All ownership / proposal_id fields
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const arg = process.argv[2];
  const confirm = process.argv.includes("--confirm");

  if (!arg) {
    console.error(
      "usage: npx tsx scripts/reset-site-domain.ts <site-id-or-email> [--confirm]",
    );
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // ── Resolve target site ─────────────────────────────────────────────
  let siteId: string;
  if (UUID_RE.test(arg)) {
    siteId = arg;
  } else {
    // Treat as email — look up the profile, then its site.
    const { data: profileRow, error: pErr } = await supabase
      .from("profiles")
      .select("id, company_name, full_name")
      .eq("email", arg)
      .maybeSingle();

    if (pErr || !profileRow) {
      console.error(`No profile found for email: ${arg}`);
      process.exit(1);
    }

    const { data: siteRow, error: sErr } = await supabase
      .from("sites")
      .select("id")
      .eq("owner_id", profileRow.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sErr || !siteRow) {
      console.error(
        `No site found for ${arg} (${profileRow.company_name ?? profileRow.full_name ?? "unknown"})`,
      );
      process.exit(1);
    }

    siteId = siteRow.id;
    console.log(`Resolved ${arg} → site ${siteId}`);
  }

  // ── Read current state so we show what's about to change ─────────────
  const { data: before, error: readErr } = await supabase
    .from("sites")
    .select(
      "id, name, owner_id, domain_status, requested_domain, domain_auth_code, domain_notes, domain_decided_at, requested_email_prefix, domain_setup_status, domain_setup_started_at, domain_setup_error, domain_nameservers, domain",
    )
    .eq("id", siteId)
    .maybeSingle();

  if (readErr || !before) {
    console.error("Site not found:", siteId);
    process.exit(1);
  }

  console.log("\nSite:", before.name, `(${before.id})`);
  console.log("─".repeat(60));
  console.log("BEFORE:");
  console.log("  domain_status            :", before.domain_status ?? "—");
  console.log("  requested_domain         :", before.requested_domain ?? "—");
  console.log("  requested_email_prefix   :", before.requested_email_prefix ?? "—");
  console.log("  domain_decided_at        :", before.domain_decided_at ?? "—");
  console.log("  domain_auth_code         :", before.domain_auth_code ?? "—");
  console.log("  domain_setup_status      :", before.domain_setup_status ?? "—");
  console.log("  domain_setup_started_at  :", before.domain_setup_started_at ?? "—");
  console.log("  domain_setup_error       :", before.domain_setup_error ?? "—");
  console.log("  domain (verified)        :", before.domain ?? "— (will be preserved)");

  if (!confirm) {
    console.log("\n(dry-run — nothing changed)");
    console.log("Run with --confirm to apply the reset:");
    console.log(`  npx tsx scripts/reset-site-domain.ts ${arg} --confirm`);
    process.exit(0);
  }

  const { error: updErr } = await supabase
    .from("sites")
    .update({
      domain_status: "none",
      requested_domain: null,
      domain_auth_code: null,
      domain_notes: null,
      domain_decided_at: null,
      requested_email_prefix: null,
      domain_setup_status: null,
      domain_setup_started_at: null,
      domain_setup_error: null,
      domain_nameservers: null,
    })
    .eq("id", siteId);

  if (updErr) {
    console.error("Update failed:", updErr.message);
    process.exit(1);
  }

  console.log("\n✓ Domain state cleared. Reload /client/domain — should look fresh.");
}

main();
