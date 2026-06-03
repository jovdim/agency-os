/**
 * Dump everything we know about ONE proposal: its row, its site(s), and
 * any deployments. Used to debug "why is this proposal in the build
 * queue when I think it's already published."
 *
 * Usage: npx tsx scripts/probe-one-proposal.ts <proposal-id>
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: npx tsx scripts/probe-one-proposal.ts <proposal-id>");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log("━".repeat(70));
  console.log("PROPOSAL");
  console.log("━".repeat(70));
  const { data: proposal } = await supabase
    .from("proposals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!proposal) {
    console.log("(not found)");
    process.exit(1);
  }
  for (const [k, v] of Object.entries(proposal)) {
    if (v === null || v === "") continue;
    const display =
      typeof v === "string" && v.length > 100 ? v.slice(0, 100) + "…" : v;
    console.log(`  ${k.padEnd(30)} ${JSON.stringify(display)}`);
  }

  console.log("\n" + "━".repeat(70));
  console.log("SITES (sites.proposal_id = X)");
  console.log("━".repeat(70));
  const { data: sites } = await supabase
    .from("sites")
    .select("*")
    .eq("proposal_id", id);
  if (!sites || sites.length === 0) {
    console.log("(no site rows)");
  } else {
    for (const s of sites) {
      console.log(`\n  site ${s.id}`);
      for (const [k, v] of Object.entries(s)) {
        if (v === null || v === "" || k === "id") continue;
        const display =
          typeof v === "string" && v.length > 100 ? v.slice(0, 100) + "…" : v;
        console.log(`    ${k.padEnd(28)} ${JSON.stringify(display)}`);
      }
    }
  }

  console.log("\n" + "━".repeat(70));
  console.log("DEPLOYMENTS (deployments.proposal_id = X)");
  console.log("━".repeat(70));
  const { data: deployments } = await supabase
    .from("deployments")
    .select("*")
    .eq("proposal_id", id);
  if (!deployments || deployments.length === 0) {
    console.log("(no deployment rows)");
  } else {
    for (const d of deployments) {
      console.log(`\n  deployment ${d.id}`);
      for (const [k, v] of Object.entries(d)) {
        if (v === null || v === "" || k === "id") continue;
        console.log(`    ${k.padEnd(28)} ${JSON.stringify(v)}`);
      }
    }
  }

  if (sites && sites.length > 0) {
    console.log("\n" + "━".repeat(70));
    console.log("DEPLOYMENTS via site_id (in case proposal_id was nulled)");
    console.log("━".repeat(70));
    const siteIds = sites.map((s) => s.id);
    const { data: depBySite } = await supabase
      .from("deployments")
      .select("*")
      .in("site_id", siteIds);
    if (!depBySite || depBySite.length === 0) {
      console.log("(none)");
    } else {
      for (const d of depBySite) {
        console.log(`\n  deployment ${d.id}`);
        for (const [k, v] of Object.entries(d)) {
          if (v === null || v === "" || k === "id") continue;
          console.log(`    ${k.padEnd(28)} ${JSON.stringify(v)}`);
        }
      }
    }
  }
}

main();
