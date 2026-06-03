/**
 * Diagnose why legacy proposals are still appearing in /tech/proposals
 * even though we filter by sites.last_published_at + deployments.deploy_status='live'.
 *
 * Lists:
 *   1. All distinct deploy_status values in the deployments table + counts
 *   2. Every proposal currently in the build queue (= NOT in publishedProposalIds)
 *      with their site + deployment state, so we see why they slip through.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 1. What deploy_status values exist?
  console.log("━".repeat(70));
  console.log("DEPLOY_STATUS values in deployments table:");
  console.log("━".repeat(70));
  const { data: allDeployments } = await supabase
    .from("deployments")
    .select("deploy_status, proposal_id, site_id");
  const statusCounts: Record<string, number> = {};
  const statusWithProposalId: Record<string, number> = {};
  for (const d of allDeployments ?? []) {
    const s = d.deploy_status ?? "(null)";
    statusCounts[s] = (statusCounts[s] || 0) + 1;
    if (d.proposal_id) statusWithProposalId[s] = (statusWithProposalId[s] || 0) + 1;
  }
  for (const [status, count] of Object.entries(statusCounts)) {
    const withPid = statusWithProposalId[status] || 0;
    console.log(`  ${status.padEnd(20)} count=${count}  (with proposal_id=${withPid})`);
  }

  // 2. Replicate the actual filter the page uses.
  const [{ data: publishedSiteRows }, { data: liveDeployRows }] =
    await Promise.all([
      supabase
        .from("sites")
        .select("proposal_id")
        .not("proposal_id", "is", null)
        .not("last_published_at", "is", null),
      supabase
        .from("deployments")
        .select("proposal_id")
        .eq("deploy_status", "live")
        .not("proposal_id", "is", null),
    ]);
  const publishedProposalIds = new Set<string>();
  for (const r of publishedSiteRows ?? []) {
    if (r.proposal_id) publishedProposalIds.add(r.proposal_id as string);
  }
  for (const r of liveDeployRows ?? []) {
    if (r.proposal_id) publishedProposalIds.add(r.proposal_id as string);
  }

  console.log(`\nProposals classified as PUBLISHED: ${publishedProposalIds.size}`);
  console.log(`  via sites.last_published_at: ${publishedSiteRows?.length ?? 0}`);
  console.log(`  via deployments.deploy_status='live': ${liveDeployRows?.length ?? 0}`);

  // 3. Get proposals currently in the build queue.
  const { data: proposals } = await supabase
    .from("proposals")
    .select("id, company_name, status, created_at")
    .order("created_at", { ascending: false });

  const inQueue = (proposals ?? []).filter(p => !publishedProposalIds.has(p.id));
  console.log(`\nProposals showing in /tech/proposals queue: ${inQueue.length}`);
  console.log("━".repeat(70));

  // 4. For each queue proposal, fetch its site + deployment state.
  const proposalIds = inQueue.map(p => p.id);
  if (proposalIds.length === 0) {
    console.log("(none)");
    return;
  }

  const { data: sites } = await supabase
    .from("sites")
    .select("id, proposal_id, name, last_published_at, is_legacy, site_url")
    .in("proposal_id", proposalIds);
  const { data: deployments } = await supabase
    .from("deployments")
    .select("proposal_id, deploy_status, deployment_url, created_at")
    .in("proposal_id", proposalIds)
    .order("created_at", { ascending: false });

  const sitesByProposal = new Map<string, typeof sites>();
  for (const s of sites ?? []) {
    if (!s.proposal_id) continue;
    const list = sitesByProposal.get(s.proposal_id) ?? [];
    list.push(s as never);
    sitesByProposal.set(s.proposal_id, list);
  }
  const deploysByProposal = new Map<string, typeof deployments>();
  for (const d of deployments ?? []) {
    if (!d.proposal_id) continue;
    const list = deploysByProposal.get(d.proposal_id) ?? [];
    list.push(d as never);
    deploysByProposal.set(d.proposal_id, list);
  }

  for (const p of inQueue) {
    const ss = sitesByProposal.get(p.id) ?? [];
    const dd = deploysByProposal.get(p.id) ?? [];
    console.log(
      `\n${p.id.slice(0, 8)}  ${(p.company_name ?? "—").padEnd(30)}  status=${p.status}  created=${p.created_at?.slice(0, 10)}`,
    );
    if (ss.length === 0) console.log(`    sites:        (none)`);
    for (const s of ss) {
      console.log(
        `    site:         ${s.id?.slice(0, 8)}  legacy=${s.is_legacy ? "Y" : "N"}  last_published_at=${s.last_published_at ?? "—"}  site_url=${s.site_url ?? "—"}`,
      );
    }
    if (dd.length === 0) console.log(`    deployments:  (none)`);
    for (const d of dd) {
      console.log(
        `    deployment:   status="${d.deploy_status}"  url=${d.deployment_url ?? "—"}  created=${d.created_at}`,
      );
    }
  }
}

main();
