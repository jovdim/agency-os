/**
 * Delete test proposals + their linked site + dependent rows.
 *
 * Usage:
 *   npx tsx scripts/delete-test-proposals.ts              # dry-run (shows what would be hit)
 *   npx tsx scripts/delete-test-proposals.ts --confirm    # actually delete
 *
 * What gets deleted per proposal ID:
 *   1. Linked site row (sites.proposal_id = X)
 *   2. Rows that would otherwise SET NULL and orphan:
 *        - deployments         (by site_id, and by proposal-linked github_repo)
 *        - contact_submissions (by site_id)
 *        - invoices            (by site_id, payment_id)
 *        - payments            (by proposal_id OR site_id)
 *   3. The proposal row itself
 *      CASCADE auto-cleans: proposal_messages, proposal_reminders, proposal_emails,
 *      proposal_tag_assignments, ai_generations(by proposal), sections,
 *      change_requests, credit_balances, credit_transactions, services, site_versions
 *
 * NOT touched:
 *   - profiles (client account auth user) - lives in auth.users + profiles, can be
 *     orphaned safely; only visible under /super/users
 *   - commissions (SET NULL on proposal/payment delete) - already nulled if any exist
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const PROPOSAL_IDS = [
  "7e56b512-340d-4387-9422-0a8d0722618c", // stavgaraz — building, never deployed
];

const CONFIRM = process.argv.includes("--confirm");

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log(
    `\n${CONFIRM ? "🔴 DELETE MODE" : "🟢 DRY-RUN"} — ${PROPOSAL_IDS.length} proposal IDs\n`,
  );

  let okCount = 0;
  let skipCount = 0;
  const errors: string[] = [];

  for (const pid of PROPOSAL_IDS) {
    console.log("─".repeat(72));
    console.log("proposal :", pid);

    // 1. Read proposal
    const { data: proposal, error: pErr } = await supabase
      .from("proposals")
      .select("id, company_name, status, created_at")
      .eq("id", pid)
      .maybeSingle();

    if (pErr) {
      errors.push(`${pid}: read proposal failed — ${pErr.message}`);
      console.log("  ✗ read failed:", pErr.message);
      continue;
    }
    if (!proposal) {
      console.log("  ⚠ proposal not found — skipping");
      skipCount++;
      continue;
    }
    console.log(
      `  company: ${proposal.company_name ?? "—"}  status: ${proposal.status}  created: ${proposal.created_at}`,
    );

    // 2. Find linked sites
    const { data: sites, error: sErr } = await supabase
      .from("sites")
      .select("id, name, subdomain, last_published_at, is_paid")
      .eq("proposal_id", pid);

    if (sErr) {
      errors.push(`${pid}: read sites failed — ${sErr.message}`);
      console.log("  ✗ read sites failed:", sErr.message);
      continue;
    }
    const siteIds = (sites ?? []).map((s) => s.id);
    console.log(`  sites linked: ${siteIds.length}`);
    for (const s of sites ?? []) {
      console.log(
        `    └─ ${s.id}  sub:${s.subdomain ?? "—"}  pub:${s.last_published_at ? "yes" : "no"}  paid:${s.is_paid ? "yes" : "no"}`,
      );
    }

    // 3. Counts of dependents for visibility
    const counts: Record<string, number> = {};
    async function countRows(table: string, filter: (q: any) => any) {
      const { count, error } = await filter(
        supabase.from(table).select("*", { count: "exact", head: true }),
      );
      if (error) {
        counts[table] = -1;
        return;
      }
      counts[table] = count ?? 0;
    }

    await Promise.all([
      countRows("payments", (q) => q.eq("proposal_id", pid)),
      countRows("proposal_messages", (q) => q.eq("proposal_id", pid)),
      countRows("proposal_reminders", (q) => q.eq("proposal_id", pid)),
      countRows("proposal_tag_assignments", (q) => q.eq("proposal_id", pid)),
      countRows("ai_generations", (q) => q.eq("proposal_id", pid)),
    ]);
    if (siteIds.length) {
      await Promise.all([
        countRows("deployments", (q) => q.in("site_id", siteIds)),
        countRows("contact_submissions", (q) => q.in("site_id", siteIds)),
        countRows("invoices", (q) => q.in("site_id", siteIds)),
        countRows("sections", (q) => q.in("site_id", siteIds)),
        countRows("change_requests", (q) => q.in("site_id", siteIds)),
        countRows("credit_transactions", (q) => q.in("site_id", siteIds)),
        countRows("site_versions", (q) => q.in("site_id", siteIds)),
      ]);
    }

    console.log("  dependents:");
    for (const [k, v] of Object.entries(counts)) {
      if (v > 0) console.log(`    ${k}: ${v}`);
    }
    if (Object.values(counts).every((v) => v === 0)) {
      console.log("    (none)");
    }

    if (!CONFIRM) {
      console.log("  (dry-run — nothing deleted)");
      okCount++;
      continue;
    }

    // 4. Actual deletion order (most-dependent first)
    try {
      // Per-site dependents that SET NULL and would orphan
      if (siteIds.length) {
        for (const t of [
          "deployments",
          "contact_submissions",
          "invoices",
        ]) {
          const { error } = await supabase
            .from(t)
            .delete()
            .in("site_id", siteIds);
          if (error) throw new Error(`delete ${t}: ${error.message}`);
        }
      }

      // Payments — referenced both by proposal_id and site_id (SET NULL)
      const paymentsFilter = supabase.from("payments").delete();
      if (siteIds.length) {
        const { error } = await paymentsFilter.or(
          `proposal_id.eq.${pid},site_id.in.(${siteIds.join(",")})`,
        );
        if (error) throw new Error(`delete payments: ${error.message}`);
      } else {
        const { error } = await paymentsFilter.eq("proposal_id", pid);
        if (error) throw new Error(`delete payments: ${error.message}`);
      }

      // Sites — CASCADE wipes sections, change_requests, credit_balances,
      // credit_transactions, services, site_versions, ai_generations(by site)
      if (siteIds.length) {
        const { error } = await supabase
          .from("sites")
          .delete()
          .in("id", siteIds);
        if (error) throw new Error(`delete sites: ${error.message}`);
      }

      // Proposal — CASCADE wipes proposal_messages, proposal_reminders,
      // proposal_emails, proposal_tag_assignments, ai_generations(by proposal)
      const { error: pDelErr } = await supabase
        .from("proposals")
        .delete()
        .eq("id", pid);
      if (pDelErr) throw new Error(`delete proposal: ${pDelErr.message}`);

      console.log("  ✓ deleted");
      okCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${pid}: ${msg}`);
      console.log("  ✗ FAILED:", msg);
    }
  }

  console.log("─".repeat(72));
  console.log(
    `\n${CONFIRM ? "deleted" : "would delete"}: ${okCount}   skipped: ${skipCount}   errors: ${errors.length}`,
  );
  if (errors.length) {
    console.log("\nErrors:");
    for (const e of errors) console.log("  -", e);
    process.exit(1);
  }
  if (!CONFIRM) {
    console.log(
      "\nRun again with --confirm to actually delete:\n  npx tsx scripts/delete-test-proposals.ts --confirm\n",
    );
  }
}

main();
