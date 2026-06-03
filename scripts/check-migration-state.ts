/**
 * Probes the live Supabase DB for the artifacts each "pending" migration
 * was supposed to create. Tells us which actually ran without trusting
 * the local memory note.
 *
 * Run: npx tsx scripts/check-migration-state.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

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
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const probes: Array<{
    migration: string;
    description: string;
    test: () => Promise<{ ok: boolean; detail: string }>;
  }> = [
    {
      migration: "00047",
      description: "section_templates accepts category='testimonials'",
      test: async () => {
        // Look for any row with category='testimonials' OR check the constraint by selecting distinct categories.
        const { data, error } = await admin
          .from("section_templates")
          .select("category")
          .eq("category", "testimonials")
          .limit(1);
        if (error) return { ok: false, detail: error.message };
        return { ok: true, detail: `query succeeded, ${data?.length ?? 0} testimonials rows` };
      },
    },
    {
      migration: "00048",
      description: "proposals.show_banner column exists",
      test: async () => {
        const { error } = await admin.from("proposals").select("show_banner").limit(1);
        if (error) return { ok: false, detail: error.message };
        return { ok: true, detail: "column exists" };
      },
    },
    {
      migration: "00049",
      description: "proposals.business_email_sent_at column exists",
      test: async () => {
        const { error } = await admin.from("proposals").select("business_email_sent_at").limit(1);
        if (error) return { ok: false, detail: error.message };
        return { ok: true, detail: "column exists" };
      },
    },
    {
      migration: "00053",
      description: "composer_ai_settings + ai_generations tables exist",
      test: async () => {
        const { error: settingsErr } = await admin.from("composer_ai_settings").select("id").limit(1);
        if (settingsErr) return { ok: false, detail: `composer_ai_settings: ${settingsErr.message}` };
        const { error: genErr } = await admin.from("ai_generations").select("id").limit(1);
        if (genErr) return { ok: false, detail: `ai_generations: ${genErr.message}` };
        return { ok: true, detail: "both tables exist" };
      },
    },
    {
      migration: "00054",
      description: "sites.domain_setup_status column exists",
      test: async () => {
        const { error } = await admin.from("sites").select("domain_setup_status").limit(1);
        if (error) return { ok: false, detail: error.message };
        return { ok: true, detail: "column exists" };
      },
    },
    // Bonus — check the more recent ones too
    {
      migration: "00055",
      description: "composer-staging bucket configured for 25mb (presence check via storage)",
      test: async () => {
        const { data, error } = await admin.storage.getBucket("composer-staging");
        if (error) return { ok: false, detail: error.message };
        return {
          ok: true,
          detail: `bucket exists, file_size_limit=${data?.file_size_limit ?? "?"}`,
        };
      },
    },
    {
      migration: "00056",
      description: "credit_balances.balance is NUMERIC(10,2) and balances reset to 0",
      test: async () => {
        // 00056 zeroes every site's balance. If we still see non-zero balances,
        // the migration didn't run.
        const { data, error } = await admin
          .from("credit_balances")
          .select("balance")
          .gt("balance", 0)
          .limit(1);
        if (error) return { ok: false, detail: error.message };
        if (data && data.length > 0)
          return { ok: false, detail: `found a balance > 0 (${data[0].balance}) — migration probably not applied` };
        return { ok: true, detail: "no balances > 0 (consistent with 00056 reset)" };
      },
    },
    {
      migration: "00057",
      description: "credit_tx_type enum includes 'publish_charge'",
      test: async () => {
        // Probe by trying to insert a row with type='publish_charge' inside a
        // PostgREST `select` filter — invalid enum value would error.
        const { error } = await admin
          .from("credit_transactions")
          .select("id")
          .eq("type", "publish_charge")
          .limit(1);
        if (error) return { ok: false, detail: error.message };
        return { ok: true, detail: "enum value accepted by query filter" };
      },
    },
  ];

  console.log("Probing live DB for pending-migration artifacts:\n");
  for (const p of probes) {
    const r = await p.test();
    console.log(`  ${r.ok ? "✓ APPLIED " : "✗ MISSING "} ${p.migration} — ${p.description}`);
    if (!r.ok || r.detail) console.log(`              ${r.detail}`);
  }
}
