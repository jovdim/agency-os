/**
 * Exact replica of the /tech/proposals filter logic.
 * Verifies whether SaFi stav (and others in the build queue UI) really
 * are being excluded by the publish-state filter when run server-side.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const SAFI_ID = "554e9e31-9f03-4498-9a2e-e4e1cdf13b91";

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 1. Exact same two queries as src/app/(dashboard)/tech/proposals/page.tsx
  const [{ data: publishedSiteRows, error: e1 }, { data: liveDeployRows, error: e2 }] =
    await Promise.all([
      sb.from("sites")
        .select("proposal_id")
        .not("proposal_id", "is", null)
        .not("last_published_at", "is", null),
      sb.from("deployments")
        .select("proposal_id")
        .eq("deploy_status", "live")
        .not("proposal_id", "is", null),
    ]);

  if (e1) console.error("sites query err:", e1);
  if (e2) console.error("deployments query err:", e2);

  const publishedProposalIds = new Set<string>();
  for (const r of publishedSiteRows ?? []) {
    if (r.proposal_id) publishedProposalIds.add(r.proposal_id as string);
  }
  for (const r of liveDeployRows ?? []) {
    if (r.proposal_id) publishedProposalIds.add(r.proposal_id as string);
  }

  console.log("Total published proposal_ids:", publishedProposalIds.size);
  console.log("Is SaFi stav in published set?:", publishedProposalIds.has(SAFI_ID) ? "✓ YES (excluded from queue)" : "✗ NO (will appear in queue)");

  // 2. Same proposal fetch
  const { data: proposals } = await sb
    .from("proposals")
    .select("id, company_name, updated_at")
    .order("updated_at", { ascending: false });

  const buildQueue = (proposals ?? []).filter(
    (p) => !publishedProposalIds.has(p.id),
  );

  console.log(`\nBuild queue size: ${buildQueue.length}`);
  console.log("\nFirst 30 in queue (by updated_at):");
  for (const p of buildQueue.slice(0, 30)) {
    const tag = p.id === SAFI_ID ? "  ← SAFI STAV!" : "";
    console.log(`  ${p.id.slice(0, 8)}  ${p.company_name?.padEnd(35) ?? "—"}${tag}`);
  }

  // 3. Confirm SaFi's raw DB state one more time
  console.log("\n" + "━".repeat(60));
  console.log("SAFI STAV raw DB check:");
  const { data: site } = await sb
    .from("sites")
    .select("id, last_published_at, status, site_url, is_legacy")
    .eq("proposal_id", SAFI_ID);
  const { data: dep } = await sb
    .from("deployments")
    .select("id, deploy_status, proposal_id")
    .eq("proposal_id", SAFI_ID);
  console.log("  sites rows:", site);
  console.log("  deployments rows:", dep);
}

main();
