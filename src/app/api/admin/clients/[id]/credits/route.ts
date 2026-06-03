import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/admin/clients/[id]/credits
 * Tech admin adjusts the credit balance (in euros) of a client's site.
 * Body: { amount: number, note?: string, site_id: string }
 *
 * `amount` is the signed euro delta:
 *   - Positive value → grant (e.g. +12.50, +25)
 *   - Negative value → deduct (e.g. -12.50). Capped at the current
 *     balance — we never let it go below 0.
 *
 * Magnitude must be a non-zero multiple of 12.50 (the publish cost) so
 * balances stay aligned to whole publishes. Single-call magnitude
 * capped at 1000 € (typo guard).
 *
 * Role matrix:
 *   - super_admin / administrator / tech_admin → grant or deduct freely
 *   - sales                                    → grant only, max 50 €
 *                                                cumulative per client
 */
const PUBLISH_COST_EUR = 12.5;
const SALES_GRANT_CAP_EUR = 50;
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !callerProfile ||
    !["tech_admin", "super_admin", "administrator", "sales"].includes(callerProfile.role)
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { id: clientId } = await params;
  const body = await req.json();
  const { amount, note, site_id } = body as {
    amount: number;
    note?: string;
    site_id: string;
  };

  // ── Euro-aware validation ────────────────────────────────
  // Signed delta: positive = grant, negative = deduct, zero is a no-op
  // and not allowed (probably a UI bug). Magnitude must be a multiple
  // of the publish cost so balances stay aligned to whole publishes.
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
    return NextResponse.json(
      { error: "Amount must be a non-zero number (in €)" },
      { status: 400 }
    );
  }
  // Floating-point safe modulo on the magnitude.
  if (Math.round(Math.abs(amount) * 100) % Math.round(PUBLISH_COST_EUR * 100) !== 0) {
    return NextResponse.json(
      { error: `Amount must be a multiple of ${PUBLISH_COST_EUR.toFixed(2)} €` },
      { status: 400 }
    );
  }
  // Soft sanity ceiling on the magnitude — a single ±1000 € adjustment
  // is almost certainly a typo.
  if (Math.abs(amount) > 1000) {
    return NextResponse.json(
      { error: "Adjustment must not exceed 1000 € per call" },
      { status: 400 }
    );
  }

  // ── Sales role: positive only, cap at 50 € total per client ───
  // Sales can hand out small bonus credits but can't take them away.
  if (callerProfile.role === "sales") {
    if (amount < 0) {
      return NextResponse.json(
        { error: "Sales role cannot deduct credits" },
        { status: 403 }
      );
    }
    const salesAdmin = createAdminClient();
    const { data: existingGrants } = await salesAdmin
      .from("credit_transactions")
      .select("amount")
      .eq("site_id", site_id)
      .eq("type", "admin_grant");
    // Sum only positive grants — past deductions by tech don't reduce
    // sales' remaining cap.
    const totalGranted = (existingGrants || []).reduce(
      (sum: number, g: { amount: number }) => sum + Math.max(0, Number(g.amount)),
      0,
    );
    if (totalGranted + amount > SALES_GRANT_CAP_EUR) {
      return NextResponse.json(
        {
          error: `${totalGranted.toFixed(2)} € has already been granted. The maximum is ${SALES_GRANT_CAP_EUR} € per client.`,
        },
        { status: 400 }
      );
    }
  }

  if (!site_id) {
    return NextResponse.json(
      { error: "site_id is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Verify the site belongs to this client
  const { data: site } = await admin
    .from("sites")
    .select("id, name")
    .eq("id", site_id)
    .eq("owner_id", clientId)
    .single();

  if (!site) {
    return NextResponse.json(
      { error: "Site not found for this client" },
      { status: 404 }
    );
  }

  // Upsert credit balance
  const { data: existing } = await admin
    .from("credit_balances")
    .select("balance")
    .eq("site_id", site_id)
    .single();

  // Round to 2 decimals on every write — guards against floating-point
  // drift accumulating across many small adjustments.
  const currentBalance = Number(existing?.balance ?? 0);

  // Deductions can't push balance below zero — surface a clean 400 so
  // the UI shows a real error instead of silently overdrawing.
  if (amount < 0 && currentBalance + amount < -0.005) {
    return NextResponse.json(
      {
        error: `Cannot deduct ${Math.abs(amount).toFixed(2)} € — current balance is only ${currentBalance.toFixed(2)} €`,
      },
      { status: 400 },
    );
  }

  // Clamp at 0 just in case (handles tiny float-precision noise).
  const newBalance = Math.max(
    0,
    Number((currentBalance + amount).toFixed(2)),
  );

  if (existing) {
    await admin
      .from("credit_balances")
      .update({ balance: newBalance })
      .eq("site_id", site_id);
  } else {
    await admin
      .from("credit_balances")
      .insert({ site_id, balance: newBalance });
  }

  // Record transaction. Sign of `amount` carries the direction —
  // credits-client.tsx already keys on tx.amount > 0 to render +/-.
  const verb = amount > 0 ? "Granted" : "Deducted";
  await admin.from("credit_transactions").insert({
    site_id,
    user_id: clientId,
    amount,
    type: "admin_grant",
    note: note || `${verb} ${Math.abs(amount).toFixed(2)} € by ${callerProfile.role}`,
  });

  return NextResponse.json({
    success: true,
    new_balance: newBalance,
  });
}
