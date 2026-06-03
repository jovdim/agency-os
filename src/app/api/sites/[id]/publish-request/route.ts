import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PUBLISH_COST_EUR } from "../credit-balance/route";

/**
 * POST /api/sites/[id]/publish-request
 *
 * Client-only. A paid client clicks "Request publish" in the composer.
 * The 12.50 € is charged **at submit time** (Peter 2026-05-30); the
 * client doesn't wait for IT to approve before being charged. IT only
 * controls when the publish actually goes live + can refund by
 * rejecting.
 *
 * Override behavior — the client can click submit again at any time
 * while a request is pending. The previous pending row is flipped to
 * `overridden` (forfeit — the 12.50 € is NOT refunded; that's the
 * cost of changing their mind) and a fresh pending row is created with
 * its own 12.50 € charge. IT only ever sees the latest pending row.
 *
 * All of that — gate checks, status flip, insert, balance deduction,
 * audit row — happens in one transaction inside the
 * `create_publish_request` RPC, so we can't end up half-committed
 * (e.g. balance deducted but no pending row).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const role = user.app_metadata?.role as string | undefined;

  // Request flow is client-only. Staff publish directly via the composer
  // (tech/sales/super hit /publish, which charges nothing).
  if (role !== "client") {
    return NextResponse.json(
      { error: "Only clients request publishes." },
      { status: 403 },
    );
  }

  const admin = createAdminClient();

  // Ownership check — the RPC is SECURITY DEFINER so it bypasses RLS;
  // we enforce "you only request for your own site" here at the route.
  const { data: site, error: siteErr } = await admin
    .from("sites")
    .select("id, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (siteErr || !site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }
  if (site.owner_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // One atomic call: paid + balance check, override prior pending,
  // insert new pending, deduct balance, log charge.
  const { data, error } = await admin.rpc("create_publish_request", {
    p_site_id: id,
    p_user_id: user.id,
    p_publish_cost: PUBLISH_COST_EUR,
  });

  if (error) {
    // Map the RPC's RAISE EXCEPTIONs to the same HTTP codes the
    // composer already understands.
    const msg = error.message || "";
    if (msg.includes("SITE_NOT_PAID")) {
      return NextResponse.json(
        {
          error:
            "The website has not been activated yet. Once your payment is received, you'll be able to request a publish.",
          code: "SITE_NOT_PAID",
        },
        { status: 402 },
      );
    }
    if (msg.includes("INSUFFICIENT_CREDITS")) {
      // Re-read balance so the UI can show the current amount in the
      // error toast / "top up credits" link.
      const { data: balanceRow } = await admin
        .from("credit_balances")
        .select("balance")
        .eq("site_id", id)
        .maybeSingle();
      const balance = Number(balanceRow?.balance ?? 0);
      return NextResponse.json(
        {
          error: `Not enough credits — publishing requires ${PUBLISH_COST_EUR.toFixed(2)} €, you have ${balance.toFixed(2)} €.`,
          code: "INSUFFICIENT_CREDITS",
          balance,
          publish_cost: PUBLISH_COST_EUR,
        },
        { status: 402 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // RPC payload: { request_id, created_at, overrode_id, new_balance }
  const result = (data ?? {}) as {
    request_id?: string;
    created_at?: string;
    overrode_id?: string | null;
    new_balance?: number;
  };

  return NextResponse.json({
    request: {
      id: result.request_id,
      status: "pending",
      created_at: result.created_at,
    },
    overrode_id: result.overrode_id ?? null,
    new_balance: result.new_balance ?? null,
    charged_amount_eur: PUBLISH_COST_EUR,
  });
}
