/**
 * Show every related row for a proposal across the tables that depend on it.
 * Used to plan a safe delete: payments / invoices / emails / reminders / commissions /
 * any audit-log mentions.
 *
 * Usage: npx tsx scripts/probe-proposal-related.ts <proposal-id>
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: npx tsx scripts/probe-proposal-related.ts <proposal-id>");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const tables = [
    "proposal_emails",
    "proposal_reminders",
    "payments",
    "invoices",
    "commissions",
    "site_versions",
  ];

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("proposal_id", id);
    if (error) {
      console.log(`[${table}] ERROR: ${error.message}`);
      continue;
    }
    console.log(`[${table}] ${data?.length ?? 0} row(s)`);
    for (const r of data ?? []) {
      const summary = JSON.stringify(r).slice(0, 200);
      console.log(`  ${summary}${summary.length >= 200 ? "…" : ""}`);
    }
  }
}

main();
