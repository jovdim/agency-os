import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateBySquareQrImage, generateCreditVariableSymbol } from "@/lib/payments/bysquare";

// Per-publish cost in $. Must match COST_PER_CHANGE in
// src/components/payments/buy-credits-dialog.tsx and PUBLISH_COST_EUR in
// the publish + credit-balance API routes. Pre-2026-05-11 this was 12 (a
// pre-Peter-decision rough number) which made the QR amount disagree
// with the dialog's preset by 4% — e.g. clicking "$25" generated a
// $24 QR.
const CREDIT_PRICE_EUR = 12.5;

/**
 * POST /api/payments/qr
 * Generate a BySquare QR image for credit purchases AND record a
 * pending payments row keyed by the variable symbol — so when the
 * customer's bank email arrives, auto-confirm.ts can match the VS
 * back to (a) the site that should get credit, and (b) the expected
 * amount.
 *
 * Without this row, the auto-confirm cron would silently drop every
 * credit-purchase email (no proposal matches that VS scheme). The row
 * stays `pending` until the bank email lands; auto-confirm flips it
 * to `confirmed` while crediting the balance.
 *
 * Body: { site_id, credits }
 * Returns: { qrImageDataUrl, variableSymbol, amount, credits, iban }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { site_id, credits } = body as { site_id: string; credits: number };

  if (!site_id || !credits || credits < 1 || credits > 100) {
    return NextResponse.json(
      { error: "Invalid site_id or credits (1-100)" },
      { status: 400 },
    );
  }

  // Verify ownership
  const { data: site } = await supabase
    .from("sites")
    .select("id, owner_id")
    .eq("id", site_id)
    .eq("owner_id", user.id)
    .single();

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const amount = credits * CREDIT_PRICE_EUR;
  const variableSymbol = generateCreditVariableSymbol(site_id);

  let qrImageDataUrl: string;
  try {
    qrImageDataUrl = await generateBySquareQrImage({
      amount,
      variableSymbol,
      note: `Credits x${credits} - Your Agency`,
    });
  } catch (error) {
    console.error("[QR] Failed to generate BySquare QR:", error);
    return NextResponse.json(
      { error: "Failed to generate QR code" },
      { status: 500 },
    );
  }

  // ── Insert the pending payment row AFTER the QR was generated so
  // we don't leave orphan rows from BySquare API failures.
  // Uses admin client to bypass RLS — the pending payment is a
  // server-tracked record, not user-editable.
  const admin = createAdminClient();
  const { error: paymentErr } = await admin.from("payments").insert({
    profile_id: user.id,
    site_id,
    amount,
    currency: "USD",
    payment_method: "bysquare_credit",
    variable_symbol: variableSymbol,
    status: "pending",
    description: `Pending: ${credits} publishes ($${amount})`,
  });
  if (paymentErr) {
    // We've already burned the BySquare API call — don't fail the
    // whole request just because the audit row didn't land. Log it
    // so we can backfill later if needed; the customer still gets
    // their QR. Worst case: they pay and we have to manually credit
    // them because the auto-confirm has nothing to look up.
    console.error(
      `[QR] Failed to record pending payment (VS=${variableSymbol}, site=${site_id}): ${paymentErr.message}`,
    );
  }

  return NextResponse.json({
    qrImageDataUrl,
    variableSymbol,
    amount,
    credits,
    iban: process.env.BYSQUARE_IBAN || "SK1309000000005221380177",
  });
}
