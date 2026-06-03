/**
 * Backfill legacy-deployed proposals that are missing publish records.
 *
 * Some old proposals were built + deployed manually OR via an older
 * pipeline that didn't write to `sites.last_published_at` or
 * `deployments`. The system therefore thinks they're unbuilt and keeps
 * them in /tech/proposals. This script records them as published so
 * they move to /tech/production.
 *
 * Fill in PAIRS below — one entry per legacy proposal. Match by EITHER
 * company name (case-insensitive substring) or proposal_id (full UUID).
 * The URL must be the actual live URL of the site.
 *
 * Usage:
 *   npx tsx scripts/backfill-legacy-published.ts              # dry-run
 *   npx tsx scripts/backfill-legacy-published.ts --confirm    # apply
 *
 * For each pair, we:
 *   1. Find the proposal row (by id or fuzzy company name match).
 *   2. Ensure a sites row exists for it (create one if missing).
 *   3. Set sites.site_url + last_published_at + is_legacy=true + status='live'.
 *   4. Insert a deployments row with deploy_status='live' (if none exists).
 *
 * Idempotent: re-running on already-backfilled proposals is a no-op.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

// ─── EDIT THIS LIST ────────────────────────────────────────────────────
// Add one entry per legacy proposal. `key` can be the company name (any
// case, partial match) OR a full proposal UUID. `url` is the live site.
const PAIRS: { key: string; url: string }[] = [
  // example:
  // { key: "Branislav",            url: "https://branislav.2dni.sk" },
  // { key: "Mirek",                url: "https://mirek.2dni.sk" },
  // { key: "MV Construction",      url: "https://mv-construction.2dni.sk" },
  // { key: "Palermo Decor",        url: "https://palermo.2dni.sk" },
  // ...
];
// ───────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFIRM = process.argv.includes("--confirm");

async function main() {
  if (PAIRS.length === 0) {
    console.error(
      "No pairs configured. Open this file and fill in the PAIRS array.",
    );
    process.exit(1);
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log(
    `\n${CONFIRM ? "🔴 BACKFILL MODE" : "🟢 DRY-RUN"} — ${PAIRS.length} legacy proposals\n`,
  );

  // Pre-load all proposals so we can do fuzzy name lookups cheaply.
  const { data: allProposals } = await sb
    .from("proposals")
    .select("id, company_name, status");
  const allP = allProposals ?? [];

  let ok = 0;
  let skip = 0;
  const errors: string[] = [];

  for (const pair of PAIRS) {
    console.log("─".repeat(72));
    console.log(`key: ${pair.key}  →  ${pair.url}`);

    // Resolve to a single proposal
    let proposal: { id: string; company_name: string; status: string } | null = null;
    if (UUID_RE.test(pair.key)) {
      proposal = allP.find((p) => p.id === pair.key) ?? null;
    } else {
      const matches = allP.filter((p) =>
        (p.company_name ?? "").toLowerCase().includes(pair.key.toLowerCase()),
      );
      if (matches.length === 1) {
        proposal = matches[0];
      } else if (matches.length > 1) {
        errors.push(
          `"${pair.key}" matched ${matches.length} proposals — use a more specific name or paste the UUID. Matches: ${matches.map((m) => `${m.id.slice(0, 8)}=${m.company_name}`).join("; ")}`,
        );
        console.log("  ✗ ambiguous (multiple matches)");
        continue;
      }
    }

    if (!proposal) {
      errors.push(`"${pair.key}" — no proposal found`);
      console.log("  ✗ proposal not found");
      continue;
    }

    console.log(
      `  proposal: ${proposal.id.slice(0, 8)}  ${proposal.company_name}  status=${proposal.status}`,
    );

    // Check existing site + deployment state so we know what we're changing.
    const { data: existingSites } = await sb
      .from("sites")
      .select("id, name, site_url, last_published_at, is_legacy, status, owner_id")
      .eq("proposal_id", proposal.id);
    const existingSite = (existingSites ?? [])[0] ?? null;

    const { data: existingDeploys } = await sb
      .from("deployments")
      .select("id, deploy_status")
      .eq("proposal_id", proposal.id);
    const hasLiveDeploy = (existingDeploys ?? []).some(
      (d) => d.deploy_status === "live",
    );

    console.log(
      `  current site:        ${existingSite ? `${existingSite.id.slice(0, 8)} (url=${existingSite.site_url ?? "—"}, legacy=${existingSite.is_legacy ? "Y" : "N"})` : "(none)"}`,
    );
    console.log(
      `  current deployments: ${(existingDeploys ?? []).length} (live? ${hasLiveDeploy ? "yes" : "no"})`,
    );

    if (
      existingSite?.site_url === pair.url &&
      existingSite?.last_published_at &&
      hasLiveDeploy
    ) {
      console.log("  ✓ already backfilled — skipping");
      skip++;
      continue;
    }

    if (!CONFIRM) {
      console.log("  (dry-run — would update site + insert deployment)");
      ok++;
      continue;
    }

    try {
      const now = new Date().toISOString();

      // 1. Ensure site row exists + has the right fields.
      if (existingSite) {
        const { error } = await sb
          .from("sites")
          .update({
            site_url: pair.url,
            last_published_at: existingSite.last_published_at ?? now,
            is_legacy: true,
            status: "live",
          })
          .eq("id", existingSite.id);
        if (error) throw new Error(`update site: ${error.message}`);
      } else {
        // Need owner_id — fall back to the sales_person_id from the proposal
        // since we have no client account for this legacy site. This isn't
        // perfect (the IT team will see "Owner: salesperson") but it lets
        // the row exist so the proposal correctly classifies as published.
        const { data: prop } = await sb
          .from("proposals")
          .select("sales_person_id, company_name")
          .eq("id", proposal.id)
          .single();
        if (!prop?.sales_person_id) {
          throw new Error("proposal has no sales_person_id — can't set site owner");
        }
        const { error } = await sb.from("sites").insert({
          proposal_id: proposal.id,
          owner_id: prop.sales_person_id,
          name: prop.company_name ?? "Legacy site",
          slug:
            (prop.company_name ?? "legacy")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "") || "legacy",
          site_url: pair.url,
          last_published_at: now,
          is_legacy: true,
          status: "live",
        });
        if (error) throw new Error(`insert site: ${error.message}`);
      }

      // 2. Ensure a 'live' deployment row exists.
      if (!hasLiveDeploy) {
        const { error } = await sb.from("deployments").insert({
          proposal_id: proposal.id,
          github_repo: "legacy-backfill",
          github_url: pair.url, // best we have
          cloudflare_project_id: "legacy-backfill",
          subdomain: new URL(pair.url).hostname.split(".")[0],
          deploy_status: "live",
          deployed_at: now,
          deployment_url: pair.url,
        } as never);
        if (error) throw new Error(`insert deployment: ${error.message}`);
      }

      console.log("  ✓ backfilled");
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${pair.key}: ${msg}`);
      console.log("  ✗ FAILED:", msg);
    }
  }

  console.log("─".repeat(72));
  console.log(
    `\n${CONFIRM ? "backfilled" : "would backfill"}: ${ok}   skipped: ${skip}   errors: ${errors.length}`,
  );
  if (errors.length) {
    console.log("\nErrors:");
    for (const e of errors) console.log("  -", e);
    process.exit(1);
  }
  if (!CONFIRM) {
    console.log(
      "\nRun with --confirm to apply:\n  npx tsx scripts/backfill-legacy-published.ts --confirm\n",
    );
  }
}

main();
