/**
 * One-shot backfill: provision a client auth user + reassign sites.owner_id
 * for every published proposal whose site is still owned by a non-client
 * (tech_admin / sales) profile.
 *
 * Context: ensureClientZone() runs automatically on every publish (since
 * 2026-05-23). Sites published BEFORE that auto-trigger was added were
 * left with owner_id pointing at the IT/sales builder, which means the
 * client zone shows "Vaša webstránka sa pripravuje" instead of their
 * actual site after auto-login.
 *
 * This script walks every published site, finds the ones with a
 * non-client owner, and runs the same ensureClientZone() helper the
 * publish route uses. Idempotent — sites already owned by a client are
 * skipped without touching anything.
 *
 * Usage:
 *   npx tsx scripts/backfill-client-zones.ts            # dry-run (default)
 *   npx tsx scripts/backfill-client-zones.ts --apply    # actually run
 *
 * Dry-run prints the per-row plan (skip / fix / fail) without writing.
 * Run with --apply once the dry-run output looks right.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { ensureClientZone } from "../src/lib/proposals/ensure-client-zone";

config({ path: ".env.local" });

async function main() {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY" : "DRY-RUN";

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  console.log(`[${mode}] Scanning published sites for non-client owners…\n`);

  // 1) Pull every published site with a linked proposal.
  const { data: sites, error: sitesErr } = await supabase
    .from("sites")
    .select("id, proposal_id, owner_id, last_published_at, name")
    .not("last_published_at", "is", null)
    .not("proposal_id", "is", null)
    .order("last_published_at", { ascending: true });

  if (sitesErr) {
    console.error("Failed to list sites:", sitesErr.message);
    process.exit(1);
  }

  if (!sites || sites.length === 0) {
    console.log("No published sites found. Nothing to do.");
    return;
  }

  // 2) Bulk-fetch owner roles in one query so we don't N+1 the lookup.
  // (profiles table has no `email` column — auth email lives on auth.users.
  // We only need `role` to decide whether each site is already client-owned.)
  const ownerIds = Array.from(new Set(sites.map((s) => s.owner_id).filter(Boolean)));
  const { data: owners } = await supabase
    .from("profiles")
    .select("id, role")
    .in("id", ownerIds);
  const ownerRoleById = new Map<string, { role: string }>();
  for (const o of owners || []) {
    ownerRoleById.set(o.id, { role: o.role });
  }

  // 3) Split into already-fine vs needs-backfill.
  const needsFix = sites.filter((s) => {
    const owner = ownerRoleById.get(s.owner_id);
    return !owner || owner.role !== "client";
  });
  const alreadyOk = sites.length - needsFix.length;

  console.log(`Total published sites      : ${sites.length}`);
  console.log(`Already client-owned (skip): ${alreadyOk}`);
  console.log(`Needs backfill             : ${needsFix.length}`);
  console.log("");

  if (needsFix.length === 0) {
    console.log("Nothing to backfill. Done.");
    return;
  }

  // 4) Per-row plan / execution.
  let fixed = 0;
  let failed = 0;
  for (const site of needsFix) {
    const owner = ownerRoleById.get(site.owner_id);
    const ownerLabel = owner ? `${owner.role}` : "<no profile>";
    const tag = `  • ${site.name ?? site.id} (proposal=${site.proposal_id}, currently owned by ${ownerLabel})`;

    if (!apply) {
      console.log(`${tag} → would fix`);
      continue;
    }

    try {
      // Pass starterCreditEur=0 so we don't grant the 37.50 € starter
      // credit retroactively to clients whose sites have been live for
      // months. Their credit history was already set when the site was
      // originally provisioned (or they've been topped up manually);
      // a backfill shouldn't dump free euros on them.
      const result = await ensureClientZone(site.proposal_id, {
        starterCreditEur: 0,
      });
      if (result.ok) {
        console.log(`${tag} → fixed (email=${result.email})`);
        fixed++;
      } else {
        console.log(`${tag} → FAILED: ${result.error}`);
        failed++;
      }
    } catch (err) {
      console.log(
        `${tag} → THREW: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }

  console.log("");
  if (apply) {
    console.log(`Done. Fixed: ${fixed}, failed: ${failed}.`);
    if (failed > 0) {
      console.log(
        "Re-run after fixing the failure reasons above. ensureClientZone is idempotent.",
      );
    }
  } else {
    console.log(
      `Dry-run only. Re-run with --apply to actually backfill ${needsFix.length} sites.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
