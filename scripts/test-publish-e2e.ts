/**
 * End-to-end test of the publish CHARGE logic (platform_publish_charge, 00082).
 * Runs against a real test site, then RESTORES all mutated state (balance,
 * composition, published_composition, is_paid) and deletes the test charge tx —
 * so the site is left exactly as it was.
 *
 *   npx tsx scripts/test-publish-e2e.ts [slug|subdomain|id]   (default: t-f4f0)
 *
 * Proves: a real publish charges 12.50, logs a publish_charge tx, copies draft
 * → live; a no-change republish is free (no double-charge).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";

const SITE_KEY = process.argv[2] || "t-f4f0";
const COST = 12.5;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Resolve the site.
  let siteId = "";
  for (const col of ["slug", "subdomain", "id"] as const) {
    const { data } = await sb.from("sites").select("id").eq(col, SITE_KEY).maybeSingle();
    if (data) {
      siteId = (data as { id: string }).id;
      break;
    }
  }
  if (!siteId) {
    console.error(`No site for "${SITE_KEY}"`);
    process.exit(1);
  }

  const { data: s } = await sb
    .from("sites")
    .select("id, owner_id, is_paid, composition, published_composition")
    .eq("id", siteId)
    .single();
  if (!s) {
    console.error("Site row not found");
    process.exit(1);
  }
  const ownerId = (s as { owner_id: string | null }).owner_id;

  // Snapshot originals (restored in finally).
  const origIsPaid = (s as { is_paid: boolean | null }).is_paid;
  const origComp = (s as { composition: unknown }).composition;
  const origPub = (s as { published_composition: unknown }).published_composition;
  const { data: cb0 } = await sb
    .from("credit_balances")
    .select("balance")
    .eq("site_id", siteId)
    .maybeSingle();
  const origBalance = (cb0 as { balance: number } | null)?.balance ?? null;

  let createdTxId: string | null = null;
  let ok = true;

  try {
    // ── Setup: paid, known balance (100), draft ≠ live ──
    await sb.from("sites").update({ is_paid: true }).eq("id", siteId);
    await sb
      .from("credit_balances")
      .upsert({ site_id: siteId, balance: 100 }, { onConflict: "site_id" });
    const marker = { _e2e_edit: Date.now(), pages: [{ path: "index.html", label: "Home", sections: [] }] };
    await sb
      .from("sites")
      .update({
        composition: marker,
        published_composition: { _e2e_baseline: true },
      })
      .eq("id", siteId);

    // ── 1) Real publish (draft ≠ live) → should CHARGE ──
    const { data: r1, error: e1 } = await sb.rpc("platform_publish_charge", {
      p_site_id: siteId,
      p_user_id: ownerId,
      p_publish_cost: COST,
    });
    if (e1) throw new Error(`charge RPC error: ${e1.message}`);
    const res1 = (Array.isArray(r1) ? r1[0] : r1) as { charged: boolean; new_balance: number };
    console.log(`publish #1 (real edit): charged=${res1.charged} new_balance=${res1.new_balance}`);
    assert(res1.charged === true, "first publish should charge");
    assert(Math.abs(res1.new_balance - 87.5) < 0.001, `new_balance should be 87.50, got ${res1.new_balance}`);

    const { data: cbA } = await sb.from("credit_balances").select("balance").eq("site_id", siteId).single();
    assert(Math.abs((cbA as { balance: number }).balance - 87.5) < 0.001, "DB balance should be 87.50");

    const { data: sA } = await sb.from("sites").select("composition, published_composition").eq("id", siteId).single();
    assert(
      (sA as { published_composition: { _e2e_edit?: number } }).published_composition?._e2e_edit,
      "draft should have been copied to live (published carries the new edit)",
    );

    const { data: tx } = await sb
      .from("credit_transactions")
      .select("id, amount, type")
      .eq("site_id", siteId)
      .eq("type", "publish_charge")
      .order("created_at", { ascending: false })
      .limit(1);
    const txRow = tx?.[0] as { id: string; amount: number } | undefined;
    assert(txRow && Math.abs(txRow.amount + 12.5) < 0.001, "a publish_charge tx of -12.50 should be logged");
    createdTxId = txRow?.id ?? null;
    console.log(`   ✓ balance 100 → 87.50, draft copied to live, tx -12.50 logged`);

    // ── 2) Republish with NO change (draft === live) → should be FREE ──
    const { data: r2, error: e2 } = await sb.rpc("platform_publish_charge", {
      p_site_id: siteId,
      p_user_id: ownerId,
      p_publish_cost: COST,
    });
    if (e2) throw new Error(`no-op RPC error: ${e2.message}`);
    const res2 = (Array.isArray(r2) ? r2[0] : r2) as { charged: boolean; new_balance: number };
    console.log(`publish #2 (no change): charged=${res2.charged} new_balance=${res2.new_balance}`);
    assert(res2.charged === false, "no-change republish should NOT charge");
    const { data: cbB } = await sb.from("credit_balances").select("balance").eq("site_id", siteId).single();
    assert(Math.abs((cbB as { balance: number }).balance - 87.5) < 0.001, "balance must be unchanged after a no-op republish");
    console.log(`   ✓ no-op republish was free (balance still 87.50)`);

    console.log("\n✅ Publish charge verified end-to-end: real edit charges 12.50 + logs tx + copies draft→live; no-change republish is free.");
  } catch (err) {
    ok = false;
    console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // ── Restore everything ──
    await sb
      .from("sites")
      .update({ is_paid: origIsPaid, composition: origComp, published_composition: origPub })
      .eq("id", siteId);
    if (origBalance === null) {
      await sb.from("credit_balances").delete().eq("site_id", siteId);
    } else {
      await sb.from("credit_balances").update({ balance: origBalance }).eq("site_id", siteId);
    }
    if (createdTxId) await sb.from("credit_transactions").delete().eq("id", createdTxId);
    console.log("   (test site state restored)");
  }

  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
