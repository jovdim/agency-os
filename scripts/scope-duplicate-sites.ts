/**
 * Read-only: scope the duplicate-site clutter. Groups sites by proposal_id
 * and flags proposals that own more than one site row — the composer
 * auto-create-duplicate fallout. For each duplicate group, reports how many
 * are published vs draft, and which single row we'd KEEP (the published one,
 * else the most recently touched) vs DELETE.
 *
 * Changes nothing. Run: npx tsx scripts/scope-duplicate-sites.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const env: Record<string, string> = {};
for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: sites } = await admin
    .from("sites")
    .select("id, name, subdomain, proposal_id, owner_id, last_published_at, created_at, updated_at")
    .not("proposal_id", "is", null);
  if (!sites?.length) {
    console.log("No sites with a proposal_id.");
    return;
  }

  const byProposal = new Map<string, typeof sites>();
  for (const s of sites) {
    const arr = byProposal.get(s.proposal_id!) ?? [];
    arr.push(s);
    byProposal.set(s.proposal_id!, arr);
  }

  let totalDup = 0;
  let totalDeletable = 0;
  const groups = [...byProposal.entries()].filter(([, arr]) => arr.length > 1);
  groups.sort((a, b) => b[1].length - a[1].length);

  console.log(`\n=== ${groups.length} proposal(s) own >1 site row ===\n`);
  for (const [proposalId, arr] of groups) {
    const published = arr.filter((s) => s.last_published_at);
    // Keep rule: a published row if any (most recent), else most recently updated.
    const keep =
      [...published].sort(
        (a, b) => new Date(b.last_published_at!).getTime() - new Date(a.last_published_at!).getTime(),
      )[0] ??
      [...arr].sort(
        (a, b) =>
          new Date(b.updated_at ?? b.created_at ?? 0).getTime() -
          new Date(a.updated_at ?? a.created_at ?? 0).getTime(),
      )[0];
    const deletable = arr.filter((s) => s.id !== keep.id);
    totalDup += arr.length;
    totalDeletable += deletable.length;
    const name = arr[0].name ?? arr[0].subdomain ?? proposalId;
    console.log(
      `${name}  (proposal ${proposalId.slice(0, 8)})  total=${arr.length}  published=${published.length}  KEEP=${keep.id.slice(0, 8)}${keep.last_published_at ? " [published]" : " [draft]"}  delete=${deletable.length}`,
    );
  }

  console.log("\n=== SUMMARY ===");
  console.log(`duplicate groups:        ${groups.length}`);
  console.log(`site rows in groups:     ${totalDup}`);
  console.log(`would DELETE (drafts):   ${totalDeletable}`);
  console.log(`would KEEP:              ${groups.length}`);
  console.log("\nNOTE: read-only. No deletes performed. Published rows are always kept.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
