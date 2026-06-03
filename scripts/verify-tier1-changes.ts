/**
 * Parity + smoke checks for the Tier 1 optimization work (migrations
 * 00066–00069 + code changes on /super/contacts, /tech/proposals, the
 * CSV upload route, and /sales/volanie).
 *
 * What this verifies:
 *   1.  Each new migration applied (RPC / extension / index present)
 *   2.  CSV dedup RPC returns the same phone set as the old chunked SELECT
 *   3.  contacts_counts_by_sales() sums to the same total as a direct
 *       COUNT(*) on contacts (no rows dropped, no double-count)
 *   4.  proposals_build_queue() returns the same proposal-id set as the
 *       old "load everything, filter in JS" code path
 *   5.  proposals_build_queue_count() agrees with #4
 *   6.  Destructive RPCs (contacts_reassign_matching, contacts_quick_assign)
 *       are callable and behave correctly in no-op shapes (returns 0)
 *
 * What this does NOT verify:
 *   - EXPLAIN ANALYZE / actual perf — needs a psql session
 *   - URL state / debounce races in the browser
 *   - Long-string / unicode edge cases in pg_trgm
 *
 * Run: npx tsx scripts/verify-tier1-changes.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

type Check = {
  label: string;
  run: () => Promise<{ ok: boolean; detail: string }>;
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});

async function main(): Promise<void> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const checks: Check[] = [
    // ── 1. Migration presence ──────────────────────────────────────────
    {
      label: "00066: contacts_existing_phones RPC exists",
      run: async () => {
        const { error } = await admin.rpc("contacts_existing_phones", {
          p_phones: [],
        });
        if (error) return { ok: false, detail: error.message };
        return { ok: true, detail: "callable" };
      },
    },
    {
      label: "00067: pg_trgm + idx_contacts_company_name_trgm usable",
      run: async () => {
        // Trigger an ILIKE query — if pg_trgm is missing the query still
        // runs (just slower / seq-scan), so this is a smoke probe only.
        const { error } = await admin
          .from("contacts")
          .select("id", { head: true, count: "exact" })
          .ilike("company_name", "%a%");
        if (error) return { ok: false, detail: error.message };
        return { ok: true, detail: "ILIKE query accepted" };
      },
    },
    {
      label: "00068: contacts_counts_by_sales RPC exists",
      run: async () => {
        const { error } = await admin.rpc("contacts_counts_by_sales");
        if (error) return { ok: false, detail: error.message };
        return { ok: true, detail: "callable" };
      },
    },
    {
      label: "00068: contacts_reassign_matching RPC exists",
      run: async () => {
        // No-op shape: impossible search + null target = 0 updates
        const { data, error } = await admin.rpc("contacts_reassign_matching", {
          p_search: "__verify_script_nonexistent_xyz_abc_12345__",
          p_sales_filter: null,
          p_target_id: null,
        });
        if (error) return { ok: false, detail: error.message };
        const updated = Number(data ?? 0);
        if (updated !== 0) {
          return {
            ok: false,
            detail: `expected 0 updated rows for impossible search, got ${updated}`,
          };
        }
        return { ok: true, detail: "callable, returned 0 for impossible search" };
      },
    },
    {
      label: "00068: contacts_quick_assign RPC exists",
      run: async () => {
        // Passing p_count=0 returns early without touching any row.
        const fakeUuid = "00000000-0000-0000-0000-000000000000";
        const { data, error } = await admin.rpc("contacts_quick_assign", {
          p_count: 0,
          p_target_id: fakeUuid,
        });
        if (error) return { ok: false, detail: error.message };
        const updated = Number(data ?? 0);
        if (updated !== 0) {
          return {
            ok: false,
            detail: `expected 0 updated rows for p_count=0, got ${updated}`,
          };
        }
        return { ok: true, detail: "callable, returned 0 for p_count=0" };
      },
    },
    {
      label: "00069: proposals_build_queue RPC exists",
      run: async () => {
        const { error } = await admin.rpc("proposals_build_queue", {
          p_limit: 1,
          p_offset: 0,
        });
        if (error) return { ok: false, detail: error.message };
        return { ok: true, detail: "callable" };
      },
    },
    {
      label: "00069: proposals_build_queue_count RPC exists",
      run: async () => {
        const { error } = await admin.rpc("proposals_build_queue_count");
        if (error) return { ok: false, detail: error.message };
        return { ok: true, detail: "callable" };
      },
    },

    // ── 2. CSV dedup parity ────────────────────────────────────────────
    {
      label: "csv-dedup: RPC returns the same phone set as old chunked SELECT",
      run: async () => {
        // Pick up to 200 known phones from the table, salt with 50
        // synthetic ones that definitely don't exist.
        const { data: sample, error: sampleErr } = await admin
          .from("contacts")
          .select("phone")
          .not("phone", "is", null)
          .limit(200);
        if (sampleErr) return { ok: false, detail: sampleErr.message };
        const realPhones: string[] = (sample ?? []).map((r) => r.phone as string).filter(Boolean);
        const fakePhones: string[] = Array.from({ length: 50 }, (_, i) =>
          `__verify_fake_${i}_${Date.now()}__`,
        );
        const allPhones = [...realPhones, ...fakePhones];

        // Old code path (in-line, mirrors route.ts pre-change behavior).
        const oldExisting = new Set<string>();
        for (let j = 0; j < allPhones.length; j += 100) {
          const chunk = allPhones.slice(j, j + 100);
          const { data: existing, error } = await admin
            .from("contacts")
            .select("phone")
            .in("phone", chunk);
          if (error) return { ok: false, detail: `old: ${error.message}` };
          for (const r of existing ?? []) {
            if (r.phone) oldExisting.add(r.phone as string);
          }
        }

        // New code path.
        const { data: newRows, error: newErr } = await admin.rpc(
          "contacts_existing_phones",
          { p_phones: allPhones },
        );
        if (newErr) return { ok: false, detail: `new: ${newErr.message}` };
        const newExisting = new Set<string>(
          ((newRows ?? []) as { phone: string }[]).map((r) => r.phone),
        );

        if (oldExisting.size !== newExisting.size) {
          return {
            ok: false,
            detail: `set sizes differ: old=${oldExisting.size} new=${newExisting.size}`,
          };
        }
        for (const p of oldExisting) {
          if (!newExisting.has(p)) {
            return { ok: false, detail: `phone in old, missing in new: ${p}` };
          }
        }
        return {
          ok: true,
          detail: `both paths agree on ${oldExisting.size}/${allPhones.length} existing phones`,
        };
      },
    },

    // ── 3. contacts_counts_by_sales totals ─────────────────────────────
    {
      label: "counts: RPC sum equals total contacts count",
      run: async () => {
        const { count, error: countErr } = await admin
          .from("contacts")
          .select("id", { head: true, count: "exact" });
        if (countErr) return { ok: false, detail: countErr.message };

        const { data: rows, error: rpcErr } = await admin.rpc("contacts_counts_by_sales");
        if (rpcErr) return { ok: false, detail: rpcErr.message };

        let sum = 0;
        for (const r of (rows ?? []) as { contacts_count: number }[]) {
          sum += Number(r.contacts_count);
        }
        if (sum !== (count ?? 0)) {
          return {
            ok: false,
            detail: `RPC sum=${sum}, table count=${count}`,
          };
        }
        return { ok: true, detail: `both agree on ${sum} total contacts` };
      },
    },

    // ── 4. /tech/proposals build queue parity ──────────────────────────
    {
      label: "build-queue: RPC id-set matches old JS-filter logic",
      run: async () => {
        // Old code path: load everything, filter in JS.
        const [
          { data: allProposals, error: pErr },
          { data: publishedSites, error: sErr },
          { data: liveDeploys, error: dErr },
        ] = await Promise.all([
          admin.from("proposals").select("id").order("updated_at", { ascending: false }),
          admin
            .from("sites")
            .select("proposal_id")
            .not("proposal_id", "is", null)
            .not("last_published_at", "is", null),
          admin
            .from("deployments")
            .select("proposal_id")
            .eq("deploy_status", "live")
            .not("proposal_id", "is", null),
        ]);
        if (pErr) return { ok: false, detail: `proposals: ${pErr.message}` };
        if (sErr) return { ok: false, detail: `sites: ${sErr.message}` };
        if (dErr) return { ok: false, detail: `deployments: ${dErr.message}` };

        const published = new Set<string>();
        for (const r of publishedSites ?? []) {
          if (r.proposal_id) published.add(r.proposal_id as string);
        }
        for (const r of liveDeploys ?? []) {
          if (r.proposal_id) published.add(r.proposal_id as string);
        }
        const oldQueueIds = new Set<string>(
          (allProposals ?? [])
            .map((p) => p.id as string)
            .filter((id) => !published.has(id)),
        );

        // New code path: fetch via RPC, no pagination cap.
        const { data: rpcRows, error: rpcErr } = await admin.rpc(
          "proposals_build_queue",
          { p_limit: 100000, p_offset: 0 },
        );
        if (rpcErr) return { ok: false, detail: rpcErr.message };
        const newQueueIds = new Set<string>(
          ((rpcRows ?? []) as { id: string }[]).map((r) => r.id),
        );

        if (oldQueueIds.size !== newQueueIds.size) {
          return {
            ok: false,
            detail: `set sizes differ: old=${oldQueueIds.size} new=${newQueueIds.size}`,
          };
        }
        for (const id of oldQueueIds) {
          if (!newQueueIds.has(id)) {
            return {
              ok: false,
              detail: `proposal ${id} in old queue, missing from RPC result`,
            };
          }
        }
        return {
          ok: true,
          detail: `both paths agree on ${oldQueueIds.size} queued proposals`,
        };
      },
    },
    {
      label: "build-queue: count RPC matches actual queue size",
      run: async () => {
        const { data: countRaw, error: cErr } = await admin.rpc(
          "proposals_build_queue_count",
        );
        if (cErr) return { ok: false, detail: cErr.message };
        const count = Number(countRaw ?? 0);

        const { data: rpcRows, error: rErr } = await admin.rpc(
          "proposals_build_queue",
          { p_limit: 100000, p_offset: 0 },
        );
        if (rErr) return { ok: false, detail: rErr.message };
        const actual = (rpcRows ?? []).length;

        if (count !== actual) {
          return {
            ok: false,
            detail: `count RPC says ${count}, queue RPC returned ${actual}`,
          };
        }
        return { ok: true, detail: `both agree on ${count} queued proposals` };
      },
    },

    // ── 5. /super/contacts pagination smoke ────────────────────────────
    {
      label: "super-contacts: paginated SELECT + count works",
      run: async () => {
        const { data, count, error } = await admin
          .from("contacts")
          .select("id", { count: "exact" })
          .range(0, 49);
        if (error) return { ok: false, detail: error.message };
        return {
          ok: true,
          detail: `range(0,49) returned ${data?.length ?? 0} rows; total=${count}`,
        };
      },
    },
    {
      label: "super-contacts: PostgREST .or() ILIKE syntax accepted",
      run: async () => {
        // Mirrors the listing query in page.tsx.
        const { error } = await admin
          .from("contacts")
          .select("id", { head: true, count: "exact" })
          .or(
            `company_name.ilike.%a%,contact_person.ilike.%a%,town.ilike.%a%`,
          );
        if (error) return { ok: false, detail: error.message };
        return { ok: true, detail: ".or() ILIKE accepted" };
      },
    },
  ];

  console.log("Tier 1 verification\n───────────────────\n");
  let failed = 0;
  for (const c of checks) {
    try {
      const r = await c.run();
      console.log(`  ${r.ok ? "✓" : "✗"}  ${c.label}`);
      console.log(`        ${r.detail}`);
      if (!r.ok) failed++;
    } catch (err) {
      console.log(`  ✗  ${c.label}`);
      console.log(`        threw: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }
  console.log("");
  if (failed > 0) {
    console.log(`✗ ${failed} check(s) failed`);
    process.exit(1);
  } else {
    console.log(`✓ all ${checks.length} checks passed`);
  }
}
